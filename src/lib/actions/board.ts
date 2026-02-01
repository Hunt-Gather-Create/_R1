"use server";

import { db } from "../db";
import {
  workspaces,
  columns,
  issues,
  labels,
  issueLabels,
  cycles,
} from "../db/schema";
import { eq, asc, inArray } from "drizzle-orm";
import type { WorkspaceWithColumnsAndIssues, Label } from "../types";
import { requireWorkspaceAccess } from "./workspace";

// Get workspace with issues (requires authentication)
export async function getWorkspaceWithIssues(
  workspaceId: string
): Promise<WorkspaceWithColumnsAndIssues> {
  // Verify user has access
  await requireWorkspaceAccess(workspaceId);

  // Parallelize independent queries (async-parallel rule)
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
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  // Get column IDs for batch query
  const columnIds = workspaceColumns.map((c) => c.id);

  // Batch fetch all issues for all columns in one query
  const allIssues =
    columnIds.length > 0
      ? await db
          .select()
          .from(issues)
          .where(inArray(issues.columnId, columnIds))
          .orderBy(asc(issues.position))
      : [];

  // Batch fetch all labels for all issues in one query (fixes N+1)
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

  // Build a map of issueId -> labels for O(1) lookup (js-index-maps rule)
  const labelsByIssueId = new Map<string, typeof workspaceLabels>();
  for (const row of allIssueLabelRows) {
    const existing = labelsByIssueId.get(row.issueId);
    if (existing) {
      // Deduplicate by label id
      if (!existing.some((l) => l.id === row.label.id)) {
        existing.push(row.label);
      }
    } else {
      labelsByIssueId.set(row.issueId, [row.label]);
    }
  }

  // Build a map of columnId -> issues for O(1) lookup
  const issuesByColumnId = new Map<
    string,
    Array<(typeof allIssues)[number] & { labels: typeof workspaceLabels }>
  >();
  for (const issue of allIssues) {
    const issueWithLabels = {
      ...issue,
      labels: labelsByIssueId.get(issue.id) ?? [],
    };
    const existing = issuesByColumnId.get(issue.columnId);
    if (existing) {
      existing.push(issueWithLabels);
    } else {
      issuesByColumnId.set(issue.columnId, [issueWithLabels]);
    }
  }

  // Assemble columns with their issues
  const columnsWithIssues = workspaceColumns.map((column) => ({
    ...column,
    issues: issuesByColumnId.get(column.id) ?? [],
  }));

  // Filter out empty system columns (e.g., orphaned column with no issues)
  const visibleColumns = columnsWithIssues.filter(
    (col) => !col.isSystem || col.issues.length > 0
  );

  return {
    ...workspace,
    columns: visibleColumns,
    labels: workspaceLabels,
    cycles: workspaceCycles,
  };
}

// Get workspace by slug with issues (public helper - doesn't check auth, caller should)
export async function getWorkspaceBySlugWithIssues(
  slug: string
): Promise<WorkspaceWithColumnsAndIssues | null> {
  const workspace = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, slug))
    .get();

  if (!workspace) {
    return null;
  }

  // Delegate to the main function which handles auth
  return getWorkspaceWithIssues(workspace.id);
}

// Label management
export async function createLabel(
  workspaceId: string,
  name: string,
  color: string
): Promise<Label> {
  await requireWorkspaceAccess(workspaceId, "member");

  const label = {
    id: crypto.randomUUID(),
    workspaceId,
    name,
    color,
    createdAt: new Date(),
  };

  await db.insert(labels).values(label);
  return label;
}

export async function updateLabel(
  labelId: string,
  data: { name?: string; color?: string }
): Promise<void> {
  // Get the label first to check workspace access
  const label = await db
    .select()
    .from(labels)
    .where(eq(labels.id, labelId))
    .get();
  if (!label) throw new Error("Label not found");

  await requireWorkspaceAccess(label.workspaceId, "member");
  await db.update(labels).set(data).where(eq(labels.id, labelId));
}

export async function deleteLabel(labelId: string): Promise<void> {
  const label = await db
    .select()
    .from(labels)
    .where(eq(labels.id, labelId))
    .get();
  if (!label) throw new Error("Label not found");

  await requireWorkspaceAccess(label.workspaceId, "admin");
  await db.delete(labels).where(eq(labels.id, labelId));
}

export async function getWorkspaceLabels(
  workspaceId: string
): Promise<Label[]> {
  await requireWorkspaceAccess(workspaceId);

  return db
    .select()
    .from(labels)
    .where(eq(labels.workspaceId, workspaceId))
    .orderBy(asc(labels.name));
}
