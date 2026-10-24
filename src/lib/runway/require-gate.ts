import { cookies } from "next/headers";

import {
  RUNWAY_AUTH_COOKIE_NAME,
  verifyRunwayAuthCookie,
} from "@/lib/runway/auth-cookie";

export const RUNWAY_GATE_ERROR = "Runway gate: not signed in";

/**
 * Refuses a server action caller without a valid Runway password cookie.
 * Next.js runs an action before the gated layout renders, so the layout
 * check alone never protects one. Call this first in every Runway action.
 */
export async function requireRunwayGate(): Promise<void> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(RUNWAY_AUTH_COOKIE_NAME);
  if (!cookie || !verifyRunwayAuthCookie(cookie.value)) {
    throw new Error(RUNWAY_GATE_ERROR);
  }
}
