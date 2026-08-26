import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./runway-schema";

/**
 * Explicitly pinned connection, set once per process before anything opens one.
 *
 * Without this, a CLI could resolve one url for its safety guard and a
 * different one for its writes: `getRunwayClient` reads RUNWAY_DATABASE_URL
 * unconditionally, so a script that resolved a staging url elsewhere still
 * wrote to prod, and its post-write verification read the database the write
 * had not gone to. The guard passed, the rows landed in prod, and the verifier
 * reported clean (issue #103).
 */
let _pinned: { url: string; authToken?: string } | null = null;

function getRunwayClient() {
  const url = _pinned?.url ?? process.env.RUNWAY_DATABASE_URL;
  if (!url) {
    throw new Error(
      "RUNWAY_DATABASE_URL is not set. Runway requires a separate Turso database."
    );
  }

  return createClient({
    url,
    authToken: _pinned ? _pinned.authToken : process.env.RUNWAY_AUTH_TOKEN,
  });
}

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

/**
 * Pin the Runway connection for this process. Must be called before anything
 * opens one.
 *
 * Throws if a connection is already open rather than silently losing the pin.
 * `_db` is memoised at module level, so whoever touches it first wins; a late
 * pin that returned quietly would leave the caller believing it had chosen the
 * target while the writes went somewhere else. That is exactly the failure
 * this function exists to prevent, so it must be loud.
 */
export function pinRunwayConnection(url: string, authToken?: string): void {
  if (!url) {
    throw new Error("pinRunwayConnection requires a non-empty url");
  }
  if (_db) {
    throw new Error(
      "Runway DB connection is already open; pinRunwayConnection must be called " +
        "before the first getRunwayDb() call in the process."
    );
  }
  _pinned = { url, authToken };
}

/** The url the write path will actually use. Safe to log; never includes the token. */
export function resolvedRunwayUrl(): string {
  return _pinned?.url ?? process.env.RUNWAY_DATABASE_URL ?? "";
}

/** Test-only: drop the pin and the memoised connection. */
export function resetRunwayConnectionForTests(): void {
  _pinned = null;
  _db = null;
}

export function getRunwayDb() {
  if (!_db) {
    _db = drizzle(getRunwayClient(), { schema });
  }
  return _db;
}

// Direct export for convenience in server components / actions
export const runwayDb = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_, prop) {
    return (getRunwayDb() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
