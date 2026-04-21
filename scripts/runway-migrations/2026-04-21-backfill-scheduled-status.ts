/**
 * Migration: Backfill week_items.status NULL -> 'scheduled' — 2026-04-21
 *
 * PR #88 Chunk D promotes `'scheduled'` to a first-class L2 status value. The
 * prior v4 convention treated NULL as the implicit "scheduled" sentinel; this
 * migration replaces those NULLs with the explicit string so the filter +
 * bucket paths can eventually drop the NULL branch.
 *
 * Ordering: run AFTER any retainer-v4-cleanup migrations that intentionally
 * set L2 statuses to NULL. This backfill then turns those NULLs into
 * 'scheduled'. Safe to re-run (idempotent: no rows with status IS NULL remain
 * after a successful apply, so a repeat run is a no-op).
 *
 * Non-destructive: only rows with `status IS NULL` are touched. Rows with any
 * existing explicit status (in-progress, blocked, completed, canceled,
 * at-risk, scheduled) are left alone.
 *
 * Usage:
 *   # Dry-run (default when invoked via runway-migrate without --apply, or
 *   # when invoked directly with DRY_RUN=1):
 *   DRY_RUN=1 npx tsx scripts/runway-migrations/2026-04-21-backfill-scheduled-status.ts
 *
 *   # Apply directly:
 *   npx tsx scripts/runway-migrations/2026-04-21-backfill-scheduled-status.ts
 *
 *   # Or via the runway-migrate CLI (preferred for apply with auto-snapshot):
 *   pnpm runway:migrate scripts/runway-migrations/2026-04-21-backfill-scheduled-status.ts --apply --target prod
 */

import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { isNull } from "drizzle-orm";
import { loadEnvLocal } from "../lib/load-env";
import { runIfDirect } from "../lib/run-script";
import type { MigrationContext } from "../runway-migrate";
import { weekItems } from "@/lib/db/runway-schema";
import { setBatchId } from "@/lib/runway/operations-utils";

// ── Constants ────────────────────────────────────────────

const BATCH_ID = "backfill-scheduled-status-2026-04-21";
const NEW_STATUS = "scheduled";
const SAMPLE_ROW_LIMIT = 3;

// ── Exports ──────────────────────────────────────────────

export const description =
  "Backfill week_items.status: NULL -> 'scheduled' (PR #88 Chunk D — promote scheduled to first-class value).";

interface CandidateRow {
  id: string;
  title: string;
  clientId: string | null;
  projectId: string | null;
  weekOf: string | null;
  status: string | null;
}

export async function up(ctx: MigrationContext): Promise<void> {
  const { db, dryRun, log } = ctx;

  log("=== Backfill week_items.status NULL -> 'scheduled' (PR #88 Chunk D) ===");

  // Step 1 — Select candidate rows (status IS NULL).
  const candidates: CandidateRow[] = await db
    .select({
      id: weekItems.id,
      title: weekItems.title,
      clientId: weekItems.clientId,
      projectId: weekItems.projectId,
      weekOf: weekItems.weekOf,
      status: weekItems.status,
    })
    .from(weekItems)
    .where(isNull(weekItems.status));

  log(`Found ${candidates.length} week_item(s) with status IS NULL.`);

  // Step 2 — Dry-run: print samples and return.
  if (dryRun) {
    log("--- Dry-run samples (up to 3) ---");
    const samples = candidates.slice(0, SAMPLE_ROW_LIMIT);
    for (const row of samples) {
      log(`  id=${row.id.slice(0, 8)} | title=${JSON.stringify(row.title)}`);
      log(`    weekOf=${row.weekOf ?? "(null)"} clientId=${row.clientId ?? "(null)"} projectId=${row.projectId ?? "(null)"}`);
      log(`    status: null -> '${NEW_STATUS}'`);
    }
    if (candidates.length > SAMPLE_ROW_LIMIT) {
      log(`  ... (${candidates.length - SAMPLE_ROW_LIMIT} more not shown)`);
    }
    log("Dry-run complete. No writes performed.");
    return;
  }

  // Step 3 — Apply: single SET UPDATE. No per-row audit is generated for bulk
  // status coercions (low-signal for Slack); setBatchId is still set so any
  // downstream audit paths that DO fire get tagged consistently.
  setBatchId(BATCH_ID);

  const before = candidates.length;

  await db
    .update(weekItems)
    .set({ status: NEW_STATUS, updatedAt: new Date() })
    .where(isNull(weekItems.status));

  // Verify: re-select the count to confirm zero NULL rows remain.
  const remaining = await db
    .select({ id: weekItems.id })
    .from(weekItems)
    .where(isNull(weekItems.status));

  if (remaining.length !== 0) {
    throw new Error(
      `Post-apply verification failed: ${remaining.length} week_item(s) still have status IS NULL.`
    );
  }

  log(`Applied: ${before} row(s) flipped NULL -> '${NEW_STATUS}'. Remaining NULL rows: 0.`);
  log("=== Migration complete ===");
}

// ── Standalone main (tsx direct invocation) ──────────────

async function main(): Promise<void> {
  loadEnvLocal();

  const url = process.env.RUNWAY_DATABASE_URL;
  if (!url) {
    // Refuse to silently fall back to local sqlite — this migration must
    // target the shared Turso DB.
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

runIfDirect("2026-04-21-backfill-scheduled-status", main);
