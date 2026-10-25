/**
 * A database handle for a dry run. Only the read builders the sync tools use
 * pass through; every other property throws before any SQL runs, so raw SQL
 * through all, get, values, run, the session or the client cannot write.
 */
import type { createRunwayDb } from "../lib/run-script";

type RunwayDb = ReturnType<typeof createRunwayDb>["db"];

/** The read builders the sync tools call on a dry run handle. A new one is added here on purpose, never by default. */
export const READ_METHODS = ["select"] as const;

const ALLOWED = new Set<string | symbol>(READ_METHODS);

export function readOnlyDb(db: RunwayDb): RunwayDb {
  return new Proxy(db, {
    get(target, prop) {
      if (!ALLOWED.has(prop)) {
        throw new Error(`read-only database: a dry run may not call db.${String(prop)}; only --apply writes`);
      }
      // Bound to the raw handle, so the builder's own session reads skip this guard.
      const value = Reflect.get(target, prop, target) as (...args: unknown[]) => unknown;
      return value.bind(target);
    },
  });
}
