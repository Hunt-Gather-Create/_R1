"use server";

/**
 * Runway view-preferences read/write — persistent per-scope UI toggles.
 *
 * The runway DB is currently single-tenant so all reads/writes key off
 * a `global` scope row. Future per-user scopes (e.g. Slack user id) are
 * additive without a migration — just pass a different scope string.
 *
 * JSON shape (versionless, add fields as needed):
 *   { inFlightToggle?: boolean; ... }
 *
 * v4 (2026-04-21): introduced for the Week Of In Flight toggle.
 */

import { getRunwayDb } from "@/lib/db/runway";
import { viewPreferences } from "@/lib/db/runway-schema";
import { eq } from "drizzle-orm";

export interface RunwayViewPreferences {
  inFlightToggle?: boolean;
}

const DEFAULT_PREFERENCES: RunwayViewPreferences = {
  // Chunk 3 #6 — locked pre-flight decision (pr86-orchestration-amendment.md):
  // In Flight toggle default = ON.
  inFlightToggle: true,
};

const GLOBAL_SCOPE = "global";

/**
 * Parse stored JSON preferences. Silently falls back to defaults for any
 * malformed payload so a single bad write cannot break the board.
 */
function parsePreferences(raw: string | null): RunwayViewPreferences {
  if (!raw) return { ...DEFAULT_PREFERENCES };
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return { ...DEFAULT_PREFERENCES };
    }
    return { ...DEFAULT_PREFERENCES, ...parsed };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export async function getViewPreferences(
  scope: string = GLOBAL_SCOPE
): Promise<RunwayViewPreferences> {
  const db = getRunwayDb();
  const rows = await db
    .select()
    .from(viewPreferences)
    .where(eq(viewPreferences.scope, scope))
    .limit(1);
  if (rows.length === 0) return { ...DEFAULT_PREFERENCES };
  return parsePreferences(rows[0].preferences);
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
  const current = await getViewPreferences(scope);
  const next = { ...current, ...patch };

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

  return next;
}
