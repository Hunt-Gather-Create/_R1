/**
 * A database handle for a dry run. Reads pass through; every write method,
 * and the raw client that could write around them, throws before it runs.
 */
import type { createRunwayDb } from "../lib/run-script";

type RunwayDb = ReturnType<typeof createRunwayDb>["db"];

/** Drizzle's write entry points on a libSQL database, plus the raw client. */
export const WRITE_METHODS = ["insert", "update", "delete", "run", "batch", "transaction", "with", "$with", "$client"] as const;

const BLOCKED = new Set<string | symbol>(WRITE_METHODS);

export function readOnlyDb(db: RunwayDb): RunwayDb {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (BLOCKED.has(prop)) {
        throw new Error(`read-only database: a dry run may not call db.${String(prop)}; only --apply writes`);
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}
