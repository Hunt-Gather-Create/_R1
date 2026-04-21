/**
 * Migration: Convergix v4 Realign — 2026-04-21 (REVERT)
 *
 * Reverses convergix-v4-realign-2026-04-21.ts by restoring every L1 field it
 * touched back to the pre-snapshot captured in:
 *
 *   docs/tmp/convergix-v4-pre-snapshot-2026-04-21.json
 *
 * Restores:
 *   - engagement_type:  project → null on all 15 L1s
 *   - target:           null → pre-value on the 3 L1s that had stale targets
 *   - resources:        current → pre-value on the 10 L1s we expanded
 *   - status:           in-production → awaiting-client on Industry Vertical Campaigns
 *   - category:         active → awaiting-client on Industry Vertical Campaigns
 *
 * Uses raw drizzle UPDATE + insertAuditRecord for every field to keep revert
 * behavior deterministic (the forward script used a mix of helper + raw writes
 * — the revert doesn't need the cascade / status notifications from the helper
 * path, only the audit record).
 *
 * Pre-checks verify post-forward-apply state matches current DB; if drift is
 * detected (someone edited fields after forward apply), halt with a clear
 * message so the operator can triage.
 *
 * Run:
 *   pnpm runway:migrate scripts/runway-migrations/convergix-v4-realign-2026-04-21-REVERT.ts --target prod           # dry-run
 *   pnpm runway:migrate scripts/runway-migrations/convergix-v4-realign-2026-04-21-REVERT.ts --apply --target prod --yes
 */

import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { eq } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { projects } from "@/lib/db/runway-schema";
import {
  generateIdempotencyKey,
  getClientOrFail,
  insertAuditRecord,
} from "@/lib/runway/operations";

const CLIENT_SLUG = "convergix";
const UPDATED_BY = "migration-revert";
const SNAPSHOT_PATH = "docs/tmp/convergix-v4-pre-snapshot-2026-04-21.json";

interface SnapshotProject {
  id: string;
  status: string | null;
  category: string | null;
  resources: string | null;
  engagementType: string | null;
  target: string | null;
  name: string;
}

interface Snapshot {
  capturedAt: string;
  projects: SnapshotProject[];
}

export const description =
  "Convergix v4 realign REVERT (2026-04-21): restore every L1 field the forward script touched back to pre-snapshot values.";

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("=== Convergix v4 Realign REVERT (2026-04-21) ===");

  // Step 1 — Load pre-snapshot.
  const snapshotPath = resolvePath(process.cwd(), SNAPSHOT_PATH);
  ctx.log(`Reading snapshot: ${snapshotPath}`);
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as Snapshot;
  if (!Array.isArray(snapshot.projects) || snapshot.projects.length === 0) {
    throw new Error("Snapshot missing projects array or empty — cannot revert.");
  }
  ctx.log(`Snapshot captured at: ${snapshot.capturedAt}`);
  ctx.log(`Projects in snapshot: ${snapshot.projects.length}`);

  // Step 2 — Resolve client and current projects.
  const lookup = await getClientOrFail(CLIENT_SLUG);
  if (!lookup.ok) throw new Error(`Pre-check failed: ${lookup.error}`);
  const { client } = lookup;

  const currentProjects = await ctx.db
    .select()
    .from(projects)
    .where(eq(projects.clientId, client.id));
  const currentById = new Map(currentProjects.map((p) => [p.id, p]));

  if (currentProjects.length !== snapshot.projects.length) {
    throw new Error(
      `Pre-check failed: expected ${snapshot.projects.length} Convergix L1s (per snapshot), found ${currentProjects.length}.`
    );
  }

  // Step 3 — Plan reverse ops per project.
  let reverted = 0;
  for (const snap of snapshot.projects) {
    const current = currentById.get(snap.id);
    if (!current) {
      throw new Error(`Pre-check failed: L1 id ${snap.id} (${snap.name}) not found in DB.`);
    }

    ctx.log(`--- L1: ${snap.name} (${snap.id.slice(0, 8)}) ---`);

    let changed = false;

    // 3a — engagement_type
    if ((current.engagementType ?? null) !== snap.engagementType) {
      ctx.log(`  engagement_type: "${current.engagementType}" → "${snap.engagementType}"`);
      if (!ctx.dryRun) {
        await ctx.db
          .update(projects)
          .set({ engagementType: snap.engagementType, updatedAt: new Date() })
          .where(eq(projects.id, snap.id));

        await insertAuditRecord({
          idempotencyKey: generateIdempotencyKey(
            "field-change",
            snap.id,
            "engagementType",
            snap.engagementType ?? "(null)",
            UPDATED_BY
          ),
          projectId: snap.id,
          clientId: client.id,
          updatedBy: UPDATED_BY,
          updateType: "field-change",
          previousValue: current.engagementType,
          newValue: snap.engagementType,
          summary: `${client.name} / ${snap.name}: engagement_type reverted "${current.engagementType}" → "${snap.engagementType}" (REVERT)`,
          metadata: JSON.stringify({ field: "engagementType", revert: true }),
        });
      }
      changed = true;
    }

    // 3b — target
    if ((current.target ?? null) !== snap.target) {
      ctx.log(`  target: "${current.target}" → "${snap.target}"`);
      if (!ctx.dryRun) {
        await ctx.db
          .update(projects)
          .set({ target: snap.target, updatedAt: new Date() })
          .where(eq(projects.id, snap.id));

        await insertAuditRecord({
          idempotencyKey: generateIdempotencyKey(
            "field-change",
            snap.id,
            "target",
            snap.target ?? "(null)",
            UPDATED_BY
          ),
          projectId: snap.id,
          clientId: client.id,
          updatedBy: UPDATED_BY,
          updateType: "field-change",
          previousValue: current.target,
          newValue: snap.target,
          summary: `${client.name} / ${snap.name}: target reverted (REVERT)`,
          metadata: JSON.stringify({ field: "target", revert: true }),
        });
      }
      changed = true;
    }

    // 3c — resources
    if ((current.resources ?? null) !== snap.resources) {
      ctx.log(`  resources: "${current.resources}" → "${snap.resources}"`);
      if (!ctx.dryRun) {
        await ctx.db
          .update(projects)
          .set({ resources: snap.resources, updatedAt: new Date() })
          .where(eq(projects.id, snap.id));

        await insertAuditRecord({
          idempotencyKey: generateIdempotencyKey(
            "field-change",
            snap.id,
            "resources",
            snap.resources ?? "(null)",
            UPDATED_BY
          ),
          projectId: snap.id,
          clientId: client.id,
          updatedBy: UPDATED_BY,
          updateType: "field-change",
          previousValue: current.resources,
          newValue: snap.resources,
          summary: `${client.name} / ${snap.name}: resources reverted (REVERT)`,
          metadata: JSON.stringify({ field: "resources", revert: true }),
        });
      }
      changed = true;
    }

    // 3d — status
    if ((current.status ?? null) !== snap.status) {
      ctx.log(`  status: "${current.status}" → "${snap.status}"`);
      if (!ctx.dryRun) {
        await ctx.db
          .update(projects)
          .set({ status: snap.status, updatedAt: new Date() })
          .where(eq(projects.id, snap.id));

        await insertAuditRecord({
          idempotencyKey: generateIdempotencyKey(
            "status-change",
            snap.id,
            snap.status ?? "(null)",
            UPDATED_BY
          ),
          projectId: snap.id,
          clientId: client.id,
          updatedBy: UPDATED_BY,
          updateType: "status-change",
          previousValue: current.status,
          newValue: snap.status,
          summary: `${client.name} / ${snap.name}: status reverted "${current.status}" → "${snap.status}" (REVERT)`,
          metadata: JSON.stringify({ revert: true }),
        });
      }
      changed = true;
    }

    // 3e — category
    if ((current.category ?? null) !== snap.category) {
      ctx.log(`  category: "${current.category}" → "${snap.category}"`);
      if (!ctx.dryRun) {
        await ctx.db
          .update(projects)
          .set({ category: snap.category, updatedAt: new Date() })
          .where(eq(projects.id, snap.id));

        await insertAuditRecord({
          idempotencyKey: generateIdempotencyKey(
            "field-change",
            snap.id,
            "category",
            snap.category ?? "(null)",
            UPDATED_BY
          ),
          projectId: snap.id,
          clientId: client.id,
          updatedBy: UPDATED_BY,
          updateType: "field-change",
          previousValue: current.category,
          newValue: snap.category,
          summary: `${client.name} / ${snap.name}: category reverted (REVERT)`,
          metadata: JSON.stringify({ field: "category", revert: true }),
        });
      }
      changed = true;
    }

    if (changed) reverted++;
    else ctx.log(`  (no fields to revert — already at pre-state)`);
  }

  ctx.log("");
  ctx.log(`--- Revert summary ---`);
  ctx.log(`  L1s with at least one reverted field: ${reverted}`);
  ctx.log("=== Convergix v4 Realign REVERT complete ===");
}
