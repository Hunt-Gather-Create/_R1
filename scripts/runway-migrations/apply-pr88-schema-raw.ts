/**
 * Raw schema push for PR #88 (replaces interactive `pnpm runway:push`).
 *
 * drizzle-kit push asks an interactive question about whether
 * parent_project_id is a new column or a rename from target — we want CREATE
 * (target data is already preserved to notes by the target-to-notes-raw
 * script). This applies the two pre-generated SQL files directly, no TUI.
 *
 * Files applied (in order):
 *   drizzle-runway/0003_lovely_firestar.sql  — ALTER TABLE projects DROP COLUMN target
 *   drizzle-runway/0004_add_parent_project_id.sql — ALTER TABLE projects ADD parent_project_id text
 *
 * Idempotent-ish: if target is already dropped, SQL errors; same for
 * parent_project_id already existing. We continue on each error and report.
 */

import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

async function main(): Promise<void> {
  const url = process.env.RUNWAY_DATABASE_URL;
  if (!url) throw new Error("RUNWAY_DATABASE_URL not set");

  const db = createClient({ url, authToken: process.env.RUNWAY_AUTH_TOKEN });

  const files = [
    "drizzle-runway/0003_lovely_firestar.sql",
    "drizzle-runway/0004_add_parent_project_id.sql",
  ];

  console.log("=== PR #88 schema push (raw) ===");

  for (const rel of files) {
    const full = resolvePath(process.cwd(), rel);
    const sql = readFileSync(full, "utf8").trim().replace(/;$/, "");
    console.log(`\n--- ${rel} ---`);
    console.log(`  SQL: ${sql}`);
    try {
      await db.execute(sql);
      console.log(`  [OK]`);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      console.log(`  [ERROR] ${msg}`);
      if (msg.includes("duplicate column") || msg.includes("already exists") || msg.includes("no such column")) {
        console.log(`  (treating as idempotent — schema likely already in target state for this statement)`);
      } else {
        throw err;
      }
    }
  }

  // Final verification
  console.log(`\n--- verification ---`);
  const cols = await db.execute(`PRAGMA table_info(projects)`);
  const colNames = cols.rows.map((r) => String(r.name));
  const hasTarget = colNames.includes("target");
  const hasParent = colNames.includes("parent_project_id");
  console.log(`  projects.target column present?       ${hasTarget} (expected: false)`);
  console.log(`  projects.parent_project_id present?   ${hasParent} (expected: true)`);

  if (hasTarget || !hasParent) {
    throw new Error("Schema verification failed — post-push state does not match expected.");
  }

  console.log(`\n=== Schema push complete ===`);
  db.close();
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
