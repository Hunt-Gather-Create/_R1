/**
 * Read-only diagnostic: find projects whose parent_project_id points at a
 * non-existent project row.
 *
 * Operator runs `pnpm runway:check-orphans` post-merge or after any data
 * operation that touches `parent_project_id` (wrapper creation, parent
 * reassignment, project deletion). Exit 0 when clean, exit 1 when orphans
 * exist; row list printed to stdout.
 *
 * No writes. Safe to run any number of times.
 */

import { createClient, type Client } from "@libsql/client";

export type OrphanRow = {
  projectId: string;
  projectName: string;
  parentProjectId: string;
};

export type OrphanCheckExecutor = Pick<Client, "execute">;

export async function findOrphanedParentProjects(
  executor: OrphanCheckExecutor,
): Promise<OrphanRow[]> {
  const result = await executor.execute(`
    SELECT p.id AS project_id, p.name AS project_name, p.parent_project_id
    FROM projects p
    LEFT JOIN projects pp ON pp.id = p.parent_project_id
    WHERE p.parent_project_id IS NOT NULL AND pp.id IS NULL
    ORDER BY p.name
  `);
  return result.rows.map((r) => ({
    projectId: String(r.project_id),
    projectName: String(r.project_name),
    parentProjectId: String(r.parent_project_id),
  }));
}

async function main(): Promise<void> {
  const url = process.env.RUNWAY_DATABASE_URL;
  if (!url) {
    throw new Error("RUNWAY_DATABASE_URL not set. Source .env.local first.");
  }

  const db = createClient({
    url,
    authToken: process.env.RUNWAY_AUTH_TOKEN,
  });

  const orphans = await findOrphanedParentProjects(db);

  console.log("=== orphan parent_project_id check ===");
  console.log(`Orphan count: ${orphans.length}`);
  if (orphans.length > 0) {
    console.log("");
    for (const row of orphans) {
      console.log(`  ${row.projectName} (id=${row.projectId}) -> missing parent ${row.parentProjectId}`);
    }
    db.close();
    process.exit(1);
  }

  db.close();
  process.exit(0);
}

// Guard so test-time imports don't run main(); copy this pattern when exporting helpers for tests.
if (require.main === module) {
  main().catch((err) => {
    console.error("orphan-check FAILED:", err);
    process.exit(1);
  });
}
