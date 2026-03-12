"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  Instagram,
  Linkedin,
  Twitter,
  Facebook,
  Plug,
  Loader2,
  Check,
  AlertCircle,
} from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  connectPlatform,
  disconnectPlatformAction,
  refreshPlatformStatus,
  getUserPlatformConnections,
} from "@/lib/actions/platforms";
import type { PlatformConnectionWithStatus } from "@/lib/actions/platforms";
import type { WorkspacePurpose } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

const PLATFORM_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  Instagram,
  Linkedin,
  Twitter,
  Facebook,
};

interface ChatPlatformConnectionsProps {
  workspaceId: string;
  workspacePurpose: WorkspacePurpose;
}

export function ChatPlatformConnections({
  workspaceId,
  workspacePurpose,
}: ChatPlatformConnectionsProps) {
  const [open, setOpen] = useState(false);
  const [platforms, setPlatforms] = useState<PlatformConnectionWithStatus[]>([]);
  const [isLoadingPlatforms, setIsLoadingPlatforms] = useState(false);
  const [connectingPlatform, setConnectingPlatform] = useState<string | null>(
    null
  );
  const [disconnectingPlatform, setDisconnectingPlatform] = useState<
    string | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Only render for marketing workspaces
  if (workspacePurpose !== "marketing") return null;

  const connectedCount = platforms.filter(
    (p) => p.status === "connected"
  ).length;

  const cleanup = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const loadPlatforms = useCallback(async () => {
    setIsLoadingPlatforms(true);
    try {
      const connections = await getUserPlatformConnections(workspaceId);
      setPlatforms(connections);
    } catch (err) {
      console.error("Failed to load platform connections:", err);
    } finally {
      setIsLoadingPlatforms(false);
    }
  }, [workspaceId]);

  // Load platforms when popover opens
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (open) {
      loadPlatforms();
    }
    return cleanup;
  }, [open, loadPlatforms, cleanup]);

  const handleConnect = async (platform: string) => {
    if (connectingPlatform) return;
    setConnectingPlatform(platform);
    setError(null);

    try {
      const result = await connectPlatform(workspaceId, platform);

      if (!result.success) {
        setError(result.error || "Failed to connect");
        setConnectingPlatform(null);
        return;
      }

      if (result.authorizationUrl) {
        const popup = window.open(
          result.authorizationUrl,
          `connect-${platform}`,
          "width=600,height=700,scrollbars=yes"
        );

        cleanup();
        pollRef.current = setInterval(async () => {
          if (popup?.closed) {
            cleanup();
            await refreshPlatformStatus(workspaceId, platform);
            await loadPlatforms();
            setConnectingPlatform(null);
          }
        }, 1500);
      } else {
        await loadPlatforms();
        setConnectingPlatform(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect");
      setConnectingPlatform(null);
    }
  };

  const handleDisconnect = async (platform: string) => {
    if (disconnectingPlatform) return;
    setDisconnectingPlatform(platform);
    setError(null);

    try {
      const result = await disconnectPlatformAction(workspaceId, platform);
      if (!result.success) {
        setError(result.error || "Failed to disconnect");
      }
      await loadPlatforms();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setDisconnectingPlatform(null);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative p-0 rounded text-muted-foreground hover:text-foreground cursor-pointer"
          title="Connect platforms"
        >
          <Plug className="w-4 h-4" />
          {connectedCount > 0 && (
            <span className="absolute -top-1 -right-1 w-2 h-2 bg-green-500 rounded-full" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="px-4 py-3 border-b border-border">
          <h4 className="text-sm font-medium">Platform Connections</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Connect social accounts for AI-powered insights
          </p>
        </div>

        {isLoadingPlatforms ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="divide-y divide-border">
            {platforms.map((platform) => {
              const Icon = PLATFORM_ICONS[platform.icon] || Plug;
              const isConnected = platform.status === "connected";
              const isThisConnecting =
                connectingPlatform === platform.platform;
              const isThisDisconnecting =
                disconnectingPlatform === platform.platform;

              return (
                <div
                  key={platform.platform}
                  className="flex items-center justify-between px-4 py-2.5"
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className={cn(
                        "w-7 h-7 rounded-md flex items-center justify-center",
                        isConnected
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <span
                        className={cn(
                          "text-sm",
                          isConnected
                            ? "text-foreground"
                            : "text-muted-foreground"
                        )}
                      >
                        {platform.name}
                      </span>
                      {isConnected && (
                        <div className="flex items-center gap-1">
                          <Check className="w-3 h-3 text-green-500" />
                          <span className="text-[10px] text-green-600 dark:text-green-400">
                            Connected
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div>
                    {isConnected ? (
                      <button
                        onClick={() => handleDisconnect(platform.platform)}
                        disabled={isThisDisconnecting}
                        className={cn(
                          "px-2.5 py-1 text-xs rounded-md border transition-colors cursor-pointer",
                          "border-border text-muted-foreground hover:text-foreground hover:border-foreground/20",
                          isThisDisconnecting && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        {isThisDisconnecting ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          "Disconnect"
                        )}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleConnect(platform.platform)}
                        disabled={!!connectingPlatform}
                        className={cn(
                          "px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer",
                          "bg-primary text-primary-foreground hover:bg-primary/90",
                          (isThisConnecting || !!connectingPlatform) &&
                            "opacity-50 cursor-not-allowed"
                        )}
                      >
                        {isThisConnecting ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          "Connect"
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {error && (
          <div className="px-4 py-2 border-t border-border">
            <div className="flex items-center gap-1.5 text-destructive">
              <AlertCircle className="w-3 h-3 shrink-0" />
              <p className="text-xs">{error}</p>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
