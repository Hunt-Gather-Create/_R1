/**
 * Migration: Retainer + v4 Cleanup REVERT - 2026-04-21
 *
 * Reverses scripts/runway-migrations/retainer-v4-cleanup-2026-04-21.ts by
 * reading the pre-apply snapshot and restoring every field the forward
 * migration touched back to its captured pre-value. For the D.6 notes
 * APPEND, the full original notes text is restored from the snapshot
 * (NO SQL string manipulation - snapshot restore is the authoritative
 * reversal mechanism). For D.3/D.4/D.5 CREATEs, the created L2 ids are
 * read from the sidecar file and DELETEd under the revert batch id.
 *
 * Uses raw drizzle UPDATE/DELETE + insertAuditRecord rather than the
 * writes-layer helpers because revert needs to restore arbitrary prior
 * values (incl. null) and the revert context is simpler without helper-
 * layer side effects (forward-cascade, parent date derivation). Every
 * audit row emitted during revert carries the revert batch id.
 *
 * Entrypoints:
 *   - `DRY_RUN=1 npx tsx scripts/runway-migrations/retainer-v4-cleanup-2026-04-21-REVERT.ts`
 *   - `npx tsx scripts/runway-migrations/retainer-v4-cleanup-2026-04-21-REVERT.ts`
 *   - `pnpm runway:migrate scripts/runway-migrations/retainer-v4-cleanup-2026-04-21-REVERT.ts [--apply]`
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { createClient as createLibsqlClient } from "@libsql/client";
import type { MigrationContext } from "../runway-migrate";
import { projects, weekItems } from "@/lib/db/runway-schema";
import {
  generateIdempotencyKey,
  insertAuditRecord,
  setBatchId,
} from "@/lib/runway/operations";
import { runIfDirect } from "../lib/run-script";

// =====================================================================
// Constants
// =====================================================================

const FORWARD_BATCH_ID = "retainer-v4-cleanup-2026-04-21-retry";
const REVERT_BATCH_ID = "retainer-v4-cleanup-2026-04-21-retry-revert";
const UPDATED_BY = "migration-revert";
const DEFAULT_SNAPSHOT_PATH = "docs/tmp/retainer-v4-cleanup-pre-apply-snapshot.json";
const DEFAULT_CREATED_IDS_PATH = "docs/tmp/retainer-v4-cleanup-created-ids.json";

// Fields the forward migration writes per entity type. Revert will restore
// these fields back to their snapshotted pre-values; every other column is
// left alone.
const L1_REVERT_FIELDS = [
  "engagementType",
  "contractStart",
  "contractEnd",
  "owner",
  "resources",
  "endDate",
  "startDate",
  "waitingOn",
  "notes",
] as const;

const L2_REVERT_FIELDS = [
  "status",
  "endDate",
  "startDate",
  "resources",
] as const;

// =====================================================================
// Types
// =====================================================================

type ProjectRow = typeof projects.$inferSelect;
type WeekItemRow = typeof weekItems.$inferSelect;

interface Snapshot {
  batchId: string;
  capturedAt: string;
  mode: "dry-run" | "apply";
  trustThreshold: string;
  lppcClientId: string;
  l1Rows: Array<{ key: string; row: ProjectRow }>;
  l2Rows: Array<{ key: string; row: WeekItemRow }>;
  lppcWebsiteRevampNotes: string | null;
}

interface CreatedIdEntry {
  specId: string;
  id: string;
  title: string;
}

// =====================================================================
// Exports
// =====================================================================

export const description =
  "Retainer + v4 cleanup REVERT (2026-04-21): restore every field the forward migration touched back to the pre-apply snapshot; delete the 3 created LPPC L2s (D.3/D.4/D.5) by id.";

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log(`=== Retainer + v4 Cleanup REVERT (${REVERT_BATCH_ID}) ===`);
  ctx.log(`Mode: ${ctx.dryRun ? "DRY-RUN" : "APPLY"}`);

  // --- Step 1: Read snapshot + created-ids sidecar ------------------
  const snapshotPath = resolveSnapshotPath();
  const createdIdsPath = resolveCreatedIdsPath();

  if (!existsSync(snapshotPath)) {
    throw new Error(
      `Snapshot not found at ${snapshotPath}. Cannot revert without the pre-apply snapshot.`
    );
  }
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as Snapshot;
  ctx.log(`Read snapshot: ${snapshotPath}`);
  ctx.log(`  capturedAt: ${snapshot.capturedAt}`);
  ctx.log(`  mode: ${snapshot.mode}`);
  if (snapshot.mode === "dry-run") {
    ctx.log(`  WARNING: snapshot mode is "dry-run" - this revert is reading from a dry-run-era snapshot. Ensure this is intentional.`);
  }
  if (snapshot.batchId !== FORWARD_BATCH_ID) {
    throw new Error(
      `Snapshot batch id '${snapshot.batchId}' does not match forward batch id '${FORWARD_BATCH_ID}'. Aborting to avoid cross-wiring.`
    );
  }

  const createdIds: CreatedIdEntry[] = existsSync(createdIdsPath)
    ? JSON.parse(readFileSync(createdIdsPath, "utf8"))
    : [];
  ctx.log(`Created-ids sidecar: ${createdIdsPath} (${createdIds.length} ids)`);

  // --- Step 2: Currently-exists check -------------------------------
  const l1Ids = snapshot.l1Rows.map((e) => e.row.id);
  const l2Ids = snapshot.l2Rows.map((e) => e.row.id);
  const l1CurrentList = l1Ids.length > 0
    ? await ctx.db.select().from(projects).where(inArray(projects.id, l1Ids))
    : [];
  const l2CurrentList = l2Ids.length > 0
    ? await ctx.db.select().from(weekItems).where(inArray(weekItems.id, l2Ids))
    : [];

  const l1CurrentById = new Map(l1CurrentList.map((r) => [r.id, r]));
  const l2CurrentById = new Map(l2CurrentList.map((r) => [r.id, r]));

  for (const e of snapshot.l1Rows) {
    if (!l1CurrentById.has(e.row.id)) {
      throw new Error(
        `Currently-exists check failed: L1 '${e.key}' (id=${e.row.id.slice(0, 8)}) is missing from DB - was it deleted post-apply? Abort revert.`
      );
    }
  }
  for (const e of snapshot.l2Rows) {
    if (!l2CurrentById.has(e.row.id)) {
      throw new Error(
        `Currently-exists check failed: L2 '${e.key}' (id=${e.row.id.slice(0, 8)}) is missing from DB - was it deleted post-apply? Abort revert.`
      );
    }
  }

  ctx.log(`Currently-exists check passed: ${snapshot.l1Rows.length} L1s + ${snapshot.l2Rows.length} L2s present.`);

  // --- Step 3: Field-restore per row --------------------------------
  let fieldReverts = 0;
  for (const e of snapshot.l1Rows) {
    const current = l1CurrentById.get(e.row.id)!;
    fieldReverts += await revertL1Row(ctx, current, e.row);
  }
  for (const e of snapshot.l2Rows) {
    const current = l2CurrentById.get(e.row.id)!;
    fieldReverts += await revertL2Row(ctx, current, e.row);
  }

  // --- Step 4: Delete created L2s (D.3/D.4/D.5) ---------------------
  let deletes = 0;
  for (const entry of createdIds) {
    ctx.log(`  [${entry.specId}] DELETE L2 id=${entry.id.slice(0, 8)} title='${entry.title}'`);
    if (ctx.dryRun) continue;

    const rows = await ctx.db.select().from(weekItems).where(eq(weekItems.id, entry.id));
    const row = rows[0];
    if (!row) {
      ctx.log(`  [${entry.specId}] WARN: id ${entry.id.slice(0, 8)} not found - already deleted? skipping.`);
      continue;
    }

    await ctx.db.delete(weekItems).where(eq(weekItems.id, entry.id));

    await insertAuditRecord({
      idempotencyKey: generateIdempotencyKey(
        "delete-week-item",
        entry.id,
        UPDATED_BY
      ),
      clientId: row.clientId,
      updatedBy: UPDATED_BY,
      updateType: "delete-week-item",
      previousValue: row.title,
      summary: `REVERT: deleted week item '${row.title}' (${entry.specId})`,
      metadata: JSON.stringify({ revert: true, specId: entry.specId }),
    });
    deletes++;
  }

  // --- Step 5: Summary ----------------------------------------------
  ctx.log("");
  ctx.log(`--- Revert summary ---`);
  ctx.log(`  Field reverts:      ${fieldReverts}`);
  ctx.log(`  L2 deletions:       ${deletes} (of ${createdIds.length} created)`);
  ctx.log(`  Batch id:           ${REVERT_BATCH_ID}`);
  ctx.log(`=== Retainer + v4 Cleanup REVERT complete (${ctx.dryRun ? "dry-run" : "applied"}) ===`);
}

// =====================================================================
// Per-row revert helpers (raw drizzle + manual audit)
// =====================================================================

async function revertL1Row(
  ctx: MigrationContext,
  current: ProjectRow,
  pre: ProjectRow
): Promise<number> {
  let count = 0;
  const updates: Record<string, string | null> = {};

  for (const field of L1_REVERT_FIELDS) {
    const currentVal = normalizeVal(current[field]);
    const preVal = normalizeVal(pre[field]);
    if (currentVal === preVal) continue;

    const currentDisplay = currentVal ?? "(null)";
    const preDisplay = preVal ?? "(null)";
    ctx.log(`  REVERT L1 '${pre.name}'.${field}: "${currentDisplay}" -> "${preDisplay}"`);
    updates[field] = preVal;
    count++;

    if (!ctx.dryRun) {
      await insertAuditRecord({
        idempotencyKey: generateIdempotencyKey(
          "field-change",
          current.id,
          field,
          preVal ?? "(null)",
          UPDATED_BY
        ),
        projectId: current.id,
        clientId: current.clientId,
        updatedBy: UPDATED_BY,
        updateType: "field-change",
        previousValue: currentVal,
        newValue: preVal,
        summary: `REVERT: ${pre.name}.${field} reverted "${currentDisplay}" -> "${preDisplay}"`,
        metadata: JSON.stringify({ field, revert: true }),
      });
    }
  }

  if (!ctx.dryRun && Object.keys(updates).length > 0) {
    await ctx.db
      .update(projects)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(projects.id, current.id));
  }

  return count;
}

async function revertL2Row(
  ctx: MigrationContext,
  current: WeekItemRow,
  pre: WeekItemRow
): Promise<number> {
  let count = 0;
  const updates: Record<string, string | null> = {};

  for (const field of L2_REVERT_FIELDS) {
    const currentVal = normalizeVal(current[field]);
    const preVal = normalizeVal(pre[field]);
    if (currentVal === preVal) continue;

    const currentDisplay = currentVal ?? "(null)";
    const preDisplay = preVal ?? "(null)";
    ctx.log(`  REVERT L2 '${pre.title}'.${field}: "${currentDisplay}" -> "${preDisplay}"`);
    updates[field] = preVal;
    count++;

    if (!ctx.dryRun) {
      await insertAuditRecord({
        idempotencyKey: generateIdempotencyKey(
          "week-field-change",
          current.id,
          field,
          preVal ?? "(null)",
          UPDATED_BY
        ),
        clientId: current.clientId,
        updatedBy: UPDATED_BY,
        updateType: "week-field-change",
        previousValue: currentVal,
        newValue: preVal,
        summary: `REVERT: week item '${pre.title}'.${field} reverted "${currentDisplay}" -> "${preDisplay}"`,
        metadata: JSON.stringify({ field, revert: true }),
      });
    }
  }

  if (!ctx.dryRun && Object.keys(updates).length > 0) {
    await ctx.db
      .update(weekItems)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(weekItems.id, current.id));
  }

  return count;
}

// =====================================================================
// Utilities
// =====================================================================

function normalizeVal(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function resolveSnapshotPath(): string {
  const override = process.env.RETAINER_V4_CLEANUP_SNAPSHOT_PATH;
  return resolvePath(process.cwd(), override ?? DEFAULT_SNAPSHOT_PATH);
}

function resolveCreatedIdsPath(): string {
  const override = process.env.RETAINER_V4_CLEANUP_CREATED_IDS_PATH;
  return resolvePath(process.cwd(), override ?? DEFAULT_CREATED_IDS_PATH);
}

// =====================================================================
// Standalone entrypoint
// =====================================================================

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === "1";
  const url = process.env.RUNWAY_DATABASE_URL;
  if (!url) {
    throw new Error(
      "RUNWAY_DATABASE_URL is not set. This revert targets prod Turso; refusing to run against a local fallback."
    );
  }

  const libsql = createLibsqlClient({
    url,
    authToken: process.env.RUNWAY_AUTH_TOKEN,
  });
  const db = drizzle(libsql);

  const logs: string[] = [];
  const ctx: MigrationContext = {
    db,
    dryRun,
    log: (msg: string) => {
      logs.push(msg);
      console.log(`  ${dryRun ? "[DRY-RUN]" : "[APPLY]"} ${msg}`);
    },
    logs,
  };

  if (!dryRun) setBatchId(REVERT_BATCH_ID);
  try {
    await up(ctx);
    console.log(`\n${dryRun ? "Dry-run complete. Re-run without DRY_RUN=1 to apply." : "Revert applied."}`);
    console.log(`${logs.length} operation(s) logged.`);
  } finally {
    setBatchId(null);
  }
}

runIfDirect("retainer-v4-cleanup-2026-04-21-REVERT", main);
