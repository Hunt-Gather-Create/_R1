"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { getUserPlatformConnections } from "@/lib/actions/platforms";
import type { PlatformConnectionWithStatus } from "@/lib/actions/platforms";
import { PlatformConnectionRow } from "./PlatformConnectionRow";

interface PlatformConnectionsSectionProps {
  workspaceId: string;
}

export function PlatformConnectionsSection({
  workspaceId,
}: PlatformConnectionsSectionProps) {
  const [connections, setConnections] = useState<
    PlatformConnectionWithStatus[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadConnections = useCallback(async () => {
    try {
      const data = await getUserPlatformConnections(workspaceId);
      setConnections(data);
    } catch (error) {
      console.error("Failed to load platform connections:", error);
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-foreground">
          Social Platforms
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Connect your social media accounts to access posts and profile data
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card">
        {isLoading ? (
          <div className="px-6 py-8 flex items-center justify-center">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          connections.map((connection) => (
            <PlatformConnectionRow
              key={connection.platform}
              connection={connection}
              workspaceId={workspaceId}
              onRefresh={loadConnections}
            />
          ))
        )}
      </div>
    </div>
  );
}
