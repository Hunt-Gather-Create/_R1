"use server";

/**
 * Runway server actions — thin wrappers the UI invokes directly.
 * Keep logic in `@/lib/runway/*`; these files just bridge the boundary.
 */

import { revalidatePath } from "next/cache";
import {
  setViewPreferences,
  type RunwayViewPreferences,
} from "@/lib/runway/view-preferences";

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
