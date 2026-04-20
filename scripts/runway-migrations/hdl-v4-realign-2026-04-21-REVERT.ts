/**
 * Reverse Migration: HDL v4 Realign — 2026-04-21 REVERT
 *
 * Reads the apply-mode pre-apply snapshot written by hdl-v4-realign-2026-04-21.ts
 * and restores the L1 and 3 L2s to their pre-migration field values.
 *
 * Fields restored:
 *   projects.name          ← L1_OLD_NAME ("HDL Website Build")
 *   projects.resources     ← L1_OLD_RESOURCES ("CD: Lane, Dev: Leslie")
 *   projects.engagement_type ← null
 *   week_items.resources   ← null  (for 3 client-led items)
 *
 * Expects: docs/tmp/hdl-v4-pre-apply-snapshot-2026-04-21.json (apply-mode).
 * Aborts loudly if the file is missing or has an unexpected shape.
 *
 * Dry-run: prints planned reverts. Apply: writes.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { eq } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { projects, weekItems } from "@/lib/db/runway-schema";
import {
  generateIdempotencyKey,
  insertAuditRecord,
} from "@/lib/runway/operations";

const SNAPSHOT_PATH = "docs/tmp/hdl-v4-pre-apply-snapshot-2026-04-21.json";
const UPDATED_BY = "migration-revert";

export const description =
  "REVERT HDL v4 realign (2026-04-21): restore L1 name/resources/engagement_type and 3 L2 resources from pre-apply snapshot.";

interface SnapshotL1 {
  id: string;
  name: string;
  resources: string | null;
  engagementType: string | null;
}

interface SnapshotL2 {
  id: string;
  title: string;
  resources: string | null;
}

interface Snapshot {
  capturedAt: string;
  mode: "dry-run" | "apply";
  client: { id: string };
  l1BeforeUpdate: SnapshotL1;
  l2sBeforeUpdate: SnapshotL2[];
}

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("=== HDL v4 Realign REVERT (2026-04-21) ===");

  const snapshot = loadSnapshot(ctx);
  ctx.log(`Snapshot captured ${snapshot.capturedAt} (${snapshot.mode}).`);

  const l1 = snapshot.l1BeforeUpdate;
  const l2s = snapshot.l2sBeforeUpdate;

  ctx.log(
    `Planned reverts: L1 ${l1.id.slice(0, 8)} (name + resources + engagement_type) + ${l2s.length} L2 resources.`
  );

  if (ctx.dryRun) {
    ctx.log("Dry-run: no writes will be performed.");
    ctx.log(`  L1 ${l1.id.slice(0, 8)} name        → "${l1.name}"`);
    ctx.log(`  L1 ${l1.id.slice(0, 8)} resources   → "${l1.resources}"`);
    ctx.log(`  L1 ${l1.id.slice(0, 8)} engagement_type → ${l1.engagementType === null ? "null" : `"${l1.engagementType}"`}`);
    for (const row of l2s) {
      ctx.log(`  L2 ${row.id.slice(0, 8)} (${row.title}) resources → ${row.resources === null ? "null" : `"${row.resources}"`}`);
    }
    return;
  }

  // Revert L1 (single raw update for name + resources + engagement_type).
  await ctx.db
    .update(projects)
    .set({
      name: l1.name,
      resources: l1.resources,
      engagementType: l1.engagementType,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, l1.id));
  ctx.log(`Reverted L1 ${l1.id.slice(0, 8)}.`);

  // Audit rows so the revert shows up in the updates table.
  const nowIso = new Date().toISOString();
  for (const [field, newVal] of [
    ["name", l1.name],
    ["resources", l1.resources ?? "(null)"],
    ["engagement_type", l1.engagementType ?? "(null)"],
  ] as const) {
    const idemKey = generateIdempotencyKey(
      "field-change-revert",
      l1.id,
      field,
      String(newVal),
      `${UPDATED_BY}-${nowIso}`
    );
    await insertAuditRecord({
      idempotencyKey: idemKey,
      projectId: l1.id,
      clientId: snapshot.client.id,
      updatedBy: UPDATED_BY,
      updateType: "field-change",
      previousValue: null,
      newValue: String(newVal),
      summary: `REVERT: Project '${l1.name}' ${field} restored to ${newVal === "(null)" ? "null" : `"${newVal}"`}`,
      metadata: JSON.stringify({ field, revert: true }),
    });
  }

  // Revert L2 resources.
  for (const row of l2s) {
    await ctx.db
      .update(weekItems)
      .set({ resources: row.resources, updatedAt: new Date() })
      .where(eq(weekItems.id, row.id));
    ctx.log(`Reverted L2 ${row.id.slice(0, 8)} resources.`);

    const idemKey = generateIdempotencyKey(
      "field-change-revert",
      row.id,
      "resources",
      row.resources ?? "(null)",
      `${UPDATED_BY}-${nowIso}`
    );
    await insertAuditRecord({
      idempotencyKey: idemKey,
      clientId: snapshot.client.id,
      updatedBy: UPDATED_BY,
      updateType: "week-field-change",
      previousValue: null,
      newValue: row.resources ?? "(null)",
      summary: `REVERT: Week item '${row.title}' resources restored to ${row.resources === null ? "null" : `"${row.resources}"`}`,
      metadata: JSON.stringify({ field: "resources", revert: true }),
    });
  }

  ctx.log("=== HDL v4 Realign REVERT complete ===");
}

function loadSnapshot(ctx: MigrationContext): Snapshot {
  const path = resolvePath(process.cwd(), SNAPSHOT_PATH);
  if (!existsSync(path)) {
    throw new Error(
      `Snapshot not found at ${path}. REVERT requires the apply-mode snapshot from hdl-v4-realign-2026-04-21.ts. Abort.`
    );
  }
  const raw = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Snapshot at ${path} is not valid JSON: ${err instanceof Error ? err.message : err}`);
  }
  const s = parsed as Partial<Snapshot>;
  if (
    !s ||
    typeof s !== "object" ||
    !s.client ||
    typeof (s.client as { id?: unknown }).id !== "string" ||
    !s.l1BeforeUpdate ||
    !Array.isArray(s.l2sBeforeUpdate) ||
    typeof s.capturedAt !== "string"
  ) {
    throw new Error(`Snapshot at ${path} has unexpected shape. Abort.`);
  }
  if (s.mode !== "apply") {
    ctx.log(`WARNING: snapshot mode is "${s.mode}", expected "apply".`);
  }
  return s as Snapshot;
}
