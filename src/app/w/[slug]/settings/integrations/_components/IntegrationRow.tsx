"use client";

import { useState } from "react";
import { Search, Plug } from "lucide-react";
import { toggleMcpServer } from "@/lib/actions/integrations";
import { cn } from "@/lib/utils";
import type { McpServerWithStatus } from "@/lib/actions/integrations";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Search,
};

interface IntegrationRowProps {
  server: McpServerWithStatus;
  isAdmin: boolean;
  workspaceId: string;
  onToggle: () => void;
}

export function IntegrationRow({
  server,
  isAdmin,
  workspaceId,
  onToggle,
}: IntegrationRowProps) {
  const [isToggling, setIsToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const Icon = ICONS[server.icon] || Plug;

  const handleToggle = async () => {
    if (!isAdmin || isToggling) return;

    setIsToggling(true);
    setError(null);

    try {
      const result = await toggleMcpServer(workspaceId, server.key);

      if (!result.success) {
        setError(result.error || "Failed to toggle integration");
      }

      onToggle();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle integration");
    } finally {
      setIsToggling(false);
    }
  };

  return (
    <div className="px-6 py-4 border-b border-border last:border-b-0">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "w-10 h-10 rounded-lg flex items-center justify-center",
              server.isEnabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
            )}
          >
            <Icon className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "text-sm font-medium",
                  server.isEnabled ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {server.name}
              </span>
              {server.isEnabled && server.status === "connected" && (
                <span className="text-xs text-green-600 bg-green-100 dark:bg-green-900/30 dark:text-green-400 px-1.5 py-0.5 rounded">
                  Connected
                </span>
              )}
              {server.isEnabled && server.status === "error" && (
                <span className="text-xs text-red-600 bg-red-100 dark:bg-red-900/30 dark:text-red-400 px-1.5 py-0.5 rounded">
                  Error
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">{server.description}</p>
            {server.isEnabled && server.status === "error" && server.errorMessage && (
              <p className="text-xs text-red-500 mt-1">{server.errorMessage}</p>
            )}
          </div>
        </div>
        {isAdmin && (
          <button
            onClick={handleToggle}
            disabled={isToggling}
            className={cn(
              "relative w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
              server.isEnabled ? "bg-primary" : "bg-muted",
              isToggling && "opacity-50 cursor-not-allowed"
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform",
                server.isEnabled && "translate-x-5"
              )}
            />
          </button>
        )}
      </div>
      {error && (
        <div className="mt-2 p-2 bg-destructive/10 border border-destructive/20 rounded-md">
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}
    </div>
  );
}
