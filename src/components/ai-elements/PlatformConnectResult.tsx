"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Instagram,
  Linkedin,
  Twitter,
  Facebook,
  Plug,
  CheckCircle,
  Loader2,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { refreshPlatformStatus } from "@/lib/actions/platforms";
import { cn } from "@/lib/utils";

const PLATFORM_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  instagram: Instagram,
  linkedin: Linkedin,
  twitter: Twitter,
  facebook: Facebook,
};

const PLATFORM_NAMES: Record<string, string> = {
  instagram: "Instagram",
  linkedin: "LinkedIn",
  twitter: "X (Twitter)",
  facebook: "Facebook",
};

interface ConnectResult {
  success: boolean;
  action?: "authorize" | "connected";
  authorizationUrl?: string;
  platform?: string;
  message?: string;
  error?: string;
}

interface PlatformConnectResultProps {
  result: string;
  workspaceId?: string;
}

export function PlatformConnectResult({
  result,
  workspaceId,
}: PlatformConnectResultProps) {
  const [status, setStatus] = useState<
    "idle" | "authorizing" | "connected" | "error"
  >("idle");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasOpenedRef = useRef(false);

  const parsed = useMemo<ConnectResult | null>(() => {
    try {
      return JSON.parse(result);
    } catch {
      return null;
    }
  }, [result]);

  const platform = parsed?.platform ?? "";
  const Icon = PLATFORM_ICONS[platform] || Plug;
  const platformName = PLATFORM_NAMES[platform] || platform;

  const cleanup = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const openPopup = useCallback(() => {
    if (!parsed?.authorizationUrl) return;

    const popup = window.open(
      parsed.authorizationUrl,
      `connect-${parsed.platform}`,
      "width=600,height=700,scrollbars=yes"
    );
    setStatus("authorizing");

    cleanup();
    pollRef.current = setInterval(async () => {
      if (popup?.closed) {
        cleanup();
        if (workspaceId && parsed.platform) {
          const { status: newStatus } = await refreshPlatformStatus(
            workspaceId,
            parsed.platform
          );
          setStatus(newStatus === "connected" ? "connected" : "error");
        }
      }
    }, 1500);
  }, [parsed?.authorizationUrl, parsed?.platform, workspaceId, cleanup]);

  // Auto-open popup on first render
  useEffect(() => {
    if (
      parsed?.action === "authorize" &&
      parsed.authorizationUrl &&
      !hasOpenedRef.current
    ) {
      hasOpenedRef.current = true;
      openPopup();
    }
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!parsed) return null;

  // Error state
  if (!parsed.success && parsed.error) {
    return (
      <div className="flex items-center gap-3 w-full max-w-sm mt-3 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-red-100 dark:bg-red-900/40 text-red-500">
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-red-700 dark:text-red-400">
            Connection failed
          </p>
          <p className="text-xs text-red-600/80 dark:text-red-400/70 mt-0.5">
            {parsed.error}
          </p>
        </div>
        <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
      </div>
    );
  }

  // Connected state
  if (parsed.action === "connected" || status === "connected") {
    return (
      <div className="flex items-center gap-3 w-full max-w-sm mt-3 p-3 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900/50">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400">
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-green-700 dark:text-green-400">
            {platformName} connected
          </p>
          <p className="text-xs text-green-600/80 dark:text-green-400/70 mt-0.5">
            Ready to use
          </p>
        </div>
        <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
      </div>
    );
  }

  // Authorization needed — show connect button
  if (parsed.action === "authorize") {
    return (
      <div className="flex items-center gap-3 w-full max-w-sm mt-3 p-3 rounded-lg bg-background/50 border border-border/50">
        <div
          className={cn(
            "flex items-center justify-center w-9 h-9 rounded-lg shrink-0",
            status === "authorizing"
              ? "bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400"
              : "bg-muted text-muted-foreground"
          )}
        >
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{platformName}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {status === "authorizing"
              ? "Waiting for authorization..."
              : status === "error"
                ? "Authorization may not have completed"
                : "Requires authorization"}
          </p>
        </div>
        <div className="shrink-0">
          {status === "authorizing" ? (
            <div className="px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" />
              Waiting...
            </div>
          ) : (
            <button
              onClick={openPopup}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer",
                "inline-flex items-center gap-1.5",
                status === "error"
                  ? "bg-amber-500 text-white hover:bg-amber-600"
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
              )}
            >
              {status === "error" ? (
                <>
                  Try again
                  <ExternalLink className="w-3 h-3" />
                </>
              ) : (
                <>
                  Connect
                  <ExternalLink className="w-3 h-3" />
                </>
              )}
            </button>
          )}
        </div>
      </div>
    );
  }

  return null;
}
