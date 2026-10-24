"use server";

/**
 * Runway view-preferences server actions. Each one checks the password gate
 * first. The ungated read and the stored shape live in view-preferences-read.ts.
 */

import { getRunwayDb } from "@/lib/db/runway";
import { viewPreferences } from "@/lib/db/runway-schema";
import { requireRunwayGate } from "@/lib/runway/require-gate";
import {
  GLOBAL_SCOPE,
  readViewPreferences,
  type RunwayViewPreferences as StoredViewPreferences,
} from "@/lib/runway/view-preferences-read";
import { eq } from "drizzle-orm";

export type RunwayViewPreferences = StoredViewPreferences;

export async function getViewPreferences(
  scope: string = GLOBAL_SCOPE
): Promise<RunwayViewPreferences> {
  await requireRunwayGate();
  return readViewPreferences(scope);
}

/**
 * Merge partial updates into the existing preferences row and persist.
 * Creates the row on first write. Returns the resulting full object so
 * callers can update local state without a second round-trip.
 */
export async function setViewPreferences(
  patch: Partial<RunwayViewPreferences>,
  scope: string = GLOBAL_SCOPE
): Promise<RunwayViewPreferences> {
  await requireRunwayGate();
  const current = await readViewPreferences(scope);
  const next = { ...current, ...patch };

  try {
    const db = getRunwayDb();
    const existing = await db
      .select()
      .from(viewPreferences)
      .where(eq(viewPreferences.scope, scope))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(viewPreferences).values({
        scope,
        preferences: JSON.stringify(next),
        updatedAt: new Date(),
      });
    } else {
      await db
        .update(viewPreferences)
        .set({ preferences: JSON.stringify(next), updatedAt: new Date() })
        .where(eq(viewPreferences.scope, scope));
    }
  } catch (err) {
    // Same resilience as `getViewPreferences` — if the table does not exist
    // yet, silently return the merged object. The next runway:push will
    // bring persistence online.
    const message = err instanceof Error ? err.message : String(err);
    if (!/no such table|SQLITE_ERROR/i.test(message)) throw err;
  }

  return next;
}
