/**
 * Runway version endpoint — GET /api/runway/version
 *
 * Returns the latest `updates.created_at` timestamp as an ISO string, or
 * `null` if the audit table is empty. Clients poll this cheap endpoint
 * every 15s and only call `router.refresh()` when the version changes,
 * so the dashboard stops paying for full RSC re-renders every 60s.
 *
 * Auth is enforced by a route-local `getCurrentUser()` check that reads
 * the WorkOS session cookie. `proxy.ts`'s `authkitMiddleware` matcher
 * covers this path, but WorkOS authkit lets JSON `/api/*` requests
 * through (it only redirects on `Accept: text/html`), so the route
 * cannot rely on the middleware alone. Unauthenticated requests get 401.
 * The polling client (`use-version-poll.ts`) already sends
 * `credentials: "same-origin"`, so it carries the session cookie.
 *
 * Cache prevention is belt-and-suspenders:
 *   1. `export const dynamic = "force-dynamic"` opts the route out of
 *      Next.js's static/data cache, so each poll hits the handler.
 *   2. The response sets `Cache-Control: no-store`, preventing any
 *      intermediate CDN/proxy from freezing a stale `version` and
 *      stranding polling clients on outdated data.
 */

import { max } from "drizzle-orm";
import { getRunwayDb } from "@/lib/db/runway";
import { updates } from "@/lib/db/runway-schema";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return new Response(null, { status: 401 });
  }

  const db = getRunwayDb();
  const rows = await db.select({ latest: max(updates.createdAt) }).from(updates);
  const latest = rows[0]?.latest ?? null;

  // Drizzle hydrates `max()` on a `mode: "timestamp"` column as `Date | null`.
  const version = latest instanceof Date ? latest.toISOString() : null;

  return Response.json(
    { version },
    { headers: { "Cache-Control": "no-store" } },
  );
}
