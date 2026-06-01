"use server";

/**
 * Runway server actions — thin wrappers the UI invokes directly.
 * Keep logic in `@/lib/runway/*`; these files just bridge the boundary.
 */

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import {
  setViewPreferences,
  type RunwayViewPreferences,
} from "@/lib/runway/view-preferences";
import { getRunwayDb } from "@/lib/db/runway";
import { weekItems } from "@/lib/db/runway-schema";
import { updateWeekItemField } from "@/lib/runway/operations-writes-week";
import type {
  SetWeekItemStatusResult,
  UpdateWeekItemFieldsResult,
  WeekItemEditPatch,
  WeekItemEditableField,
} from "./action-types";

/**
 * Toggle the In Flight section (chunk 3 #6). Persisted under the global
 * scope in the Runway DB's `view_preferences` table. Returns the updated
 * preferences so the client can optimistically reconcile.
 */
export async function toggleInFlightAction(
  next: boolean
): Promise<RunwayViewPreferences> {
  const prefs = await setViewPreferences({ inFlightToggle: next });
  revalidatePath("/runway");
  return prefs;
}

/**
 * Toggle the Needs Update section. Mirrors toggleInFlightAction.
 */
export async function toggleNeedsUpdateAction(
  next: boolean
): Promise<RunwayViewPreferences> {
  const prefs = await setViewPreferences({ needsUpdateToggle: next });
  revalidatePath("/runway");
  return prefs;
}

/**
 * #9 / partial #67 — card checkbox + undo. Sets a week item's `status`
 * via the canonical `updateWeekItemField` helper (so validators, status /
 * category compatibility, and audit logging fire identically to the Slack
 * + MCP paths) but resolves the row by id since the dashboard cards carry
 * the id, not the composite `(weekOf, title)` key.
 *
 * Returns the row's previous status so the client can capture it in the
 * undo toast closure and replay the same action with `newStatus =
 * previousStatus` if the user reverts.
 */
export async function setWeekItemStatusAction(input: {
  weekItemId: string;
  newStatus: string | null;
}): Promise<SetWeekItemStatusResult> {
  const db = getRunwayDb();
  const rows = await db
    .select()
    .from(weekItems)
    .where(eq(weekItems.id, input.weekItemId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return { ok: false, error: `Week item '${input.weekItemId}' not found.` };
  }
  // weekOf is nullable in the schema but updateWeekItemField requires a
  // non-null composite key. Any week item reachable from the dashboard
  // checkbox is anchored on a Monday, so this should never fire in prod —
  // it's here purely so TS strict-check is satisfied without the cast.
  if (!row.weekOf) {
    return {
      ok: false,
      error: `Week item '${input.weekItemId}' has no weekOf anchor.`,
    };
  }
  const previousStatus = row.status;
  const result = await updateWeekItemField({
    weekOf: row.weekOf,
    weekItemTitle: row.title,
    field: "status",
    newValue: input.newStatus,
    updatedBy: "runway:dashboard",
    source: "dashboard",
  });
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath("/runway");
  return { ok: true, previousStatus };
}

/**
 * #70 — dashboard L2 edit modal save handler.
 *
 * Multi-field wrapper around updateWeekItemField. Looks up the row by id,
 * captures the pre-write value for every changed field (so the modal's
 * undo toast can replay the inverse), then applies each change via the
 * canonical helper one field at a time (so validators, status / category
 * compatibility, audit logging fire identically to the Slack + MCP paths).
 *
 * Field ordering follows the slack-modal-submit pattern: when BOTH
 * startDate and endDate change, write the side compatible with the row's
 * current other side first so the per-field cross-date guard doesn't trip
 * on an intermediate state. `title` writes LAST when changed (it's a
 * lookup key — subsequent field writes inside this same call still need
 * the original title to resolve the row).
 *
 * Returns `previousValues` so the modal can pin the inverse for undo.
 */
export async function updateWeekItemFieldsAction(input: {
  weekItemId: string;
  updatedBy: string;
  fields: WeekItemEditPatch;
}): Promise<UpdateWeekItemFieldsResult> {
  const db = getRunwayDb();
  const rows = await db
    .select()
    .from(weekItems)
    .where(eq(weekItems.id, input.weekItemId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return { ok: false, error: `Week item '${input.weekItemId}' not found.` };
  }
  if (!row.weekOf) {
    return {
      ok: false,
      error: `Week item '${input.weekItemId}' has no weekOf anchor.`,
    };
  }

  const changed = (
    Object.keys(input.fields) as WeekItemEditableField[]
  ).filter((k) => input.fields[k] !== undefined);
  if (changed.length === 0) {
    return { ok: true, previousValues: {} };
  }

  const previousValues: WeekItemEditPatch = {};
  for (const field of changed) {
    const cur = (row as Record<string, unknown>)[field];
    previousValues[field] = cur == null ? null : String(cur);
  }

  const ordered = orderFieldsForDashboardSave(changed, row, input.fields);

  // weekItemTitle is the lookup key — capture the title BEFORE any write
  // that might mutate it, then thread the in-flight title through subsequent
  // writes so the row keeps resolving even if title changed mid-batch.
  let currentTitle = row.title;
  for (const field of ordered) {
    const newValue = input.fields[field] ?? null;
    const result = await updateWeekItemField({
      weekOf: row.weekOf,
      weekItemTitle: currentTitle,
      field,
      newValue,
      updatedBy: input.updatedBy,
      source: "dashboard",
    });
    if (!result.ok) return { ok: false, error: result.error };
    if (field === "title" && typeof newValue === "string") {
      currentTitle = newValue;
    }
  }
  revalidatePath("/runway");
  return { ok: true, previousValues };
}

/**
 * Sort changed-field list so per-field validators in updateWeekItemField
 * don't trip on intermediate state. Mirrors slack-modal-submit's
 * orderFieldsForDateGuard, plus `title` always last (lookup key).
 */
function orderFieldsForDashboardSave(
  changed: WeekItemEditableField[],
  row: { startDate: string | null; endDate: string | null },
  fields: WeekItemEditPatch,
): WeekItemEditableField[] {
  const nonTitle = changed.filter((f) => f !== "title");
  const hasTitle = changed.includes("title");

  const startChanged = nonTitle.includes("startDate");
  const endChanged = nonTitle.includes("endDate");
  let ordered = nonTitle;
  if (startChanged && endChanged) {
    const newStart = fields.startDate ?? null;
    const newEnd = fields.endDate ?? null;
    const curStart = row.startDate;
    const curEnd = row.endDate;
    if (newStart && newEnd && curStart && curEnd) {
      const startSafeFirst = newStart <= curEnd;
      const endSafeFirst = newEnd >= curStart;
      if (startSafeFirst && !endSafeFirst) {
        ordered = moveFirst(nonTitle, "startDate", "endDate");
      } else if (endSafeFirst && !startSafeFirst) {
        ordered = moveFirst(nonTitle, "endDate", "startDate");
      }
    }
  }
  return hasTitle ? [...ordered, "title"] : ordered;
}

function moveFirst<T>(arr: T[], first: T, second: T): T[] {
  const rest = arr.filter((x) => x !== first && x !== second);
  return [first, second, ...rest];
}
