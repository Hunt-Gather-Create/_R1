"use server";

import { revalidatePath } from "next/cache";
import { db } from "../db";
import { columns, issues } from "../db/schema";
import { eq, and, asc, sql, max, inArray } from "drizzle-orm";
import type { Column } from "../types";
import { requireWorkspaceAccess } from "./workspace";
import { getWorkspaceSlug, getColumnById } from "./helpers";

const ORPHANED_COLUMN_NAME = "Orphaned";

/**
 * Get all non-system columns for a workspace (used in settings)
 */
export async function getWorkspaceColumns(
  workspaceId: string
): Promise<Column[]> {
  await requireWorkspaceAccess(workspaceId);

  return db
    .select()
    .from(columns)
    .where(
      and(eq(columns.workspaceId, workspaceId), eq(columns.isSystem, false))
    )
    .orderBy(asc(columns.position));
}

/**
 * Get all columns including system columns (used in settings to show orphaned)
 */
export async function getAllWorkspaceColumns(
  workspaceId: string
): Promise<Column[]> {
  await requireWorkspaceAccess(workspaceId);

  return db
    .select()
    .from(columns)
    .where(eq(columns.workspaceId, workspaceId))
    .orderBy(asc(columns.position));
}

/**
 * Create a new column
 */
export async function createColumn(
  workspaceId: string,
  name: string,
  position?: number
): Promise<Column> {
  await requireWorkspaceAccess(workspaceId, "member");

  // If position not provided, add at the end
  let finalPosition = position;
  if (finalPosition === undefined) {
    const result = await db
      .select({ maxPos: max(columns.position) })
      .from(columns)
      .where(
        and(eq(columns.workspaceId, workspaceId), eq(columns.isSystem, false))
      )
      .get();
    finalPosition = (result?.maxPos ?? -1) + 1;
  }

  const column: Column = {
    id: crypto.randomUUID(),
    workspaceId,
    name,
    position: finalPosition,
    isSystem: false,
  };

  await db.insert(columns).values(column);

  const slug = await getWorkspaceSlug(workspaceId);
  revalidatePath(slug ? `/w/${slug}` : "/");

  return column;
}

/**
 * Update a column's name
 */
export async function updateColumn(
  columnId: string,
  data: { name?: string }
): Promise<void> {
  const column = await getColumnById(columnId);
  if (!column) throw new Error("Column not found");

  // Prevent editing system columns
  if (column.isSystem) {
    throw new Error("Cannot edit system columns");
  }

  await requireWorkspaceAccess(column.workspaceId, "member");

  if (data.name !== undefined) {
    await db
      .update(columns)
      .set({ name: data.name })
      .where(eq(columns.id, columnId));
  }

  const slug = await getWorkspaceSlug(column.workspaceId);
  revalidatePath(slug ? `/w/${slug}` : "/");
}

/**
 * Reorder columns by providing an array of column IDs in the desired order
 */
export async function reorderColumns(
  workspaceId: string,
  columnIds: string[]
): Promise<void> {
  await requireWorkspaceAccess(workspaceId, "member");

  // Update positions in order
  for (let i = 0; i < columnIds.length; i++) {
    await db
      .update(columns)
      .set({ position: i })
      .where(and(eq(columns.id, columnIds[i]), eq(columns.isSystem, false)));
  }

  const slug = await getWorkspaceSlug(workspaceId);
  revalidatePath(slug ? `/w/${slug}` : "/");
}

/**
 * Get or create the orphaned column for a workspace
 */
export async function getOrCreateOrphanedColumn(
  workspaceId: string
): Promise<Column> {
  // Check if orphaned column already exists
  const existingOrphaned = await db
    .select()
    .from(columns)
    .where(
      and(
        eq(columns.workspaceId, workspaceId),
        eq(columns.isSystem, true),
        eq(columns.name, ORPHANED_COLUMN_NAME)
      )
    )
    .get();

  if (existingOrphaned) {
    return existingOrphaned;
  }

  // Get max position for placement at the end
  const result = await db
    .select({ maxPos: max(columns.position) })
    .from(columns)
    .where(eq(columns.workspaceId, workspaceId))
    .get();

  const column: Column = {
    id: crypto.randomUUID(),
    workspaceId,
    name: ORPHANED_COLUMN_NAME,
    position: (result?.maxPos ?? -1) + 1,
    isSystem: true,
  };

  await db.insert(columns).values(column);
  return column;
}

/**
 * Delete a column - moves issues to orphaned column if any exist
 */
export async function deleteColumn(columnId: string): Promise<void> {
  const column = await getColumnById(columnId);
  if (!column) throw new Error("Column not found");

  // Prevent deleting system columns
  if (column.isSystem) {
    throw new Error("Cannot delete system columns");
  }

  await requireWorkspaceAccess(column.workspaceId, "admin");

  // Check if column has issues
  const columnIssues = await db
    .select({ id: issues.id })
    .from(issues)
    .where(eq(issues.columnId, columnId));

  if (columnIssues.length > 0) {
    // Get or create orphaned column
    const orphanedColumn = await getOrCreateOrphanedColumn(column.workspaceId);

    // Get current max position in orphaned column
    const maxPosResult = await db
      .select({ maxPos: sql<number>`COALESCE(MAX(position), -1)` })
      .from(issues)
      .where(eq(issues.columnId, orphanedColumn.id))
      .get();

    let nextPosition = (maxPosResult?.maxPos ?? -1) + 1;

    // Move all issues to orphaned column
    for (const issue of columnIssues) {
      await db
        .update(issues)
        .set({ columnId: orphanedColumn.id, position: nextPosition })
        .where(eq(issues.id, issue.id));
      nextPosition++;
    }
  }

  // Delete the column
  await db.delete(columns).where(eq(columns.id, columnId));

  // Update positions of remaining non-system columns
  const remainingColumns = await db
    .select()
    .from(columns)
    .where(
      and(
        eq(columns.workspaceId, column.workspaceId),
        eq(columns.isSystem, false)
      )
    )
    .orderBy(asc(columns.position));

  for (let i = 0; i < remainingColumns.length; i++) {
    await db
      .update(columns)
      .set({ position: i })
      .where(eq(columns.id, remainingColumns[i].id));
  }

  const slug = await getWorkspaceSlug(column.workspaceId);
  revalidatePath(slug ? `/w/${slug}` : "/");
}

/**
 * Get issue counts for multiple columns (batch query for efficiency)
 */
export async function getColumnIssueCounts(
  columnIds: string[]
): Promise<Record<string, number>> {
  if (columnIds.length === 0) return {};

  const results = await db
    .select({
      columnId: issues.columnId,
      count: sql<number>`COUNT(*)`,
    })
    .from(issues)
    .where(inArray(issues.columnId, columnIds))
    .groupBy(issues.columnId);

  const counts: Record<string, number> = {};
  // Initialize all columns with 0
  for (const id of columnIds) {
    counts[id] = 0;
  }
  // Fill in actual counts
  for (const row of results) {
    counts[row.columnId] = row.count;
  }
  return counts;
}
