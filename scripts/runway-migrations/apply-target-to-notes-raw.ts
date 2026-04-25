/**
 * Raw-SQL equivalent of target-to-notes migration.
 *
 * The drizzle-based migration (2026-04-21-migrate-target-to-notes.ts) breaks
 * because PR 88 already removed `target` from the runway-schema.ts drizzle
 * definition — referencing `projects.target` in a select yields undefined and
 * drizzle throws before the query even runs. This script bypasses drizzle
 * entirely and talks to libsql directly.
 *
 * Reads every project with a non-null/non-empty target, computes new notes
 * as (oldNotes + "\n\n" + "[Legacy target: <target>]"), and UPDATES notes.
 * Idempotent: rows whose notes already contain the exact marker are skipped.
 *
 * Audit records written via raw insert into the `updates` table, with a
 * dedicated batch_id so this run is greppable in the audit log.
 *
 * Usage:
 *   DRY_RUN=1 npx tsx scripts/runway-migrations/apply-target-to-notes-raw.ts
 *   npx tsx scripts/runway-migrations/apply-target-to-notes-raw.ts
 */

import { createClient } from "@libsql/client";
import { createHash, randomUUID } from "node:crypto";

const BATCH_ID = "target-to-notes-raw-2026-04-21";
const UPDATED_BY = "migration-target-to-notes";

function generateIdemKey(...parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 40);
}

function legacyMarker(target: string): string {
  return `[Legacy target: ${target}]`;
}

function computeNewNotes(oldNotes: string | null, target: string): string {
  const marker = legacyMarker(target);
  const trimmed = (oldNotes ?? "").trim();
  if (trimmed === "") return marker;
  return `${oldNotes}\n\n${marker}`;
}

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === "1";
  const url = process.env.RUNWAY_DATABASE_URL;
  if (!url) throw new Error("RUNWAY_DATABASE_URL not set");

  const db = createClient({ url, authToken: process.env.RUNWAY_AUTH_TOKEN });

  console.log(`=== target-to-notes (raw SQL) === mode: ${dryRun ? "DRY-RUN" : "APPLY"}`);

  const rows = await db.execute(`
    SELECT p.id, p.name, p.notes, p.target, c.id AS client_id, c.slug AS client_slug, c.name AS client_name
    FROM projects p JOIN clients c ON p.client_id = c.id
    WHERE p.target IS NOT NULL AND TRIM(p.target) != ''
    ORDER BY c.slug, p.name
  `);

  const candidates = rows.rows.map((r) => ({
    id: String(r.id),
    projectName: String(r.name),
    notes: r.notes == null ? null : String(r.notes),
    target: String(r.target),
    clientId: String(r.client_id),
    clientSlug: String(r.client_slug),
    clientName: String(r.client_name),
  }));

  console.log(`Found ${candidates.length} project(s) with non-empty target.`);

  let writes = 0;
  let skipped = 0;

  for (const c of candidates) {
    const marker = legacyMarker(c.target);
    if ((c.notes ?? "").includes(marker)) {
      console.log(`  [SKIP] ${c.clientSlug}/${c.projectName} (marker already present)`);
      skipped++;
      continue;
    }

    const newNotes = computeNewNotes(c.notes, c.target);
    const preview = c.target.length > 60 ? c.target.slice(0, 57) + "..." : c.target;
    console.log(`  [APPLY] ${c.clientSlug}/${c.projectName} | marker: [Legacy target: ${preview}]`);

    if (dryRun) {
      writes++;
      continue;
    }

    // Update notes + updated_at
    const now = Date.now();
    await db.execute({
      sql: `UPDATE projects SET notes = ?, updated_at = ? WHERE id = ?`,
      args: [newNotes, now, c.id],
    });

    // Audit row
    const idemKey = generateIdemKey("field-change", c.id, "notes", newNotes, UPDATED_BY);
    const auditId = randomUUID();
    const summary = `${c.clientName} / ${c.projectName}: notes appended with legacy target preservation (PR #88 pre-column-drop)`;
    try {
      await db.execute({
        sql: `INSERT INTO updates (id, idempotency_key, project_id, client_id, updated_by, update_type, previous_value, new_value, summary, metadata, batch_id, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          auditId,
          idemKey,
          c.id,
          c.clientId,
          UPDATED_BY,
          "field-change",
          c.notes ?? "(null)",
          newNotes,
          summary,
          JSON.stringify({ field: "notes", migration: "target-to-notes-raw" }),
          BATCH_ID,
          now,
        ],
      });
    } catch (err) {
      // Audit write failing should not block the core data preservation.
      console.log(`    [WARN] audit insert failed: ${err}`);
    }

    writes++;
  }

  console.log("");
  console.log(`=== Summary ===`);
  console.log(`  Writes: ${writes}`);
  console.log(`  Skipped (already marked): ${skipped}`);
  console.log(`  Mode: ${dryRun ? "DRY-RUN (no changes)" : "APPLIED"}`);

  db.close();
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
