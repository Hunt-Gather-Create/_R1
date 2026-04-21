/**
 * Migration: Bonterra Touch-Ups — 2026-04-21
 *
 * Bonterra was the first client cleaned overnight (2026-04-19/20), before the
 * playbook was fully formed. This pass catches 3 post-playbook improvements on
 * the L1 plus 2 L2 touch-ups. No structural changes — only whitelisted field
 * updates via `updateProjectField` / `updateProjectStatus` / `updateWeekItemField`.
 *
 * Ops (pinned order):
 *   Op 1 — L1 `Impact Report` status:      not-started → in-production
 *   Op 2 — L1 `Impact Report` resources:   null → "AM: Jill, Dev: Leslie"
 *   Op 3 — L1 `Impact Report` notes:       null → context string
 *   Op 4 — L2 `Impact Report — Dev K/O` (2026-04-15) status: null → completed
 *          (idempotent — skip if already `completed`)
 *   Op 5 — L2 `Impact Report — Dev Handoff` (2026-04-28) notes: existing → cleaner
 *
 * Pre-state assertions (verified 2026-04-20 by TP):
 *   Bonterra slug: `bonterra`
 *   L1 `Impact Report` owner=Jill, status=not-started, resources=null, notes=null
 *   L2 Dev K/O 2026-04-15 status expected null (or already completed — idempotent)
 *   L2 Dev Handoff 2026-04-28 exists with current notes set
 *
 * Hard constraints:
 *   - No creates, no deletes, no FK changes, no structural work.
 *   - Skips `runway:publish-updates` per cleanup-batch convention.
 */
import { writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { and, eq, like } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { clients, projects, weekItems } from "@/lib/db/runway-schema";
import {
  findProjectByFuzzyName,
  getBatchId,
  updateProjectField,
  updateProjectStatus,
  updateWeekItemField,
} from "@/lib/runway/operations";

// ── Constants ────────────────────────────────────────────

const BONTERRA_SLUG = "bonterra";
const UPDATED_BY = "TP";

const L1_PROJECT_NAME = "Impact Report";

// L1 target values
const L1_NEW_STATUS = "in-production";
const L1_NEW_RESOURCES = "AM: Jill, Dev: Leslie";
const L1_NEW_NOTES =
  "Impact Report build for Bonterra. Hard client deadline 5/11 go-live. Client was 3 weeks late on content, schedule compressed. Dev KO 4/15 (Leslie), Internal Review 4/23, Dev Handoff 4/28.";

// L2 Dev K/O (completed)
const L2_DEV_KO_DATE = "2026-04-15";
const L2_DEV_KO_TITLE_PREFIX = "Impact Report — Dev K/O";
const L2_DEV_KO_NEW_STATUS = "completed";

// L2 Dev Handoff (notes cleanup)
const L2_DEV_HANDOFF_DATE = "2026-04-28";
const L2_DEV_HANDOFF_TITLE_PREFIX = "Impact Report — Dev Handoff";
const L2_DEV_HANDOFF_NEW_NOTES =
  "Final build handoff to client for 5/11 launch. Hard deadline — client was 3 weeks late on content; schedule compressed.";

// ── Exports ──────────────────────────────────────────────

export const description =
  "Bonterra touch-ups 2026-04-21: L1 status/resources/notes populated, L2 Dev K/O → completed, L2 Dev Handoff notes cleaned.";

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("=== Bonterra Touch-Ups 2026-04-21 ===");

  const resolved = await preChecks(ctx);
  await writeSnapshot(ctx, resolved);

  if (ctx.dryRun) {
    ctx.log("Dry-run: no writes will be performed. Operation plan follows.");
  }

  // ── Op 1 — L1 status → in-production (only if currently different) ──
  if (resolved.l1.status !== L1_NEW_STATUS) {
    ctx.log(
      `--- Op 1: L1 '${L1_PROJECT_NAME}' status "${resolved.l1.status}" → "${L1_NEW_STATUS}" ---`
    );
    if (!ctx.dryRun) {
      const result = await updateProjectStatus({
        clientSlug: BONTERRA_SLUG,
        projectName: L1_PROJECT_NAME,
        newStatus: L1_NEW_STATUS,
        updatedBy: UPDATED_BY,
      });
      if (!result.ok) {
        throw new Error(`Op 1 updateProjectStatus failed: ${result.error}`);
      }
    }
  } else {
    ctx.log(`--- Op 1: SKIP — L1 status already "${L1_NEW_STATUS}" ---`);
  }

  // ── Op 2 — L1 resources → "AM: Jill, Dev: Leslie" ──
  if (resolved.l1.resources !== L1_NEW_RESOURCES) {
    ctx.log(
      `--- Op 2: L1 '${L1_PROJECT_NAME}' resources ${
        resolved.l1.resources === null ? "null" : `"${resolved.l1.resources}"`
      } → "${L1_NEW_RESOURCES}" ---`
    );
    if (!ctx.dryRun) {
      const result = await updateProjectField({
        clientSlug: BONTERRA_SLUG,
        projectName: L1_PROJECT_NAME,
        field: "resources",
        newValue: L1_NEW_RESOURCES,
        updatedBy: UPDATED_BY,
      });
      if (!result.ok) {
        throw new Error(`Op 2 updateProjectField(resources) failed: ${result.error}`);
      }
    }
  } else {
    ctx.log(`--- Op 2: SKIP — L1 resources already set ---`);
  }

  // ── Op 3 — L1 notes → context string ──
  if (resolved.l1.notes !== L1_NEW_NOTES) {
    ctx.log(
      `--- Op 3: L1 '${L1_PROJECT_NAME}' notes ${
        resolved.l1.notes === null ? "null" : "<existing>"
      } → <context string> ---`
    );
    if (!ctx.dryRun) {
      const result = await updateProjectField({
        clientSlug: BONTERRA_SLUG,
        projectName: L1_PROJECT_NAME,
        field: "notes",
        newValue: L1_NEW_NOTES,
        updatedBy: UPDATED_BY,
      });
      if (!result.ok) {
        throw new Error(`Op 3 updateProjectField(notes) failed: ${result.error}`);
      }
    }
  } else {
    ctx.log(`--- Op 3: SKIP — L1 notes already set ---`);
  }

  // ── Op 4 — L2 Dev K/O 4/15 status → completed (idempotent) ──
  if (resolved.l2DevKo.status !== L2_DEV_KO_NEW_STATUS) {
    ctx.log(
      `--- Op 4: L2 '${resolved.l2DevKo.title}' (${L2_DEV_KO_DATE}, weekOf=${resolved.l2DevKo.weekOf}) status ${
        resolved.l2DevKo.status === null ? "null" : `"${resolved.l2DevKo.status}"`
      } → "${L2_DEV_KO_NEW_STATUS}" ---`
    );
    if (!ctx.dryRun) {
      const result = await updateWeekItemField({
        weekOf: resolved.l2DevKo.weekOf,
        weekItemTitle: resolved.l2DevKo.title,
        field: "status",
        newValue: L2_DEV_KO_NEW_STATUS,
        updatedBy: UPDATED_BY,
      });
      if (!result.ok) {
        throw new Error(`Op 4 updateWeekItemField(status) failed: ${result.error}`);
      }
    }
  } else {
    ctx.log(`--- Op 4: SKIP — L2 Dev K/O already completed ---`);
  }

  // ── Op 5 — L2 Dev Handoff 4/28 notes cleanup ──
  if (resolved.l2DevHandoff.notes !== L2_DEV_HANDOFF_NEW_NOTES) {
    ctx.log(
      `--- Op 5: L2 '${resolved.l2DevHandoff.title}' (${L2_DEV_HANDOFF_DATE}, weekOf=${resolved.l2DevHandoff.weekOf}) notes → <cleaned string> ---`
    );
    if (!ctx.dryRun) {
      const result = await updateWeekItemField({
        weekOf: resolved.l2DevHandoff.weekOf,
        weekItemTitle: resolved.l2DevHandoff.title,
        field: "notes",
        newValue: L2_DEV_HANDOFF_NEW_NOTES,
        updatedBy: UPDATED_BY,
      });
      if (!result.ok) {
        throw new Error(`Op 5 updateWeekItemField(notes) failed: ${result.error}`);
      }
    }
  } else {
    ctx.log(`--- Op 5: SKIP — L2 Dev Handoff notes already match target ---`);
  }

  if (!ctx.dryRun) {
    await verify(ctx, resolved);
  }

  ctx.log("=== Bonterra Touch-Ups complete ===");
}

// ── Pre-checks ───────────────────────────────────────────

interface ResolvedState {
  readonly bonterra: typeof clients.$inferSelect;
  readonly l1: typeof projects.$inferSelect;
  readonly l2DevKo: typeof weekItems.$inferSelect;
  readonly l2DevHandoff: typeof weekItems.$inferSelect;
}

async function preChecks(ctx: MigrationContext): Promise<ResolvedState> {
  ctx.log("--- Pre-checks ---");

  // Resolve Bonterra client.
  const bonterraRows = await ctx.db
    .select()
    .from(clients)
    .where(eq(clients.slug, BONTERRA_SLUG));
  const bonterra = bonterraRows[0];
  if (!bonterra) {
    throw new Error(`Pre-check failed: client '${BONTERRA_SLUG}' not found.`);
  }

  // Resolve the L1 `Impact Report`.
  const l1Fuzzy = await findProjectByFuzzyName(bonterra.id, L1_PROJECT_NAME);
  if (!l1Fuzzy) {
    throw new Error(
      `Pre-check failed: L1 '${L1_PROJECT_NAME}' not found for Bonterra (fuzzy lookup).`
    );
  }
  const l1Rows = await ctx.db
    .select()
    .from(projects)
    .where(eq(projects.id, l1Fuzzy.id));
  const l1 = l1Rows[0];
  if (!l1) {
    throw new Error(
      `Pre-check failed: L1 '${L1_PROJECT_NAME}' fuzzy-resolved to ${l1Fuzzy.id} but row not found.`
    );
  }

  // Sanity: owner should be Jill per TP pre-state. Non-fatal; log if drift.
  if (l1.owner !== "Jill") {
    ctx.log(
      `  pre-check WARN: L1 owner is "${l1.owner}" (expected "Jill" per TP handoff). Proceeding (not in scope of this migration).`
    );
  }

  // Resolve L2 Dev K/O — client=bonterra, date=2026-04-15, title LIKE 'Impact Report — Dev K/O%'
  const l2DevKoMatches = await ctx.db
    .select()
    .from(weekItems)
    .where(
      and(
        eq(weekItems.clientId, bonterra.id),
        eq(weekItems.date, L2_DEV_KO_DATE),
        like(weekItems.title, `${L2_DEV_KO_TITLE_PREFIX}%`)
      )
    );
  if (l2DevKoMatches.length !== 1) {
    throw new Error(
      `Pre-check failed: L2 Dev K/O (date=${L2_DEV_KO_DATE}, title LIKE "${L2_DEV_KO_TITLE_PREFIX}%") resolved to ${l2DevKoMatches.length} rows (expected 1).`
    );
  }
  const l2DevKo = l2DevKoMatches[0];

  // Idempotency note: if already completed, Op 4 will skip. Current status
  // must be either null OR "completed". Anything else is unexpected drift.
  if (l2DevKo.status !== null && l2DevKo.status !== L2_DEV_KO_NEW_STATUS) {
    throw new Error(
      `Pre-check failed: L2 Dev K/O status is "${l2DevKo.status}", expected null or "${L2_DEV_KO_NEW_STATUS}".`
    );
  }

  // Resolve L2 Dev Handoff — client=bonterra, date=2026-04-28, title LIKE 'Impact Report — Dev Handoff%'
  const l2DevHandoffMatches = await ctx.db
    .select()
    .from(weekItems)
    .where(
      and(
        eq(weekItems.clientId, bonterra.id),
        eq(weekItems.date, L2_DEV_HANDOFF_DATE),
        like(weekItems.title, `${L2_DEV_HANDOFF_TITLE_PREFIX}%`)
      )
    );
  if (l2DevHandoffMatches.length !== 1) {
    throw new Error(
      `Pre-check failed: L2 Dev Handoff (date=${L2_DEV_HANDOFF_DATE}, title LIKE "${L2_DEV_HANDOFF_TITLE_PREFIX}%") resolved to ${l2DevHandoffMatches.length} rows (expected 1).`
    );
  }
  const l2DevHandoff = l2DevHandoffMatches[0];

  ctx.log(
    `Pre-checks passed. bonterra=${bonterra.id}, L1=${l1.id}, L2 Dev K/O=${l2DevKo.id} (status=${l2DevKo.status ?? "null"}), L2 Dev Handoff=${l2DevHandoff.id}.`
  );
  ctx.log(
    `  L1 current: status="${l1.status}", resources=${l1.resources === null ? "null" : `"${l1.resources}"`}, notes=${l1.notes === null ? "null" : "<set>"}`
  );

  return { bonterra, l1, l2DevKo, l2DevHandoff };
}

// ── Snapshot ─────────────────────────────────────────────

async function writeSnapshot(
  ctx: MigrationContext,
  r: ResolvedState
): Promise<void> {
  const capturedAt = new Date().toISOString();

  const snapshot = {
    capturedAt,
    mode: ctx.dryRun ? "dry-run" : "apply",
    batchId: getBatchId(),
    client: r.bonterra,
    l1Current: r.l1,
    l2DevKoCurrent: r.l2DevKo,
    l2DevHandoffCurrent: r.l2DevHandoff,
    plannedUpdates: {
      l1: {
        status: L1_NEW_STATUS,
        resources: L1_NEW_RESOURCES,
        notes: L1_NEW_NOTES,
      },
      l2DevKo: { status: L2_DEV_KO_NEW_STATUS },
      l2DevHandoff: { notes: L2_DEV_HANDOFF_NEW_NOTES },
    },
  };

  const suffix = ctx.dryRun ? "-dryrun" : "";
  const outPath = resolvePath(
    process.cwd(),
    `docs/tmp/bonterra-touchups-pre-apply-snapshot${suffix}.json`
  );
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2), "utf8");
  ctx.log(`Wrote pre-apply snapshot → ${outPath}`);
}

// ── Verification ─────────────────────────────────────────

async function verify(
  ctx: MigrationContext,
  r: ResolvedState
): Promise<void> {
  ctx.log("--- Verification ---");

  // L1 re-fetch
  const l1Rows = await ctx.db
    .select()
    .from(projects)
    .where(eq(projects.id, r.l1.id));
  const l1 = l1Rows[0];
  if (!l1) {
    throw new Error(`VERIFICATION FAILED: L1 '${L1_PROJECT_NAME}' (${r.l1.id}) not found after apply.`);
  }
  if (l1.status !== L1_NEW_STATUS) {
    throw new Error(
      `VERIFICATION FAILED: L1 status is "${l1.status}", expected "${L1_NEW_STATUS}".`
    );
  }
  if (l1.resources !== L1_NEW_RESOURCES) {
    throw new Error(
      `VERIFICATION FAILED: L1 resources is ${l1.resources === null ? "null" : `"${l1.resources}"`}, expected "${L1_NEW_RESOURCES}".`
    );
  }
  if (l1.notes !== L1_NEW_NOTES) {
    throw new Error(
      `VERIFICATION FAILED: L1 notes does not match expected value.`
    );
  }
  ctx.log(`L1 verified: status="${l1.status}", resources="${l1.resources}", notes=<matches>.`);

  // L2 Dev K/O re-fetch
  const l2KoRows = await ctx.db
    .select()
    .from(weekItems)
    .where(eq(weekItems.id, r.l2DevKo.id));
  const l2Ko = l2KoRows[0];
  if (!l2Ko) {
    throw new Error(`VERIFICATION FAILED: L2 Dev K/O (${r.l2DevKo.id}) not found after apply.`);
  }
  if (l2Ko.status !== L2_DEV_KO_NEW_STATUS) {
    throw new Error(
      `VERIFICATION FAILED: L2 Dev K/O status is ${l2Ko.status === null ? "null" : `"${l2Ko.status}"`}, expected "${L2_DEV_KO_NEW_STATUS}".`
    );
  }
  ctx.log(`L2 Dev K/O verified: status="${l2Ko.status}".`);

  // L2 Dev Handoff re-fetch
  const l2HandoffRows = await ctx.db
    .select()
    .from(weekItems)
    .where(eq(weekItems.id, r.l2DevHandoff.id));
  const l2Handoff = l2HandoffRows[0];
  if (!l2Handoff) {
    throw new Error(`VERIFICATION FAILED: L2 Dev Handoff (${r.l2DevHandoff.id}) not found after apply.`);
  }
  if (l2Handoff.notes !== L2_DEV_HANDOFF_NEW_NOTES) {
    throw new Error(`VERIFICATION FAILED: L2 Dev Handoff notes does not match expected value.`);
  }
  ctx.log(`L2 Dev Handoff verified: notes=<matches>.`);

  ctx.log("Verification passed.");
}
