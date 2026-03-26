import { db } from "@/lib/db";
import { issues, comments, columns } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { McpToolError } from "@/lib/mcp-server/errors";
import type { MCPAuthContext } from "./auth-context";

/**
 * Resolve the workspaceId for a given column.
 */
async function getColumnWorkspaceId(columnId: string): Promise<string> {
  const col = await db
    .select({ workspaceId: columns.workspaceId })
    .from(columns)
    .where(eq(columns.id, columnId))
    .get();

  if (!col) {
    throw new McpToolError("NOT_FOUND", "Column not found");
  }
  return col.workspaceId;
}

/**
 * Add a comment to an issue.
 */
export async function addComment(
  ctx: MCPAuthContext,
  issueId: string,
  body: string
) {
  if (!ctx.workspaceId) {
    throw new McpToolError("FORBIDDEN", "No workspace connected");
  }

  const issue = await db
    .select()
    .from(issues)
    .where(eq(issues.id, issueId))
    .get();

  if (!issue) {
    throw new McpToolError("NOT_FOUND", `Issue not found: ${issueId}`);
  }

  const workspaceId = await getColumnWorkspaceId(issue.columnId);

  if (ctx.workspaceId !== workspaceId) {
    throw new McpToolError("FORBIDDEN", "Issue does not belong to the connected workspace");
  }

  const now = new Date();
  const comment = {
    id: crypto.randomUUID(),
    issueId,
    userId: ctx.userId,
    body,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(comments).values(comment);

  // Update issue's updatedAt
  await db
    .update(issues)
    .set({ updatedAt: now })
    .where(eq(issues.id, issueId));

  return {
    id: comment.id,
    issueId,
    body: comment.body,
    createdAt: comment.createdAt,
  };
}
