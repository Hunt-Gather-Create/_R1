"use client";

import { useSettingsContext } from "../context";
import { GradientPage } from "@/components/ui/gradient-page";
import { PageHeader } from "@/components/ui/page-header";
import { ConnectionInstructions } from "./_components/ConnectionInstructions";
import { ToolReference } from "./_components/ToolReference";
import { ActiveSessions } from "./_components/ActiveSessions";
import { Copy, Check } from "lucide-react";
import { useState } from "react";

export default function McpApiSettingsPage() {
  const { workspace, brand, isAdmin } = useSettingsContext();
  const [copied, setCopied] = useState(false);

  const mcpUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/mcp`
      : "/api/mcp";

  function handleCopy() {
    navigator.clipboard.writeText(mcpUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <GradientPage color={brand?.primaryColor ?? undefined}>
      <PageHeader
        label="Settings"
        title="MCP API"
        subtitle="Connect external AI clients like Claude Desktop or Cursor to this workspace via the Model Context Protocol"
      />

      <section className="container space-y-8">
        {/* Endpoint URL */}
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-2">
            Endpoint
          </h2>
          <p className="text-sm text-muted-foreground mb-3">
            Use this URL to connect MCP clients to{" "}
            <strong>{workspace?.name ?? "this workspace"}</strong>.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 text-sm bg-muted rounded-md border border-border font-mono truncate">
              {mcpUrl}
            </code>
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-md border border-border bg-card hover:bg-accent transition-colors"
            >
              {copied ? (
                <Check className="w-4 h-4 text-green-500" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>

        {/* Connection Instructions */}
        <ConnectionInstructions mcpUrl={mcpUrl} />

        {/* Tool Reference */}
        <ToolReference />

        {/* Active Sessions (admin only) */}
        {isAdmin && workspace && (
          <ActiveSessions workspaceId={workspace.id} />
        )}
      </section>
    </GradientPage>
  );
}
