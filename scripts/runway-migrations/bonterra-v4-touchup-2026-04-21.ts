/**
 * Migration: Bonterra v4 Convention Touchup — 2026-04-21
 *
 * Applies v4 convention realignment to the Bonterra client:
 *
 *   Client:  already in v4 (team field populated, contract_status=signed, nicknames).
 *            No writes needed — pre-snapshot captures baseline for reversal.
 *
 *   L1 "Impact Report":
 *     - resources       null → "AM: Jill, CD: Lane -> Dev: Leslie"  (arrow handoff)
 *     - engagement_type null → "project"
 *     - status          null → "in-production"                       (Dev K/O is in-progress)
 *     - category        null → "active"
 *
 *   L2 "Impact Report — Dev K/O" (2026-04-15):
 *     - status in-progress → completed       (start_date has passed; spec halt-rule carve-out)
 *
 * All other L2s are already in v4 shape (projectId linked, owner inherits L1, resources
 * are role-prefixed or Bonterra client-led, categories valid). No writes.
 *
 * Writes a pre-state snapshot (every field on Bonterra client + Impact Report L1 +
 * all 6 Bonterra L2s) before applying so the REVERT script can restore exactly.
 * Pre-snapshot is written in both modes (dry-run suffix `-dryrun.json`).
 *
 * Reverse script: `bonterra-v4-touchup-2026-04-21-REVERT.ts` — reads the
 * `docs/tmp/bonterra-v4-pre-snapshot-2026-04-21.json` snapshot this script writes
 * and restores prior column values.
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve as resolvePath, dirname } from "node:path";
import { eq } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { clients, projects, weekItems } from "@/lib/db/runway-schema";
import {
  generateIdempotencyKey,
  getBatchId,
  insertAuditRecord,
} from "@/lib/runway/operations";

// ── Constants ────────────────────────────────────────────

const BONTERRA_SLUG = "bonterra";
const PARENT_PROJECT_NAME = "Impact Report";
const UPDATED_BY = "migration";
const TODAY_ISO = "2026-04-20";

const PRE_SNAPSHOT_PATH = "docs/tmp/bonterra-v4-pre-snapshot-2026-04-21.json";
const POST_SNAPSHOT_PATH = "docs/tmp/bonterra-v4-post-snapshot-2026-04-21.json";

// Target-state plan for the L1 project. Each entry drives one field write.
const L1_PLAN = {
  resources: "AM: Jill, CD: Lane -> Dev: Leslie",
  engagementType: "project",
  status: "in-production",
  category: "active",
} as const;

// L2 rule: Dev K/O was in-progress pre-state per spec; flip to completed if
// its start_date has passed. Title-based identification (stable across runs).
const L2_DEV_KO_TITLE = "Impact Report — Dev K/O";
const L2_DEV_KO_TARGET_STATUS = "completed";

// ── Exports ──────────────────────────────────────────────

export const description =
  "Bonterra v4 touchup 2026-04-21: realign Impact Report L1 (resources arrow, engagement_type, status, category) + flip Dev K/O L2 to completed.";

// ── Types ────────────────────────────────────────────────

interface PreSnapshot {
  capturedAt: string;
  mode: "dry-run" | "apply";
  batchId: string | null;
  client: typeof clients.$inferSelect | undefined;
  project: typeof projects.$inferSelect | undefined;
  weekItems: Array<typeof weekItems.$inferSelect>;
}

// ── Entry ────────────────────────────────────────────────

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("=== Bonterra v4 Touchup (2026-04-21) ===");

  // Step 1 — Pre-checks + capture snapshot
  const resolved = await preChecks(ctx);
  await writeSnapshot(ctx, resolved, PRE_SNAPSHOT_PATH);

  if (ctx.dryRun) {
    ctx.log("Dry-run: no writes will be performed. Operation plan follows.");
  }

  // Step 2 — L1 field writes
  await applyL1Updates(ctx, resolved.project);

  // Step 3 — L2 Dev K/O status flip
  await applyDevKOStatusFlip(ctx, resolved.devKO);

  // Step 4 — Post-snapshot (apply mode only — dry-run pre-snapshot already stands in
  // for the diff baseline).
  if (!ctx.dryRun) {
    const post = await captureState(ctx);
    await writeSnapshotFromState(ctx, post, POST_SNAPSHOT_PATH, "apply");
    ctx.log("--- Verification ---");
    verifyPostState(post);
    ctx.log("Verification passed.");
  }

  ctx.log("=== Bonterra v4 Touchup complete ===");
}

// ── Pre-checks ───────────────────────────────────────────

interface ResolvedState {
  client: typeof clients.$inferSelect;
  project: typeof projects.$inferSelect;
  weekItems: Array<typeof weekItems.$inferSelect>;
  devKO: typeof weekItems.$inferSelect;
}

async function preChecks(ctx: MigrationContext): Promise<ResolvedState> {
  ctx.log("--- Pre-checks ---");

  // Resolve Bonterra client
  const clientRows = await ctx.db
    .select()
    .from(clients)
    .where(eq(clients.slug, BONTERRA_SLUG));
  const client = clientRows[0];
  if (!client) {
    throw new Error(`Pre-check failed: client '${BONTERRA_SLUG}' not found.`);
  }
  ctx.log(`Resolved client: ${client.name} (id=${client.id})`);

  // Resolve Impact Report L1 (exactly one expected)
  const projectRows = await ctx.db
    .select()
    .from(projects)
    .where(eq(projects.clientId, client.id));
  const impactReport = projectRows.find(
    (p) => p.name.trim() === PARENT_PROJECT_NAME
  );
  if (!impactReport) {
    throw new Error(
      `Pre-check failed: project '${PARENT_PROJECT_NAME}' not found for Bonterra. Did the 2026-04-19 cleanup run?`
    );
  }
  if (projectRows.length !== 1) {
    throw new Error(
      `Pre-check failed: expected exactly 1 Bonterra project, got ${projectRows.length}. HALT (unexpected drift affecting >1 record).`
    );
  }
  ctx.log(`Resolved L1: ${impactReport.name} (id=${impactReport.id})`);

  // Resolve Bonterra week items. The v4-realign spec does not mandate a specific
  // count for Bonterra (unlike the generic 2026-04-19 cleanup which targeted 6).
  // Log count + titles so reviewers can sanity-check against their mental model.
  const items = await ctx.db
    .select()
    .from(weekItems)
    .where(eq(weekItems.clientId, client.id));
  ctx.log(
    `Resolved ${items.length} Bonterra L2(s): ${items.map((w) => `'${w.title}'`).join(", ") || "(none)"}`
  );

  // FK integrity: every Bonterra L2 must point at the single Impact Report L1.
  const wrongParent = items.filter((w) => w.projectId !== impactReport.id);
  if (wrongParent.length > 0) {
    throw new Error(
      `Pre-check failed: ${wrongParent.length} Bonterra week item(s) not linked to Impact Report L1: ${wrongParent
        .map((w) => `'${w.title}' (id=${w.id})`)
        .join(", ")}. HALT (cascade/reparent regression).`
    );
  }

  // Locate the Dev K/O L2 and validate pre-state
  const devKO = items.find((w) => w.title === L2_DEV_KO_TITLE);
  if (!devKO) {
    throw new Error(
      `Pre-check failed: expected a week item titled '${L2_DEV_KO_TITLE}' under Bonterra. HALT.`
    );
  }

  // Spec allows the carve-out ONLY when pre-status is "in-progress" AND start_date has passed.
  // Fall through quietly if it is already "completed" (idempotent re-runs).
  const devKOStart = devKO.startDate ?? devKO.date;
  if (devKO.status === "in-progress") {
    if (!devKOStart || devKOStart > TODAY_ISO) {
      throw new Error(
        `Pre-check failed: Dev K/O pre-status is in-progress but start_date '${devKOStart}' has not passed today (${TODAY_ISO}). Spec requires start_date passed before flipping to completed. HALT.`
      );
    }
  } else if (devKO.status === "completed") {
    ctx.log(`Dev K/O already 'completed' — will no-op this write.`);
  } else {
    throw new Error(
      `Pre-check failed: Dev K/O pre-status is '${devKO.status}', expected 'in-progress' or 'completed'. HALT (unexpected drift).`
    );
  }

  // Validate L1 pre-state matches what we expect to write (idempotency protection).
  // Throwing here would be overkill — just log so the dry-run review surfaces it.
  const drift: string[] = [];
  if (impactReport.resources !== null && impactReport.resources !== L1_PLAN.resources) {
    drift.push(`resources='${impactReport.resources}' (will overwrite)`);
  }
  if (impactReport.engagementType !== null && impactReport.engagementType !== L1_PLAN.engagementType) {
    drift.push(`engagementType='${impactReport.engagementType}' (will overwrite)`);
  }
  if (impactReport.status !== null && impactReport.status !== L1_PLAN.status) {
    drift.push(`status='${impactReport.status}' (will overwrite)`);
  }
  if (impactReport.category !== null && impactReport.category !== L1_PLAN.category) {
    drift.push(`category='${impactReport.category}' (will overwrite)`);
  }
  if (drift.length > 0) {
    ctx.log(
      `L1 pre-state drift (values differ from spec target — still writing, but worth surfacing): ${drift.join(", ")}`
    );
  }

  ctx.log("Pre-checks passed.");

  return {
    client,
    project: impactReport,
    weekItems: items,
    devKO,
  };
}

// ── Snapshot helpers ────────────────────────────────────

async function captureState(ctx: MigrationContext): Promise<PreSnapshot> {
  const capturedAt = new Date().toISOString();
  const clientRows = await ctx.db
    .select()
    .from(clients)
    .where(eq(clients.slug, BONTERRA_SLUG));
  const client = clientRows[0];
  if (!client) {
    throw new Error("captureState: Bonterra client not found.");
  }
  const projectRows = await ctx.db
    .select()
    .from(projects)
    .where(eq(projects.clientId, client.id));
  const project = projectRows.find((p) => p.name.trim() === PARENT_PROJECT_NAME);
  const items = await ctx.db
    .select()
    .from(weekItems)
    .where(eq(weekItems.clientId, client.id));

  return {
    capturedAt,
    mode: ctx.dryRun ? "dry-run" : "apply",
    batchId: getBatchId(),
    client,
    project,
    weekItems: items,
  };
}

async function writeSnapshot(
  ctx: MigrationContext,
  resolved: ResolvedState,
  basePath: string
): Promise<void> {
  const snapshot: PreSnapshot = {
    capturedAt: new Date().toISOString(),
    mode: ctx.dryRun ? "dry-run" : "apply",
    batchId: getBatchId(),
    client: resolved.client,
    project: resolved.project,
    weekItems: resolved.weekItems,
  };
  await writeSnapshotFromState(ctx, snapshot, basePath, snapshot.mode);
}

async function writeSnapshotFromState(
  ctx: MigrationContext,
  snapshot: PreSnapshot,
  basePath: string,
  _mode: "dry-run" | "apply"
): Promise<void> {
  // Dry-run pre-snapshots get `-dryrun` suffix so apply-mode pre-snapshot is
  // the authoritative artifact the REVERT script reads. Post-snapshots only
  // exist on apply, so no suffix.
  const isPre = basePath.includes("pre-snapshot");
  const suffix = ctx.dryRun && isPre ? "-dryrun" : "";
  const outPath = resolvePath(
    process.cwd(),
    basePath.replace(".json", `${suffix}.json`)
  );
  const dir = dirname(outPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2), "utf8");
  ctx.log(`Wrote snapshot → ${outPath}`);
}

// ── L1 updates ───────────────────────────────────────────

async function applyL1Updates(
  ctx: MigrationContext,
  project: typeof projects.$inferSelect
): Promise<void> {
  const writes: Array<{
    column: "resources" | "engagementType" | "status" | "category";
    field: string; // human-readable field name for audit rows
    previousValue: string | null;
    newValue: string;
  }> = [
    {
      column: "resources",
      field: "resources",
      previousValue: project.resources,
      newValue: L1_PLAN.resources,
    },
    {
      column: "engagementType",
      field: "engagementType",
      previousValue: project.engagementType,
      newValue: L1_PLAN.engagementType,
    },
    {
      column: "status",
      field: "status",
      previousValue: project.status,
      newValue: L1_PLAN.status,
    },
    {
      column: "category",
      field: "category",
      previousValue: project.category,
      newValue: L1_PLAN.category,
    },
  ];

  for (const w of writes) {
    if (w.previousValue === w.newValue) {
      ctx.log(`L1 ${w.field}: already "${w.newValue}" — skip.`);
      continue;
    }
    ctx.log(`L1 ${w.field}: "${w.previousValue ?? "(null)"}" → "${w.newValue}"`);
    if (ctx.dryRun) continue;

    // Raw update — v4 columns (engagement_type, status) are not in PROJECT_FIELDS
    // whitelist, and `resources`/`category` are but we're writing several fields
    // atomically alongside them. Wrap all four into one UPDATE + per-field audit
    // rows for clean publish-updates rendering.
    await ctx.db
      .update(projects)
      .set({ [w.column]: w.newValue, updatedAt: new Date() })
      .where(eq(projects.id, project.id));

    const idemKey = generateIdempotencyKey(
      "field-change",
      project.id,
      w.field,
      w.newValue,
      UPDATED_BY
    );
    await insertAuditRecord({
      idempotencyKey: idemKey,
      projectId: project.id,
      clientId: project.clientId,
      updatedBy: UPDATED_BY,
      updateType: "field-change",
      previousValue: w.previousValue,
      newValue: w.newValue,
      summary: `Bonterra / ${project.name}: ${w.field} changed from "${w.previousValue ?? ""}" to "${w.newValue}"`,
      metadata: JSON.stringify({ field: w.field }),
    });
  }
}

// ── L2 Dev K/O status flip ──────────────────────────────

async function applyDevKOStatusFlip(
  ctx: MigrationContext,
  devKO: typeof weekItems.$inferSelect
): Promise<void> {
  if (devKO.status === L2_DEV_KO_TARGET_STATUS) {
    ctx.log(`L2 ${devKO.title}: status already "${L2_DEV_KO_TARGET_STATUS}" — skip.`);
    return;
  }
  const previous = devKO.status;
  ctx.log(`L2 ${devKO.title}: status "${previous ?? "(null)"}" → "${L2_DEV_KO_TARGET_STATUS}"`);
  if (ctx.dryRun) return;

  await ctx.db
    .update(weekItems)
    .set({ status: L2_DEV_KO_TARGET_STATUS, updatedAt: new Date() })
    .where(eq(weekItems.id, devKO.id));

  const idemKey = generateIdempotencyKey(
    "week-field-change",
    devKO.id,
    "status",
    L2_DEV_KO_TARGET_STATUS,
    UPDATED_BY
  );
  await insertAuditRecord({
    idempotencyKey: idemKey,
    clientId: devKO.clientId,
    projectId: devKO.projectId,
    updatedBy: UPDATED_BY,
    updateType: "week-field-change",
    previousValue: previous,
    newValue: L2_DEV_KO_TARGET_STATUS,
    summary: `Week item '${devKO.title}': status changed from "${previous ?? ""}" to "${L2_DEV_KO_TARGET_STATUS}"`,
    metadata: JSON.stringify({ field: "status" }),
  });
}

// ── Verification ─────────────────────────────────────────

function verifyPostState(snap: PreSnapshot): void {
  if (!snap.project) {
    throw new Error("VERIFICATION FAILED: Impact Report project missing post-apply.");
  }
  if (snap.project.resources !== L1_PLAN.resources) {
    throw new Error(
      `VERIFICATION FAILED: L1 resources is "${snap.project.resources}", expected "${L1_PLAN.resources}".`
    );
  }
  if (snap.project.engagementType !== L1_PLAN.engagementType) {
    throw new Error(
      `VERIFICATION FAILED: L1 engagementType is "${snap.project.engagementType}", expected "${L1_PLAN.engagementType}".`
    );
  }
  if (snap.project.status !== L1_PLAN.status) {
    throw new Error(
      `VERIFICATION FAILED: L1 status is "${snap.project.status}", expected "${L1_PLAN.status}".`
    );
  }
  if (snap.project.category !== L1_PLAN.category) {
    throw new Error(
      `VERIFICATION FAILED: L1 category is "${snap.project.category}", expected "${L1_PLAN.category}".`
    );
  }
  const devKO = snap.weekItems.find((w) => w.title === L2_DEV_KO_TITLE);
  if (!devKO) {
    throw new Error(`VERIFICATION FAILED: Dev K/O L2 missing post-apply.`);
  }
  if (devKO.status !== L2_DEV_KO_TARGET_STATUS) {
    throw new Error(
      `VERIFICATION FAILED: Dev K/O status is "${devKO.status}", expected "${L2_DEV_KO_TARGET_STATUS}".`
    );
  }
}
