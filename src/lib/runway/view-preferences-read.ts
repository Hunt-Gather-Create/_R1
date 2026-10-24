/**
 * Runway view preferences: persistent per-scope UI toggles, stored as JSON
 * such as { inFlightToggle?: boolean; needsUpdateToggle?: boolean }.
 *
 * The Runway DB is single-tenant, so every read and write keys off the
 * `global` scope row. A per-user scope needs only a different scope string.
 */

import { getRunwayDb } from "@/lib/db/runway";
import { viewPreferences } from "@/lib/db/runway-schema";
import { withRunwayRetry } from "@/lib/runway/retry";
import { eq } from "drizzle-orm";

export interface RunwayViewPreferences {
  inFlightToggle?: boolean;
  needsUpdateToggle?: boolean;
}

const DEFAULT_PREFERENCES: RunwayViewPreferences = {
  // Both sections default to on.
  inFlightToggle: true,
  needsUpdateToggle: true,
};

export const GLOBAL_SCOPE = "global";

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

/**
 * Ungated read for server components, which the gated layout already
 * guards. Client code must call the gated getViewPreferences action instead.
 */
export async function readViewPreferences(
  scope: string = GLOBAL_SCOPE
): Promise<RunwayViewPreferences> {
  // A missing `view_preferences` table returns the defaults, so the page
  // still renders before the schema is pushed. withRunwayRetry absorbs
  // transient connection resets and rethrows every other error untouched.
  try {
    const db = getRunwayDb();
    const rows = await withRunwayRetry(
      () =>
        db
          .select()
          .from(viewPreferences)
          .where(eq(viewPreferences.scope, scope))
          .limit(1),
      "getViewPreferences",
    );
    if (rows.length === 0) return { ...DEFAULT_PREFERENCES };
    return parsePreferences(rows[0].preferences);
  } catch (err) {
    // A missing table falls back to defaults; any other error rethrows.
    const message = err instanceof Error ? err.message : String(err);
    if (/no such table|SQLITE_ERROR/i.test(message)) {
      return { ...DEFAULT_PREFERENCES };
    }
    throw err;
  }
}
