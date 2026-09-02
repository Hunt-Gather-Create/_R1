/**
 * Shared subtask exclusion helpers, refs _R1#67 phase 1.
 *
 * A subtask is a week_items row with parentTaskId set. Every read that
 * assumes a week_items row is a top-level work item must exclude
 * parentTaskId IS NOT NULL. Centralized here so every read site uses the
 * identical predicate rather than reimplementing "not a subtask" ad hoc,
 * the same reasoning weekItemsForSection already applies to the terminal
 * status filter.
 */

import { isNull, type SQL } from "drizzle-orm";
import { weekItems } from "@/lib/db/runway-schema";

/** Drizzle WHERE fragment: parentTaskId IS NULL, i.e. not a subtask. */
export const notASubtask: SQL = isNull(weekItems.parentTaskId);

/**
 * Filters a plain array of already-fetched week_items rows down to
 * top-level rows, dropping any row whose own parentTaskId is set. For read
 * sites that filter in JS after the query rather than in SQL.
 */
export function excludeSubtasks<T extends { parentTaskId?: string | null }>(
  rows: T[],
): T[] {
  return rows.filter((r) => !r.parentTaskId);
}
