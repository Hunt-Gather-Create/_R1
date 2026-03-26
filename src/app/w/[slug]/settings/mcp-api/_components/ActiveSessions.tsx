"use client";

import { useCallback, useEffect, useState } from "react";
import { getWorkspaceMcpSessions, revokeMcpSession } from "@/lib/actions/mcp-sessions";
import { Trash2 } from "lucide-react";

interface Session {
  token: string;
  clientId: string;
  createdAt: Date | null;
  expiresAt: Date;
}

export function ActiveSessions({ workspaceId }: { workspaceId: string }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const data = await getWorkspaceMcpSessions(workspaceId);
      setSessions(data);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  async function handleRevoke(tokenId: string) {
    if (!window.confirm("Revoke this MCP session? The client will need to re-authenticate.")) {
      return;
    }
    setRevoking(tokenId);
    try {
      await revokeMcpSession(workspaceId, tokenId);
      setSessions((prev) => prev.filter((s) => s.token !== tokenId));
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-foreground mb-2">
        Active Sessions
      </h2>
      <p className="text-sm text-muted-foreground mb-4">
        MCP clients with active refresh tokens for this workspace.
      </p>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading sessions...</div>
      ) : sessions.length === 0 ? (
        <div className="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          No active MCP sessions
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">
                  Client
                </th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">
                  Created
                </th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">
                  Expires
                </th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr
                  key={session.token}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-4 py-2.5 font-mono text-xs">
                    {session.clientId}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {session.createdAt
                      ? new Date(session.createdAt).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {new Date(session.expiresAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => handleRevoke(session.token)}
                      disabled={revoking === session.token}
                      className="p-1 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                      title="Revoke session"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
