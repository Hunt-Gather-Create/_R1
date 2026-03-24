import { db } from "@/lib/db";
import { users, workspaceMembers, workspaces } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { verifyAccessToken } from "./token";
import type { MCPAuthContext } from "../services/auth-context";
import { McpToolError } from "../errors";
import type { WorkspaceRole } from "@/lib/types";

/**
 * Authenticate an MCP request by extracting and verifying the Bearer token.
 */
export async function authenticateMCPRequest(
  request: Request
): Promise<MCPAuthContext> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new McpToolError(
      "UNAUTHORIZED",
      "Missing or invalid Authorization header"
    );
  }

  const token = authHeader.slice(7);

  let payload: Awaited<ReturnType<typeof verifyAccessToken>>;
  try {
    payload = await verifyAccessToken(token);
  } catch {
    throw new McpToolError("UNAUTHORIZED", "Invalid or expired access token");
  }

  const ctx = {
    userId: payload.userId,
    workspaceId: payload.workspaceId,
  };

  if (ctx.workspaceId) {
    await requireMCPWorkspaceAccess(ctx, "viewer");
  }

  return ctx;
}

/**
 * Assert that the given workspaceId matches the token's workspace scope.
 */
export function assertWorkspaceInScope(
  ctx: MCPAuthContext,
  workspaceId: string
): void {
  if (!ctx.workspaceId) {
    throw new McpToolError(
      "FORBIDDEN",
      "No workspace was selected during authorization"
    );
  }
  if (ctx.workspaceId !== workspaceId) {
    throw new McpToolError(
      "FORBIDDEN",
      "Access to this workspace was not granted during authorization"
    );
  }
}

const ROLE_HIERARCHY: Record<WorkspaceRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
};

/**
 * Verify the user has access to the connected workspace with an optional minimum role.
 * Uses ctx.workspaceId (the single workspace from the token).
 */
export async function requireMCPWorkspaceAccess(
  ctx: MCPAuthContext,
  minimumRole: WorkspaceRole = "viewer"
): Promise<{
  user: typeof users.$inferSelect;
  member: typeof workspaceMembers.$inferSelect;
  workspace: typeof workspaces.$inferSelect;
}> {
  if (!ctx.workspaceId) {
    throw new McpToolError(
      "FORBIDDEN",
      "No workspace was selected during authorization"
    );
  }

  // Get user
  const user = await db
    .select()
    .from(users)
    .where(eq(users.id, ctx.userId))
    .get();

  if (!user) {
    throw new McpToolError("UNAUTHORIZED", "User not found");
  }

  if (user.status !== "active") {
    throw new McpToolError("FORBIDDEN", "User account is not active");
  }

  // Check workspace membership
  const member = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, ctx.workspaceId),
        eq(workspaceMembers.userId, ctx.userId)
      )
    )
    .get();

  if (!member) {
    throw new McpToolError(
      "FORBIDDEN",
      "You are not a member of this workspace"
    );
  }

  // Check role hierarchy
  const userLevel = ROLE_HIERARCHY[member.role as WorkspaceRole] ?? 0;
  const requiredLevel = ROLE_HIERARCHY[minimumRole] ?? 0;
  if (userLevel < requiredLevel) {
    throw new McpToolError(
      "FORBIDDEN",
      `Requires ${minimumRole} role or higher`
    );
  }

  const workspace = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, ctx.workspaceId))
    .get();

  if (!workspace) {
    throw new McpToolError("NOT_FOUND", "Workspace not found");
  }

  return { user, member, workspace };
}
