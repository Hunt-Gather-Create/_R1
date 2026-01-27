"use client";

import { Plug } from "lucide-react";
import { useSettingsContext } from "../context";
import { IntegrationRow } from "./_components/IntegrationRow";

export default function IntegrationsSettingsPage() {
  const { workspace, mcpServers, isAdmin, refreshMcpServers } = useSettingsContext();

  return (
    <div className="max-w-2xl mx-auto p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Integrations</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Connect external tools to enhance AI assistant capabilities
        </p>
      </div>

      {/* MCP Servers List */}
      <div className="rounded-lg border border-border bg-card">
        {mcpServers.length === 0 ? (
          <div className="px-6 py-8 text-center">
            <Plug className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              No integrations available.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Integrations require a Smithery API key to be configured.
            </p>
          </div>
        ) : (
          <>
            {mcpServers.map((server) => (
              <IntegrationRow
                key={server.key}
                server={server}
                isAdmin={isAdmin}
                workspaceId={workspace?.id ?? ""}
                onToggle={refreshMcpServers}
              />
            ))}
          </>
        )}
      </div>

      {/* Help text */}
      <p className="text-xs text-muted-foreground mt-4 text-center">
        More integrations coming soon...
      </p>
    </div>
  );
}
