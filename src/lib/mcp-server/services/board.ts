import { db } from "@/lib/db";
import {
  workspaces,
  columns,
  issues,
  labels,
  issueLabels,
  cycles,
} from "@/lib/db/schema";
import { eq, asc, inArray } from "drizzle-orm";
import { McpToolError } from "@/lib/mcp-server/errors";
import type { MCPAuthContext } from "./auth-context";
import type { Label } from "@/lib/types";

/**
 * Get a board overview for the connected workspace.
 */
export async function getBoardOverview(ctx: MCPAuthContext) {
  if (!ctx.workspaceId) {
    throw new McpToolError("FORBIDDEN", "No workspace connected");
  }

  const workspaceId = ctx.workspaceId;

  // Parallelize independent queries
  const [workspace, workspaceColumns, workspaceLabels, workspaceCycles] =
    await Promise.all([
      db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .get(),
      db
        .select()
        .from(columns)
        .where(eq(columns.workspaceId, workspaceId))
        .orderBy(asc(columns.position)),
      db
        .select()
        .from(labels)
        .where(eq(labels.workspaceId, workspaceId))
        .orderBy(asc(labels.name)),
      db
        .select()
        .from(cycles)
        .where(eq(cycles.workspaceId, workspaceId))
        .orderBy(asc(cycles.startDate)),
    ]);

  if (!workspace) {
    throw new McpToolError("NOT_FOUND", `Workspace not found: ${workspaceId}`);
  }

  // Batch fetch all issues
  const columnIds = workspaceColumns.map((c) => c.id);
  const allIssues =
    columnIds.length > 0
      ? await db
          .select()
          .from(issues)
          .where(inArray(issues.columnId, columnIds))
          .orderBy(asc(issues.position))
      : [];

  // Batch fetch labels for all issues
  const issueIds = allIssues.map((i) => i.id);
  const allIssueLabelRows =
    issueIds.length > 0
      ? await db
          .select({
            issueId: issueLabels.issueId,
            label: labels,
          })
          .from(issueLabels)
          .innerJoin(labels, eq(issueLabels.labelId, labels.id))
          .where(inArray(issueLabels.issueId, issueIds))
      : [];

  // Build label lookup
  const labelsByIssueId = new Map<
    string,
    Array<{ id: string; name: string; color: string }>
  >();
  for (const row of allIssueLabelRows) {
    const existing = labelsByIssueId.get(row.issueId) ?? [];
    if (!existing.some((l) => l.id === row.label.id)) {
      existing.push({
        id: row.label.id,
        name: row.label.name,
        color: row.label.color,
      });
    }
    labelsByIssueId.set(row.issueId, existing);
  }

  // Format issues
  const formattedIssues = allIssues.map((issue) => ({
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    status: issue.status,
    priority: issue.priority,
    assigneeId: issue.assigneeId,
    labels: labelsByIssueId.get(issue.id) ?? [],
    parentIssueId: issue.parentIssueId,
    columnId: issue.columnId,
  }));

  // Build column -> issues map
  const issuesByColumnId = new Map<string, typeof formattedIssues>();
  for (const issue of formattedIssues) {
    const existing = issuesByColumnId.get(issue.columnId) ?? [];
    existing.push(issue);
    issuesByColumnId.set(issue.columnId, existing);
  }

  const columnsResult = workspaceColumns
    .filter(
      (col) =>
        !col.isSystem || (issuesByColumnId.get(col.id)?.length ?? 0) > 0
    )
    .map((col) => {
      const colIssues = issuesByColumnId.get(col.id) ?? [];
      return {
        name: col.name,
        status: col.status,
        issueCount: colIssues.length,
        issues: colIssues.map(({ columnId: _, ...rest }) => rest),
      };
    });

  return {
    workspace: {
      name: workspace.name,
      slug: workspace.slug,
      purpose: workspace.purpose,
    },
    columns: columnsResult,
    totalIssues: allIssues.length,
    labels: workspaceLabels.map((l) => ({
      id: l.id,
      name: l.name,
      color: l.color,
    })),
    cycles: workspaceCycles.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      startDate: c.startDate?.toISOString() ?? null,
      endDate: c.endDate?.toISOString() ?? null,
    })),
  };
}

/**
 * Create a new label in the connected workspace.
 */
export async function createLabel(
  ctx: MCPAuthContext,
  name: string,
  color: string
): Promise<Label> {
  if (!ctx.workspaceId) {
    throw new McpToolError("FORBIDDEN", "No workspace connected");
  }

  const label: Label = {
    id: crypto.randomUUID(),
    workspaceId: ctx.workspaceId,
    name,
    color,
    createdAt: new Date(),
  };

  await db.insert(labels).values(label);
  return label;
}
