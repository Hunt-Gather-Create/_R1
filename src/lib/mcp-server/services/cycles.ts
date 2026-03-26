import { db } from "@/lib/db";
import { cycles, issues } from "@/lib/db/schema";
import { eq, asc, inArray } from "drizzle-orm";
import { McpToolError } from "@/lib/mcp-server/errors";
import type { MCPAuthContext } from "./auth-context";

/**
 * List cycles/sprints for the connected workspace with optional issue counts.
 */
export async function listCycles(
  ctx: MCPAuthContext,
  includeIssues: boolean = false
) {
  if (!ctx.workspaceId) {
    throw new McpToolError("FORBIDDEN", "No workspace connected");
  }

  const workspaceCycles = await db
    .select()
    .from(cycles)
    .where(eq(cycles.workspaceId, ctx.workspaceId))
    .orderBy(asc(cycles.startDate));

  if (!includeIssues) {
    return {
      cycles: workspaceCycles.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        status: c.status,
        startDate: c.startDate?.toISOString() ?? null,
        endDate: c.endDate?.toISOString() ?? null,
      })),
    };
  }

  // Count issues per cycle
  const cycleIds = workspaceCycles.map((c) => c.id);
  const cycleIssues =
    cycleIds.length > 0
      ? await db
          .select({
            cycleId: issues.cycleId,
            id: issues.id,
          })
          .from(issues)
          .where(inArray(issues.cycleId, cycleIds))
      : [];

  const issueCountMap = new Map<string, number>();
  for (const issue of cycleIssues) {
    if (issue.cycleId) {
      issueCountMap.set(
        issue.cycleId,
        (issueCountMap.get(issue.cycleId) ?? 0) + 1
      );
    }
  }

  return {
    cycles: workspaceCycles.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      status: c.status,
      startDate: c.startDate?.toISOString() ?? null,
      endDate: c.endDate?.toISOString() ?? null,
      issueCount: issueCountMap.get(c.id) ?? 0,
    })),
  };
}
