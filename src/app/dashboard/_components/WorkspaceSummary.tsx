"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { MarkdownContent } from "@/components/ai-elements/MarkdownContent";
import { Skeleton } from "@/components/ui/skeleton";
import type { TimeRange } from "@/lib/actions/dashboard";

export function WorkspaceSummary({
  workspaceId,
  timeRange,
}: {
  workspaceId: string;
  timeRange: TimeRange;
}) {
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<"loading" | "streaming" | "done" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const fetchSummary = useCallback(async () => {
    // Abort any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setContent("");
    setStatus("loading");
    setErrorMessage("");

    try {
      const response = await fetch("/api/dashboard/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, timeRange }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to generate summary (${response.status})`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();
      setStatus("streaming");

      let accumulated = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        accumulated += decoder.decode(value, { stream: true });
        setContent(accumulated);
      }

      setStatus("done");
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return; // Ignore abort errors
      }
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Failed to generate summary");
    }
  }, [workspaceId, timeRange]);

  useEffect(() => {
    fetchSummary();
    return () => {
      abortRef.current?.abort();
    };
  }, [fetchSummary]);

  if (status === "error") {
    return (
      <div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{errorMessage}</p>
          <button
            onClick={fetchSummary}
            className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div className="space-y-5 min-h-[420px]">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
          Generating summary...
        </p>
        {/* Tickets in Motion */}
        <div className="space-y-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-11/12" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-3 w-3/5" />
        </div>
        {/* Team Activity */}
        <div className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-10/12" />
          <Skeleton className="h-3 w-4/5" />
        </div>
        {/* Action Items & Blockers */}
        <div className="space-y-2">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-9/12" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[420px]">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
          Summary
        </p>
        {status === "done" && (
          <button
            onClick={fetchSummary}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Regenerate summary"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        )}
      </div>
      <MarkdownContent
        content={content}
        className="prose-base [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1.5 [&_p]:text-base [&_li]:text-base [&_ul]:text-base"
      />
    </div>
  );
}
