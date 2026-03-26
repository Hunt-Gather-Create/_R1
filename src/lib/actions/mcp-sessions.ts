"use server";

import { db } from "@/lib/db";
import { mcpRefreshTokens } from "@/lib/db/schema";
import { eq, and, gt } from "drizzle-orm";
import { requireWorkspaceAccess } from "./workspace";

export async function getWorkspaceMcpSessions(workspaceId: string) {
  await requireWorkspaceAccess(workspaceId, "admin");

  const sessions = await db
    .select()
    .from(mcpRefreshTokens)
    .where(
      and(
        eq(mcpRefreshTokens.workspaceId, workspaceId),
        gt(mcpRefreshTokens.expiresAt, new Date())
      )
    );

  return sessions.map((s) => ({
    token: s.token,
    clientId: s.clientId,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
  }));
}

export async function revokeMcpSession(
  workspaceId: string,
  tokenId: string
) {
  // Verify admin access
  await requireWorkspaceAccess(workspaceId, "admin");

  await db
    .delete(mcpRefreshTokens)
    .where(
      and(
        eq(mcpRefreshTokens.token, tokenId),
        eq(mcpRefreshTokens.workspaceId, workspaceId)
      )
    );
}
