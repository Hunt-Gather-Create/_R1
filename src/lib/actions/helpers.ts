"use server";

import { db } from "../db";
import { workspaces, columns, issues } from "../db/schema";
import { eq } from "drizzle-orm";

/**
 * Get workspace slug for revalidation paths
 */
export async function getWorkspaceSlug(
  workspaceId: string
): Promise<string | null> {
  const workspace = await db
    .select({ slug: workspaces.slug })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .get();
  return workspace?.slug ?? null;
}

/**
 * Get column by ID
 */
export async function getColumnById(columnId: string) {
  const column = await db
    .select()
    .from(columns)
    .where(eq(columns.id, columnId))
    .get();
  return column ?? null;
}

/**
 * Get workspace ID from an issue ID.
 * Useful for authorization checks and path revalidation.
 */
export async function getWorkspaceIdFromIssue(
  issueId: string
): Promise<string | null> {
  const issue = await db
    .select({ columnId: issues.columnId })
    .from(issues)
    .where(eq(issues.id, issueId))
    .get();

  if (!issue) return null;

  const column = await db
    .select({ workspaceId: columns.workspaceId })
    .from(columns)
    .where(eq(columns.id, issue.columnId))
    .get();

  return column?.workspaceId ?? null;
}
