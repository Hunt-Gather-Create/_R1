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
import type { WeekItemRow } from "@/lib/runway/gantt/types";
import {
  updateWeekItemField,
  linkWeekItemToProject,
} from "@/lib/runway/operations-writes-week";
import type {
  SetWeekItemStatusResult,
  UpdateWeekItemFieldsInput,
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
 * Two-track wrapper:
 *   - String fields (title, owner, resources, startDate, endDate,
 *     dayOfWeek, status, notes) route through `updateWeekItemField` one
 *     field at a time so validators, status / category compatibility,
 *     and audit logging fire identically to the Slack + MCP paths.
 *   - `projectId` (re-parenting) routes through `linkWeekItemToProject`
 *     instead — it carries a client-mismatch guard, a cascading recompute
 *     of both source + destination project date envelopes, and its own
 *     audit shape (`updateType: 'week-reparent'`). Routing it through
 *     `updateWeekItemField` would either bypass those (correctness break)
 *     or hit the field validators that don't accept it.
 *
 * Ordering: fields write FIRST, then projectId. A failure inside the
 * field-write loop short-circuits before the project move; a failure
 * inside `linkWeekItemToProject` leaves the field writes already
 * applied. Partial-failure rollback is out of scope for v1 — the modal
 * surfaces the error and the user retries.
 *
 * Field ordering inside the field-write loop follows the
 * slack-modal-submit pattern: when BOTH startDate and endDate change,
 * write the side compatible with the row's current other side first so
 * the per-field cross-date guard doesn't trip on an intermediate state.
 * `title` writes LAST when changed (it's a lookup key — subsequent field
 * writes inside this same call still need the original title to resolve
 * the row).
 *
 * Server-side validators (P1.1 from TP review on b7c89f3) defend against
 * client-side drift: dayOfWeek must be one of the lowercase work-week
 * values, title and owner must be non-empty when included. These mirror
 * the modal's client-side guards but cannot trust the client per
 * `feedback_sheet_authority_cuts_both_ways` + `feedback_dayofweek_lowercase`.
 *
 * Returns `previousValues` (per-field pre-write snapshot) and
 * `previousProjectId` (when projectId was included) so the modal's undo
 * toast can replay the inverse via a second call with the previous values.
 */
export async function updateWeekItemFieldsAction(
  input: UpdateWeekItemFieldsInput,
): Promise<UpdateWeekItemFieldsResult> {
  // P1.1 — server-side guardrails. The client modal validates these too
  // but cannot be trusted (per `feedback_sheet_authority_cuts_both_ways`).
  const guard = validateFieldsServerSide(input.fields);
  if (!guard.ok) return guard;
  const fields = guard.fields;

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
    Object.keys(fields) as WeekItemEditableField[]
  ).filter((k) => fields[k] !== undefined);

  const projectIdProvided = Object.prototype.hasOwnProperty.call(
    input,
    "projectId",
  );
  const newProjectId = input.projectId;

  if (changed.length === 0 && !projectIdProvided) {
    return { ok: true, previousValues: {} };
  }

  const previousValues: WeekItemEditPatch = {};
  for (const field of changed) {
    previousValues[field] = capturePreviousValue(row, field);
  }

  const ordered = orderFieldsForDashboardSave(changed, row, fields);

  // weekItemTitle is the lookup key — capture the title BEFORE any write
  // that might mutate it, then thread the in-flight title through subsequent
  // writes so the row keeps resolving even if title changed mid-batch.
  let currentTitle = row.title;
  for (const field of ordered) {
    const newValue = fields[field] ?? null;
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

  // Re-parenting runs last so a field-write failure short-circuits before
  // touching the project. `linkWeekItemToProject` has its own client-mismatch
  // guard + cascading recompute + idempotency check.
  let previousProjectId: string | null | undefined;
  if (projectIdProvided && newProjectId) {
    previousProjectId = row.projectId ?? null;
    if (previousProjectId !== newProjectId) {
      const linkResult = await linkWeekItemToProject({
        weekItemId: input.weekItemId,
        projectId: newProjectId,
        updatedBy: input.updatedBy,
      });
      if (!linkResult.ok) return { ok: false, error: linkResult.error };
    }
  }

  revalidatePath("/runway");
  return projectIdProvided
    ? { ok: true, previousValues, previousProjectId }
    : { ok: true, previousValues };
}

/**
 * Typed per-field snapshot used to capture pre-write values for the
 * modal's undo toast. The switch is exhaustive over
 * `WeekItemEditableField` — adding a new editable field surfaces here
 * at compile time (P2 nit per TP review on b7c89f3).
 */
function capturePreviousValue(
  row: WeekItemRow,
  field: WeekItemEditableField,
): string | null {
  switch (field) {
    case "title":
      return row.title;
    case "owner":
      return row.owner ?? null;
    case "resources":
      return row.resources ?? null;
    case "startDate":
      return row.startDate ?? null;
    case "endDate":
      return row.endDate ?? null;
    case "dayOfWeek":
      return row.dayOfWeek ?? null;
    case "status":
      return row.status ?? null;
    case "notes":
      return row.notes ?? null;
  }
}

/**
 * Lowercase work-week days the dashboard's day-of-week dropdown can
 * write. Saturday + Sunday are intentionally excluded — Runway doesn't
 * schedule weekend work and accepting them would let a typo bypass the
 * UI's Mon-Fri options.
 */
const ALLOWED_DAYS_OF_WEEK = new Set([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
]);

type ValidateFieldsResult =
  | { ok: true; fields: WeekItemEditPatch }
  | { ok: false; error: string };

function validateFieldsServerSide(
  fields: WeekItemEditPatch,
): ValidateFieldsResult {
  const out: WeekItemEditPatch = { ...fields };

  if (Object.prototype.hasOwnProperty.call(out, "title")) {
    const v = out.title;
    if (typeof v !== "string" || v.trim() === "") {
      return { ok: false, error: "Title is required." };
    }
    out.title = v.trim();
  }
  if (Object.prototype.hasOwnProperty.call(out, "owner")) {
    const v = out.owner;
    if (typeof v !== "string" || v.trim() === "") {
      return { ok: false, error: "Owner is required." };
    }
    out.owner = v.trim();
  }
  if (Object.prototype.hasOwnProperty.call(out, "dayOfWeek")) {
    const raw = out.dayOfWeek;
    if (typeof raw !== "string" || raw.trim() === "") {
      return {
        ok: false,
        error: `dayOfWeek must be one of: ${[...ALLOWED_DAYS_OF_WEEK].join(", ")}.`,
      };
    }
    // Normalize per `feedback_dayofweek_lowercase` — drafters frequently
    // title-case from spec prose; no existing validator catches the drift.
    const normalized = raw.trim().toLowerCase();
    if (!ALLOWED_DAYS_OF_WEEK.has(normalized)) {
      return {
        ok: false,
        error: `dayOfWeek must be one of: ${[...ALLOWED_DAYS_OF_WEEK].join(", ")}.`,
      };
    }
    out.dayOfWeek = normalized;
  }
  return { ok: true, fields: out };
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
