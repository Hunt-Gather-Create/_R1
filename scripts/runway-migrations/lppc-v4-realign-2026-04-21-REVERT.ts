/**
 * Migration REVERSE: LPPC v4 Realign — 2026-04-21 (REVERT)
 *
 * Reverts the fields written by `lppc-v4-realign-2026-04-21.ts`:
 *   - engagement_type on all 7 LPPC L1s → back to pre-apply value (null)
 *   - resources on the 2 active L1s → back to pre-apply value
 *   - start_date / end_date on all 7 L1s → back to pre-apply value (derivation
 *     call in forward script may have written values even if they matched;
 *     we restore the exact pre-state bytes)
 *
 * Reads `docs/tmp/lppc-v4-pre-snapshot-2026-04-21.json` (the canonical
 * pre-snapshot, not the migration-written pre-apply snapshot — the canonical
 * one is source of truth captured before the forward script ran).
 *
 * All writes go through raw `ctx.db.update()` + manual audit records so the
 * revert is auditable. We do NOT call `recomputeProjectDates` — we want
 * exact restoration of the pre-state dates.
 *
 * Dry-run prints planned reverts without writing.
 */

import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { eq } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { projects } from "@/lib/db/runway-schema";
import {
  generateIdempotencyKey,
  insertAuditRecord,
} from "@/lib/runway/operations";

const PRE_SNAPSHOT_PATH = "docs/tmp/lppc-v4-pre-snapshot-2026-04-21.json";
const UPDATED_BY = "migration-revert";

interface ProjectRow {
  id: string;
  clientId: string;
  name: string;
  engagementType: string | null;
  resources: string | null;
  startDate: string | null;
  endDate: string | null;
}

interface PreSnapshot {
  client: { id: string; slug: string; name: string };
  projects: ProjectRow[];
}

export const description =
  "LPPC v4 realign REVERT (2026-04-21): restore engagement_type / resources / start_date / end_date on all 7 LPPC L1s to pre-apply values.";

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("=== LPPC v4 Realign REVERT (2026-04-21) ===");

  // Step 1 — Load pre-snapshot
  const snapshotPath = resolvePath(process.cwd(), PRE_SNAPSHOT_PATH);
  let preSnapshot: PreSnapshot;
  try {
    preSnapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as PreSnapshot;
  } catch (err) {
    throw new Error(
      `Failed to read pre-snapshot at ${snapshotPath}: ${err instanceof Error ? err.message : err}`
    );
  }

  const clientId = preSnapshot.client.id;
  ctx.log(
    `Loaded pre-snapshot for client '${preSnapshot.client.name}' (id=${clientId}); ${preSnapshot.projects.length} L1s.`
  );

  // Step 2 — For each L1 in pre-snapshot, diff against current DB and restore
  // any field the forward migration touched.
  for (const preRow of preSnapshot.projects) {
    const rows = await ctx.db
      .select()
      .from(projects)
      .where(eq(projects.id, preRow.id));
    const current = rows[0];
    if (!current) {
      throw new Error(
        `Revert pre-check failed: project id ${preRow.id} ('${preRow.name}') not in DB.`
      );
    }

    const changes: Array<{ field: string; from: string | null; to: string | null }> = [];
    const patch: Partial<{
      engagementType: string | null;
      resources: string | null;
      startDate: string | null;
      endDate: string | null;
      updatedAt: Date;
    }> = {};

    if (current.engagementType !== preRow.engagementType) {
      patch.engagementType = preRow.engagementType;
      changes.push({ field: "engagementType", from: current.engagementType, to: preRow.engagementType });
    }
    if (current.resources !== preRow.resources) {
      patch.resources = preRow.resources;
      changes.push({ field: "resources", from: current.resources, to: preRow.resources });
    }
    if (current.startDate !== preRow.startDate) {
      patch.startDate = preRow.startDate;
      changes.push({ field: "startDate", from: current.startDate, to: preRow.startDate });
    }
    if (current.endDate !== preRow.endDate) {
      patch.endDate = preRow.endDate;
      changes.push({ field: "endDate", from: current.endDate, to: preRow.endDate });
    }

    if (changes.length === 0) {
      ctx.log(`Project '${preRow.name}': no reverts needed.`);
      continue;
    }

    for (const c of changes) {
      ctx.log(
        `Project '${preRow.name}': revert ${c.field} "${c.from ?? "null"}" → "${c.to ?? "null"}"`
      );
    }
    if (ctx.dryRun) continue;

    patch.updatedAt = new Date();
    await ctx.db.update(projects).set(patch).where(eq(projects.id, preRow.id));

    // One audit record per field reverted
    for (const c of changes) {
      const idemKey = generateIdempotencyKey(
        "field-change-revert",
        preRow.id,
        c.field,
        String(c.to),
        UPDATED_BY
      );
      await insertAuditRecord({
        idempotencyKey: idemKey,
        projectId: preRow.id,
        clientId,
        updatedBy: UPDATED_BY,
        updateType: "field-change",
        previousValue: c.from ?? null,
        newValue: c.to ?? null,
        summary: `LPPC / ${preRow.name}: ${c.field} reverted from "${c.from ?? "null"}" to "${c.to ?? "null"}" (lppc-v4-realign revert)`,
        metadata: JSON.stringify({ field: c.field, revert: true }),
      });
    }
  }

  ctx.log("=== LPPC v4 Realign REVERT complete ===");
}
