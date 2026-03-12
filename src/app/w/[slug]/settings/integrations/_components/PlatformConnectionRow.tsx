"use client";

import { useState, useRef, useCallback } from "react";
import {
  Instagram,
  Linkedin,
  Twitter,
  Facebook,
  Plug,
  Loader2,
} from "lucide-react";
import {
  connectPlatform,
  disconnectPlatformAction,
  refreshPlatformStatus,
} from "@/lib/actions/platforms";
import type { PlatformConnectionWithStatus } from "@/lib/actions/platforms";
import { cn } from "@/lib/utils";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Instagram,
  Linkedin,
  Twitter,
  Facebook,
};

interface PlatformConnectionRowProps {
  connection: PlatformConnectionWithStatus;
  workspaceId: string;
  onRefresh: () => void;
}

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  connected: {
    label: "Connected",
    className:
      "text-green-600 bg-green-100 dark:bg-green-900/30 dark:text-green-400",
  },
  auth_required: {
    label: "Needs Auth",
    className:
      "text-amber-600 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400",
  },
  pending: {
    label: "Pending",
    className:
      "text-blue-600 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400",
  },
  error: {
    label: "Error",
    className:
      "text-red-600 bg-red-100 dark:bg-red-900/30 dark:text-red-400",
  },
};

export function PlatformConnectionRow({
  connection,
  workspaceId,
  onRefresh,
}: PlatformConnectionRowProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const Icon = ICONS[connection.icon] || Plug;
  const isConnected = connection.status === "connected";
  const badge = STATUS_BADGES[connection.status];

  const cleanup = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const handleConnect = async () => {
    if (isConnecting) return;
    setIsConnecting(true);
    setError(null);

    try {
      const result = await connectPlatform(workspaceId, connection.platform);

      if (!result.success) {
        setError(result.error || "Failed to connect");
        setIsConnecting(false);
        return;
      }

      if (result.authorizationUrl) {
        // Open OAuth popup
        const popup = window.open(
          result.authorizationUrl,
          `connect-${connection.platform}`,
          "width=600,height=700,scrollbars=yes"
        );

        // Poll for popup close
        cleanup();
        pollRef.current = setInterval(async () => {
          if (popup?.closed) {
            cleanup();
            await refreshPlatformStatus(workspaceId, connection.platform);
            onRefresh();
            setIsConnecting(false);
          }
        }, 1500);
      } else {
        // Already connected
        onRefresh();
        setIsConnecting(false);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to connect"
      );
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (isDisconnecting) return;
    setIsDisconnecting(true);
    setError(null);

    try {
      const result = await disconnectPlatformAction(
        workspaceId,
        connection.platform
      );
      if (!result.success) {
        setError(result.error || "Failed to disconnect");
      }
      onRefresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to disconnect"
      );
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <div className="px-6 py-4 border-b border-border last:border-b-0">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "w-10 h-10 rounded-lg flex items-center justify-center",
              isConnected
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground"
            )}
          >
            <Icon className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "text-sm font-medium",
                  isConnected
                    ? "text-foreground"
                    : "text-muted-foreground"
                )}
              >
                {connection.name}
              </span>
              {badge && connection.status !== "not_connected" && (
                <span
                  className={cn(
                    "text-xs px-1.5 py-0.5 rounded",
                    badge.className
                  )}
                >
                  {badge.label}
                </span>
              )}
              {connection.displayName && (
                <span className="text-xs text-muted-foreground">
                  {connection.displayName}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {connection.description}
            </p>
          </div>
        </div>
        <div>
          {isConnected ? (
            <button
              onClick={handleDisconnect}
              disabled={isDisconnecting}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-md border transition-colors",
                "border-border text-muted-foreground hover:text-foreground hover:border-foreground/20",
                isDisconnecting && "opacity-50 cursor-not-allowed"
              )}
            >
              {isDisconnecting ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                "Disconnect"
              )}
            </button>
          ) : (
            <button
              onClick={handleConnect}
              disabled={isConnecting}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                "bg-primary text-primary-foreground hover:bg-primary/90",
                isConnecting && "opacity-50 cursor-not-allowed"
              )}
            >
              {isConnecting ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                "Connect"
              )}
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className="mt-2 p-2 bg-destructive/10 border border-destructive/20 rounded-md">
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}
    </div>
  );
}
