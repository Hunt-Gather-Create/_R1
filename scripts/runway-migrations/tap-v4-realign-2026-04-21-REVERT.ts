/**
 * Migration: TAP v4 Realign REVERT — 2026-04-21
 *
 * Reverses `tap-v4-realign-2026-04-21.ts` by reading the pre-snapshot JSON
 * written by that migration and restoring every modified field to its
 * pre-value:
 *
 *   client.tap.team               → "Owner: Jason, Dev: Tim"
 *   L1 TAP ERP Rebuild.name       → "TAP ERP Rebuild"
 *               .resources        → "Dev: Tim"
 *               .engagementType   → null
 *   L2 95f9ce76.title             → "Development (8 modules)"
 *   L2 bd6521b3.title             → "Data Migration — Kickoff"
 *               .blockedBy        → null
 *   L2 46d5cedb.title             → "Testing & QA — Kickoff"
 *               .blockedBy        → null
 *   L2 2776d883.title             → "Deployment & Go-Live — Kickoff"
 *               .blockedBy        → null
 *   L2 38ae73c9.title             → "Training & Handoff — Kickoff"
 *               .blockedBy        → null
 *
 * Writes one audit row per reverted field (batchId auto-tagged
 * `tap-v4-realign-2026-04-21-REVERT` by runway-migrate.ts from the filename).
 *
 * Reads pre-snapshot from `docs/tmp/tap-v4-pre-snapshot-2026-04-21.json`
 * (the hand-generated canonical file, not the `-preapply` suffix).
 */
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { eq } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { clients, projects, weekItems } from "@/lib/db/runway-schema";
import { generateIdempotencyKey, insertAuditRecord } from "@/lib/runway/operations";

// ── Constants ────────────────────────────────────────────

const UPDATED_BY = "migration-revert";
const PRE_SNAPSHOT_PATH = "docs/tmp/tap-v4-pre-snapshot-2026-04-21.json";

// ── Types ────────────────────────────────────────────────

interface PreSnapshot {
  capturedAt: string;
  source: string;
  client: typeof clients.$inferSelect;
  projects: (typeof projects.$inferSelect)[];
  weekItems: (typeof weekItems.$inferSelect)[];
}

// ── Exports ──────────────────────────────────────────────

export const description =
  "REVERT TAP v4 realign 2026-04-21: restore client.team, L1 name/resources/engagement_type, L2 titles + blocked_by to pre-apply values.";

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("=== TAP v4 Realign REVERT 2026-04-21 ===");

  const snap = readPreSnapshot(ctx);

  // Step 1 — client.team
  await restoreClientField(ctx, snap);

  // Step 2 — L1 name, resources, engagement_type
  await restoreL1Fields(ctx, snap);

  // Step 3 — L2 title + blocked_by
  for (const preW of snap.weekItems) {
    await restoreL2Fields(ctx, preW);
  }

  // Step 4 — Verify
  if (!ctx.dryRun) {
    await verify(ctx, snap);
  }

  ctx.log("=== TAP v4 Realign REVERT complete ===");
}

// ── Snapshot ─────────────────────────────────────────────

function readPreSnapshot(ctx: MigrationContext): PreSnapshot {
  const fullPath = resolvePath(process.cwd(), PRE_SNAPSHOT_PATH);
  ctx.log(`Reading pre-snapshot from ${fullPath}`);
  const raw = readFileSync(fullPath, "utf8");
  return JSON.parse(raw) as PreSnapshot;
}

// ── Restores ─────────────────────────────────────────────

async function restoreClientField(ctx: MigrationContext, snap: PreSnapshot): Promise<void> {
  const db = ctx.db;
  const rows = await db.select().from(clients).where(eq(clients.id, snap.client.id));
  const current = rows[0];
  if (!current) throw new Error(`Revert: client id ${snap.client.id} not found.`);
  if (current.team === snap.client.team) {
    ctx.log(`Client tap: team already at pre-value "${snap.client.team}", skip.`);
    return;
  }
  ctx.log(`Client tap: team "${current.team}" → "${snap.client.team}"`);
  if (ctx.dryRun) return;

  await db
    .update(clients)
    .set({ team: snap.client.team, updatedAt: new Date() })
    .where(eq(clients.id, snap.client.id));

  const idemKey = generateIdempotencyKey(
    "client-field-change",
    snap.client.id,
    "team",
    snap.client.team ?? "(null)",
    UPDATED_BY
  );
  await insertAuditRecord({
    idempotencyKey: idemKey,
    clientId: snap.client.id,
    updatedBy: UPDATED_BY,
    updateType: "client-field-change",
    previousValue: current.team,
    newValue: snap.client.team,
    summary: `Client tap: team reverted to "${snap.client.team}"`,
    metadata: JSON.stringify({ field: "team", revert: true }),
  });
}

async function restoreL1Fields(ctx: MigrationContext, snap: PreSnapshot): Promise<void> {
  const db = ctx.db;
  const preL1 = snap.projects[0];
  if (!preL1) throw new Error("Revert: pre-snapshot has no L1.");

  const rows = await db.select().from(projects).where(eq(projects.id, preL1.id));
  const current = rows[0];
  if (!current) throw new Error(`Revert: L1 id ${preL1.id} not found.`);

  const fieldsToRestore: Array<{
    field: "name" | "resources" | "engagementType";
    column: "name" | "resources" | "engagementType";
    current: string | null;
    pre: string | null;
  }> = [
    { field: "name", column: "name", current: current.name, pre: preL1.name },
    { field: "resources", column: "resources", current: current.resources, pre: preL1.resources },
    { field: "engagementType", column: "engagementType", current: current.engagementType, pre: preL1.engagementType },
  ];

  for (const f of fieldsToRestore) {
    if (f.current === f.pre) {
      ctx.log(`L1 ${preL1.id}: ${f.field} already at pre-value ${JSON.stringify(f.pre)}, skip.`);
      continue;
    }
    ctx.log(`L1 ${preL1.id}: ${f.field} ${JSON.stringify(f.current)} → ${JSON.stringify(f.pre)}`);
    if (ctx.dryRun) continue;

    // Raw UPDATE so we can restore any field (including non-whitelist engagementType)
    // and uniformly emit an audit row tagged as a revert.
    await db
      .update(projects)
      .set({ [f.column]: f.pre, updatedAt: new Date() } as Partial<typeof projects.$inferSelect>)
      .where(eq(projects.id, preL1.id));

    const idemKey = generateIdempotencyKey(
      "project-field-change",
      preL1.id,
      f.field,
      f.pre ?? "(null)",
      UPDATED_BY
    );
    await insertAuditRecord({
      idempotencyKey: idemKey,
      projectId: preL1.id,
      clientId: preL1.clientId,
      updatedBy: UPDATED_BY,
      updateType: "project-field-change",
      previousValue: f.current,
      newValue: f.pre,
      summary: `Project ${preL1.id}: ${f.field} reverted to ${JSON.stringify(f.pre)}`,
      metadata: JSON.stringify({ field: f.field, revert: true }),
    });
  }
}

async function restoreL2Fields(
  ctx: MigrationContext,
  preW: typeof weekItems.$inferSelect
): Promise<void> {
  const db = ctx.db;
  const rows = await db.select().from(weekItems).where(eq(weekItems.id, preW.id));
  const current = rows[0];
  if (!current) throw new Error(`Revert: L2 id ${preW.id} not found.`);

  const fieldsToRestore: Array<{
    field: "title" | "blockedBy";
    column: "title" | "blockedBy";
    current: string | null;
    pre: string | null;
  }> = [
    { field: "title", column: "title", current: current.title, pre: preW.title },
    { field: "blockedBy", column: "blockedBy", current: current.blockedBy, pre: preW.blockedBy },
  ];

  for (const f of fieldsToRestore) {
    if (f.current === f.pre) {
      ctx.log(`L2 ${preW.id.slice(0, 8)}: ${f.field} already at pre-value, skip.`);
      continue;
    }
    ctx.log(
      `L2 ${preW.id.slice(0, 8)}: ${f.field} ${JSON.stringify(f.current)} → ${JSON.stringify(f.pre)}`
    );
    if (ctx.dryRun) continue;

    await db
      .update(weekItems)
      .set({ [f.column]: f.pre, updatedAt: new Date() } as Partial<typeof weekItems.$inferSelect>)
      .where(eq(weekItems.id, preW.id));

    const idemKey = generateIdempotencyKey(
      "week-field-change",
      preW.id,
      f.field,
      f.pre ?? "(null)",
      UPDATED_BY
    );
    await insertAuditRecord({
      idempotencyKey: idemKey,
      projectId: preW.projectId,
      clientId: preW.clientId,
      updatedBy: UPDATED_BY,
      updateType: "week-field-change",
      previousValue: f.current,
      newValue: f.pre,
      summary: `Week item ${preW.id}: ${f.field} reverted to ${JSON.stringify(f.pre)}`,
      metadata: JSON.stringify({ field: f.field, revert: true }),
    });
  }
}

// ── Verification ─────────────────────────────────────────

async function verify(ctx: MigrationContext, snap: PreSnapshot): Promise<void> {
  ctx.log("--- Verification ---");

  const clientRows = await ctx.db.select().from(clients).where(eq(clients.id, snap.client.id));
  if (clientRows[0].team !== snap.client.team) {
    throw new Error(
      `VERIFICATION FAILED: client.team is "${clientRows[0].team}", expected "${snap.client.team}".`
    );
  }

  const preL1 = snap.projects[0];
  const l1Rows = await ctx.db.select().from(projects).where(eq(projects.id, preL1.id));
  const l1 = l1Rows[0];
  if (l1.name !== preL1.name) throw new Error(`VERIFICATION FAILED: L1.name is "${l1.name}".`);
  if (l1.resources !== preL1.resources)
    throw new Error(`VERIFICATION FAILED: L1.resources is "${l1.resources}".`);
  if (l1.engagementType !== preL1.engagementType)
    throw new Error(`VERIFICATION FAILED: L1.engagement_type is "${l1.engagementType}".`);

  for (const preW of snap.weekItems) {
    const rows = await ctx.db.select().from(weekItems).where(eq(weekItems.id, preW.id));
    const row = rows[0];
    if (row.title !== preW.title)
      throw new Error(
        `VERIFICATION FAILED: L2 ${preW.id.slice(0, 8)} title is "${row.title}", expected "${preW.title}".`
      );
    if (row.blockedBy !== preW.blockedBy)
      throw new Error(
        `VERIFICATION FAILED: L2 ${preW.id.slice(0, 8)} blocked_by is "${row.blockedBy}", expected "${preW.blockedBy}".`
      );
  }

  ctx.log("Revert verification passed.");
}
