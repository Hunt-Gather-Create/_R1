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
import { eq, asc } from "drizzle-orm";
import type { WorkspaceWithColumnsAndIssues, Label } from "../types";
import { requireWorkspaceAccess } from "./workspace";

// Get workspace with issues (requires authentication)
export async function getWorkspaceWithIssues(
  workspaceId: string
): Promise<WorkspaceWithColumnsAndIssues> {
  // Verify user has access
  await requireWorkspaceAccess(workspaceId);

  const workspace = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .get();

  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  const workspaceColumns = await db
    .select()
    .from(columns)
    .where(eq(columns.workspaceId, workspaceId))
    .orderBy(asc(columns.position));

  // Get all labels for this workspace
  const workspaceLabels = await db
    .select()
    .from(labels)
    .where(eq(labels.workspaceId, workspaceId))
    .orderBy(asc(labels.name));

  // Get all cycles for this workspace
  const workspaceCycles = await db
    .select()
    .from(cycles)
    .where(eq(cycles.workspaceId, workspaceId))
    .orderBy(asc(cycles.startDate));

  const columnsWithIssues = await Promise.all(
    workspaceColumns.map(async (column) => {
      const columnIssues = await db
        .select()
        .from(issues)
        .where(eq(issues.columnId, column.id))
        .orderBy(asc(issues.position));

      // Get labels for each issue
      const issuesWithLabels = await Promise.all(
        columnIssues.map(async (issue) => {
          const issueLabelRows = await db
            .select({ label: labels })
            .from(issueLabels)
            .innerJoin(labels, eq(issueLabels.labelId, labels.id))
            .where(eq(issueLabels.issueId, issue.id));

          // Deduplicate labels by id (defensive against bad data)
          const uniqueLabels = issueLabelRows.reduce(
            (acc, row) => {
              if (!acc.some((l) => l.id === row.label.id)) {
                acc.push(row.label);
              }
              return acc;
            },
            [] as (typeof issueLabelRows)[number]["label"][]
          );

          return {
            ...issue,
            labels: uniqueLabels,
          };
        })
      );

      return {
        ...column,
        issues: issuesWithLabels,
      };
    })
  );

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
