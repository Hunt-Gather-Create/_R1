/**
 * Read-only pre-check for target-to-notes migration.
 *
 * Queries prod Turso for every project with a non-null / non-empty `target`
 * value and writes a raw backup to docs/tmp/target-backup-2026-04-21.json.
 * Also reports whether target-to-notes has already been applied by
 * scanning for the `[Legacy target:` marker in notes.
 *
 * No writes. Safe to run any number of times.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { createClient } from "@libsql/client";

async function main(): Promise<void> {
  const url = process.env.RUNWAY_DATABASE_URL;
  if (!url) {
    throw new Error("RUNWAY_DATABASE_URL not set. Source .env.local first.");
  }

  const db = createClient({
    url,
    authToken: process.env.RUNWAY_AUTH_TOKEN,
  });

  // Fetch every project with a usable target value, joined to client slug/name.
  const rows = await db.execute(`
    SELECT p.id AS project_id, p.name AS project_name, p.target, p.notes,
           c.id AS client_id, c.slug AS client_slug, c.name AS client_name
    FROM projects p
    JOIN clients c ON p.client_id = c.id
    WHERE p.target IS NOT NULL AND TRIM(p.target) != ''
    ORDER BY c.slug, p.name
  `);

  const backup = rows.rows.map((r) => ({
    projectId: String(r.project_id),
    projectName: String(r.project_name),
    target: String(r.target),
    notes: r.notes == null ? null : String(r.notes),
    clientId: String(r.client_id),
    clientSlug: String(r.client_slug),
    clientName: String(r.client_name),
  }));

  // Check if any project's notes already contain the legacy marker (would
  // indicate a prior target-to-notes run).
  const alreadyMigrated = await db.execute(`
    SELECT COUNT(*) AS n
    FROM projects
    WHERE notes LIKE '%[Legacy target:%'
  `);

  const alreadyCount = Number(alreadyMigrated.rows[0].n);

  const outDir = resolvePath(process.cwd(), "docs/tmp");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolvePath(outDir, "target-backup-2026-04-21.json");

  writeFileSync(
    outPath,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        totalWithTarget: backup.length,
        alreadyMigratedCount: alreadyCount,
        rows: backup,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log("=== target-to-notes PRE-CHECK ===");
  console.log(`Projects with non-empty target:   ${backup.length}`);
  console.log(`Projects with '[Legacy target:' already in notes: ${alreadyCount}`);
  console.log(`Backup written to: ${outPath}`);
  console.log("");
  console.log("Sample (first 5):");
  for (const r of backup.slice(0, 5)) {
    const truncTarget = r.target.length > 80 ? r.target.slice(0, 77) + "..." : r.target;
    console.log(`  ${r.clientSlug}/${r.projectName} | target: ${truncTarget}`);
  }

  db.close();
}

main().catch((err) => {
  console.error("PRE-CHECK FAILED:", err);
  process.exit(1);
});
