/**
 * Migration: Preserve projects.target into projects.notes — 2026-04-21
 *
 * PR #88 removes the legacy `projects.target` column. This migration is the
 * Wave 1 data preservation step: for every project with a non-empty `target`
 * value, append "[Legacy target: <value>]" to `notes` so the text survives
 * the Wave 2 column drop.
 *
 * Non-destructive: the original `target` column is NOT cleared here — it
 * stays readable until Wave 2 so the migration is idempotent by append.
 *
 * Idempotency: rows whose `notes` already contain the exact legacy marker
 * for the same target value are skipped (guards against repeat runs).
 *
 * Usage:
 *   # Dry-run (default behaviour when invoked via runway-migrate without --apply,
 *   # or when invoked directly with DRY_RUN=1):
 *   DRY_RUN=1 npx tsx scripts/runway-migrations/2026-04-21-migrate-target-to-notes.ts
 *
 *   # Apply directly:
 *   npx tsx scripts/runway-migrations/2026-04-21-migrate-target-to-notes.ts
 *
 *   # Or via the runway-migrate CLI (preferred for apply with auto-snapshot):
 *   pnpm runway:migrate scripts/runway-migrations/2026-04-21-migrate-target-to-notes.ts --apply --target prod
 */

import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { loadEnvLocal } from "../lib/load-env";
import { runIfDirect } from "../lib/run-script";
import type { MigrationContext } from "../runway-migrate";
import { clients, projects } from "@/lib/db/runway-schema";
import { updateProjectField } from "@/lib/runway/operations";
import { setBatchId } from "@/lib/runway/operations-utils";

// ── Constants ────────────────────────────────────────────

const BATCH_ID = "target-to-notes-2026-04-21";
const UPDATED_BY = "migration";
const SAMPLE_ROW_LIMIT = 3;

// ── Exports ──────────────────────────────────────────────

export const description =
  "Preserve projects.target text into projects.notes as '[Legacy target: <value>]' (PR #88 pre-column-drop).";

interface CandidateRow {
  id: string;
  clientId: string;
  clientSlug: string;
  clientName: string;
  name: string;
  notes: string | null;
  target: string;
}

interface UpdatePlan {
  row: CandidateRow;
  oldNotes: string | null;
  newNotes: string;
  alreadyMigrated: boolean;
}

/**
 * Compute the legacy marker string. Kept in one place so the write path and
 * the idempotency check use byte-identical text.
 */
function legacyMarker(target: string): string {
  return `[Legacy target: ${target}]`;
}

/**
 * Compute the new notes value for a row.
 *
 * - If `notes` is null/empty (after trim): newNotes = marker
 * - Otherwise: newNotes = notes + "\n\n" + marker
 */
function computeNewNotes(oldNotes: string | null, target: string): string {
  const marker = legacyMarker(target);
  if (oldNotes === null || oldNotes.trim() === "") {
    return marker;
  }
  return `${oldNotes}\n\n${marker}`;
}

/**
 * Idempotency guard: if the existing notes already contain the exact legacy
 * marker for this target value, skip. Substring check is sufficient because
 * the marker embeds the full target text and is unambiguous.
 */
function isAlreadyMigrated(oldNotes: string | null, target: string): boolean {
  if (oldNotes === null) return false;
  return oldNotes.includes(legacyMarker(target));
}

export async function up(ctx: MigrationContext): Promise<void> {
  const { db, dryRun, log } = ctx;

  log("=== Migrate projects.target -> projects.notes (PR #88 Wave 1) ===");

  // Step 1 — Select candidate rows (target non-null and non-blank after trim).
  // We fetch client slug + name too so we can call updateProjectField
  // (which identifies projects by clientSlug + projectName).
  const candidates: CandidateRow[] = await db
    .select({
      id: projects.id,
      clientId: projects.clientId,
      clientSlug: clients.slug,
      clientName: clients.name,
      name: projects.name,
      notes: projects.notes,
      target: projects.target,
    })
    .from(projects)
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(and(isNotNull(projects.target), ne(projects.target, "")));

  // `ne(target, "")` catches empties but not whitespace-only. Filter those here.
  const nonBlank = candidates.filter((r) => (r.target ?? "").trim() !== "");

  log(`Found ${nonBlank.length} project(s) with non-empty target.`);

  // Step 2 — Build update plans (compute newNotes + idempotency check).
  const plans: UpdatePlan[] = nonBlank.map((row) => ({
    row,
    oldNotes: row.notes,
    newNotes: computeNewNotes(row.notes, row.target),
    alreadyMigrated: isAlreadyMigrated(row.notes, row.target),
  }));

  const toUpdate = plans.filter((p) => !p.alreadyMigrated);
  const alreadyDone = plans.filter((p) => p.alreadyMigrated);

  log(`Plans: ${toUpdate.length} to update, ${alreadyDone.length} already migrated (skipped).`);

  if (alreadyDone.length > 0) {
    log(`  Skipped rows (notes already contain legacy marker):`);
    for (const p of alreadyDone) {
      log(`    ${p.row.id.slice(0, 8)} | ${p.row.clientName} / ${p.row.name}`);
    }
  }

  // Step 3 — Dry-run: print samples and return.
  if (dryRun) {
    log("--- Dry-run samples (up to 3) ---");
    const samples = toUpdate.slice(0, SAMPLE_ROW_LIMIT);
    for (const p of samples) {
      log(`  id=${p.row.id.slice(0, 8)} | client=${p.row.clientName} | project=${p.row.name}`);
      log(`    target: ${JSON.stringify(p.row.target)}`);
      log(`    old notes: ${JSON.stringify(p.oldNotes)}`);
      log(`    new notes: ${JSON.stringify(p.newNotes)}`);
    }
    if (toUpdate.length > SAMPLE_ROW_LIMIT) {
      log(`  ... (${toUpdate.length - SAMPLE_ROW_LIMIT} more not shown)`);
    }
    log("Dry-run complete. No writes performed.");
    return;
  }

  // Step 4 — Apply: tag batch ID and run per-row writes with per-row try/catch.
  setBatchId(BATCH_ID);

  const failures: Array<{ id: string; clientName: string; projectName: string; error: string }> = [];

  for (const plan of toUpdate) {
    const { row, newNotes } = plan;
    try {
      const result = await updateProjectField({
        clientSlug: row.clientSlug,
        projectName: row.name,
        field: "notes",
        newValue: newNotes,
        updatedBy: UPDATED_BY,
      });
      if (!result.ok) {
        failures.push({
          id: row.id,
          clientName: row.clientName,
          projectName: row.name,
          error: result.error ?? "(unknown)",
        });
        log(
          `  FAIL ${row.id.slice(0, 8)} | ${row.clientName} / ${row.name}: ${result.error ?? "(unknown)"}`
        );
      } else {
        log(`  ok   ${row.id.slice(0, 8)} | ${row.clientName} / ${row.name}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({
        id: row.id,
        clientName: row.clientName,
        projectName: row.name,
        error: message,
      });
      log(`  FAIL ${row.id.slice(0, 8)} | ${row.clientName} / ${row.name}: ${message}`);
    }
  }

  log(`Applied ${toUpdate.length - failures.length} / ${toUpdate.length} updates.`);

  if (failures.length > 0) {
    log(`--- Failures (${failures.length}) ---`);
    for (const f of failures) {
      log(`  ${f.id} | ${f.clientName} / ${f.projectName} | ${f.error}`);
    }
    throw new Error(
      `Migration finished with ${failures.length} failure(s); see log for ids.`
    );
  }

  log("=== Migration complete ===");
}

// ── Standalone main (tsx direct invocation) ──────────────
//
// The runway-migrate CLI can also execute this file via its `up` export.
// When invoked directly (`npx tsx ...`), we read DRY_RUN from env and build
// a minimal MigrationContext locally.

async function main(): Promise<void> {
  loadEnvLocal();

  const url = process.env.RUNWAY_DATABASE_URL;
  if (!url) {
    // Refuse to silently fall back to the local sqlite file; this script is
    // meant to target the shared Turso DB.
    throw new Error(
      "RUNWAY_DATABASE_URL is not set. Direct invocation of this migration requires the prod (Turso) URL."
    );
  }

  const dryRun = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";

  console.log(`Migration: ${description}`);
  console.log(`Target: ${url}`);
  console.log(`Mode: ${dryRun ? "DRY-RUN" : "APPLY"}\n`);

  const client = createClient({ url, authToken: process.env.RUNWAY_AUTH_TOKEN });
  const db = drizzle(client);

  const logs: string[] = [];
  const ctx: MigrationContext = {
    db,
    dryRun,
    log: (message: string) => {
      logs.push(message);
      console.log(`  ${dryRun ? "[DRY-RUN]" : "[APPLY]"} ${message}`);
    },
    logs,
  };

  try {
    await up(ctx);
    console.log(`\n${dryRun ? "Dry-run complete." : "Migration applied."}`);
    console.log(`${ctx.logs.length} operation(s) logged.`);
  } finally {
    setBatchId(null);
  }
}

runIfDirect("2026-04-21-migrate-target-to-notes", main);
