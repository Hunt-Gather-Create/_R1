/**
 * Shared utilities for Runway CLI scripts.
 *
 * Provides DB connection factory and direct-execution guard
 * to eliminate boilerplate across scripts.
 */

import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { loadEnvLocal } from "./load-env";

loadEnvLocal();

type DrizzleDb = ReturnType<typeof drizzle>;

/** Create a Drizzle DB connection for the Runway database. */
export function createRunwayDb(): { db: DrizzleDb; url: string } {
  const url = process.env.RUNWAY_DATABASE_URL ?? "file:runway-local.db";
  const client = createClient({ url, authToken: process.env.RUNWAY_AUTH_TOKEN });
  const db = drizzle(client);
  return { db, url };
}

/**
 * Run an async function only when the script is executed directly
 * (not when imported by tests).
 */
export function runIfDirect(scriptName: string, fn: () => Promise<void>): void {
  const isDirectExecution =
    typeof process !== "undefined" &&
    process.argv[1] &&
    (process.argv[1].endsWith(`${scriptName}.ts`) ||
      process.argv[1].endsWith(scriptName));

  if (isDirectExecution) {
    fn().catch((err) => {
      console.error(`${scriptName} failed:`, err);
      process.exit(1);
    });
  }
}
