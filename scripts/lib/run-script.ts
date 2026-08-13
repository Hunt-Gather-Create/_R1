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

/**
 * Create a Drizzle DB connection for the Runway database.
 *
 * `staging: true` resolves the RUNWAY_STAGING_* env pair instead of the prod
 * pair — used by the E2 (#102) two-pass `--live` integration test so the DB
 * ledger is exercised against the `runway-staging` clone, never prod.
 */
export function createRunwayDb(opts?: { staging?: boolean }): { db: DrizzleDb; url: string } {
  const url = opts?.staging
    ? (process.env.RUNWAY_STAGING_DATABASE_URL ?? "")
    : (process.env.RUNWAY_DATABASE_URL ?? "file:runway-local.db");
  const authToken = opts?.staging
    ? process.env.RUNWAY_STAGING_AUTH_TOKEN
    : process.env.RUNWAY_AUTH_TOKEN;
  const client = createClient({ url, authToken });
  const db = drizzle(client);
  return { db, url };
}

/**
 * Run an async function only when the script is executed directly
 * (not when imported by tests).
 *
 * Matches both .ts and .tsx so React-component CLIs (e.g. runway-gantt.tsx)
 * pass the same direct-execution guard.
 */
export function runIfDirect(scriptName: string, fn: () => Promise<void>): void {
  const isDirectExecution =
    typeof process !== "undefined" &&
    process.argv[1] &&
    (process.argv[1].endsWith(`${scriptName}.ts`) ||
      process.argv[1].endsWith(`${scriptName}.tsx`) ||
      process.argv[1].endsWith(scriptName));

  if (isDirectExecution) {
    fn().catch((err) => {
      console.error(`${scriptName} failed:`, err);
      process.exit(1);
    });
  }
}
