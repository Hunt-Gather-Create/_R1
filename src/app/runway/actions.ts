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
export type SetWeekItemStatusResult =
  | { ok: true; previousStatus: string | null }
  | { ok: false; error: string };

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
