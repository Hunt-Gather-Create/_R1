/**
 * Migration: Dave Asprey Client Cleanup — Part 2 (Recovery) — 2026-04-21
 *
 * Recovery follow-up to `dave-asprey-cleanup-2026-04-21.ts`. Op 1 of the
 * original migration (rename + field-update of `Social Content — Wind Down`
 * → `Social Retainer — Wind Down`) succeeded; Ops 2–6 halted because the
 * `linkWeekItemToProject` helper is not available on this branch (it was
 * moved to `backup/pr86-work` during PR #85 cleanup).
 *
 * This script finishes the cleanup using ONLY MCP-compatible helpers —
 * specifically `deleteWeekItem`, `deleteProject`, and `createWeekItem`.
 * We do NOT try to relink the orphan week item; we delete it and re-create
 * the disconnect task as a new L2 under the consolidated parent. Net effect
 * on the data is the same shape the original migration intended:
 *
 *   Final L1 for Dave Asprey:   Social Retainer — Wind Down (untouched)
 *   Final L2s under that L1:
 *     - Daily Social Posts + ManyChat — Retainer (through 4/30)   [new]
 *     - Disconnect Google Sheet from ManyChat (2026-04-29)        [new]
 *     - Retainer Close — Final Post (2026-04-30)                  [new]
 *
 * Ops (pinned order):
 *   Op 1 — Delete orphaned week item `Disconnect Google Sheet from Dave ManyChat`
 *          (2026-04-29, projectId MUST be NULL pre-delete — invariant).
 *   Op 2 — Delete redundant L1 `Disconnect Google Sheet from ManyChat`
 *          (MUST have 0 linked children pre-delete — invariant).
 *   Op 3 — Create new L2 `Disconnect Google Sheet from ManyChat` under the
 *          consolidated L1 (2026-04-29, deadline, owner=Jason).
 *   Op 4 — Create new L2 `Daily Social Posts + ManyChat — Retainer (through 4/30)`
 *          under the consolidated L1 (2026-04-20, delivery, in-progress, owner=Allison).
 *   Op 5 — Create new L2 `Retainer Close — Final Post` under the consolidated L1
 *          (2026-04-30, deadline, owner=Allison).
 *
 * Pre-state assertions (verified 2026-04-21 by TP + prior agent):
 *   Dave Asprey id: 7d22f3b6e72640499e78dbfd1
 *   L1 `Social Retainer — Wind Down` exists, fully configured (Op 1 of part 1 applied).
 *   L1 `Disconnect Google Sheet from ManyChat` exists, 0 linked children.
 *   Orphan week item `Disconnect Google Sheet from Dave ManyChat` (2026-04-29) has
 *     projectId = NULL.
 *   No other Dave Asprey week items exist.
 */
import { writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { and, eq, isNull, like, ne } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { clients, projects, weekItems } from "@/lib/db/runway-schema";
import {
  createWeekItem,
  deleteProject,
  deleteWeekItem,
  findProjectByFuzzyName,
  getBatchId,
} from "@/lib/runway/operations";

// ── Constants ────────────────────────────────────────────

const DAVE_SLUG = "dave-asprey";
const DAVE_ID = "7d22f3b6e72640499e78dbfd1";
const UPDATED_BY = "TP";

// The consolidated L1 (already renamed + configured by Op 1 of the prior migration).
const PARENT_NAME = "Social Retainer — Wind Down";

// L1 to delete (redundant after consolidation).
const DELETE_PARENT_NAME = "Disconnect Google Sheet from ManyChat";

// Orphan week item to delete.
const ORPHAN_ITEM_TITLE = "Disconnect Google Sheet from Dave ManyChat";
const ORPHAN_ITEM_DATE = "2026-04-29";
const ORPHAN_ITEM_WEEKOF = "2026-04-27";

// ── New L2 week items (3 creates) ────────────────────────

interface CreateWeekItemSpec {
  readonly title: string;
  readonly date: string;
  readonly dayOfWeek: string;
  readonly weekOf: string;
  readonly category: string;
  readonly status?: string;
  readonly owner: string;
  readonly resources?: string;
  readonly notes: string;
}

const CREATE_WEEK_ITEM_SPECS: readonly CreateWeekItemSpec[] = [
  {
    title: "Disconnect Google Sheet from ManyChat",
    date: "2026-04-29",
    dayOfWeek: "wednesday",
    weekOf: "2026-04-27",
    category: "deadline",
    // status: null (not-started)
    owner: "Jason",
    resources: "PM: Jason",
    notes: "Clean cutoff task. Part of retainer wind-down.",
  },
  {
    title: "Daily Social Posts + ManyChat — Retainer (through 4/30)",
    date: "2026-04-20",
    dayOfWeek: "monday",
    weekOf: "2026-04-20",
    category: "delivery",
    status: "in-progress",
    owner: "Allison",
    // resources: null
    notes:
      "Daily posts weekdays + pre-scheduled weekend content. ManyChat flow maintenance. Retainer ends 4/30 EOM. Do not split into daily items — this represents the ongoing workstream.",
  },
  {
    title: "Retainer Close — Final Post",
    date: "2026-04-30",
    dayOfWeek: "thursday",
    weekOf: "2026-04-27",
    category: "deadline",
    // status: null (not-started)
    owner: "Allison",
    // resources: null
    notes:
      "Last day of retainer. Final post published. Account closeout. No work after this date.",
  },
] as const;

// ── Exports ──────────────────────────────────────────────

export const description =
  "Dave Asprey cleanup part 2 (recovery) 2026-04-21: delete orphan disconnect week item, delete redundant Disconnect L1, create 3 new L2s (Disconnect, Daily Social, Retainer Close) under Social Retainer — Wind Down.";

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("=== Dave Asprey Cleanup Part 2 (Recovery) 2026-04-21 ===");

  // Step 1 — Pre-checks
  const resolved = await preChecks(ctx);

  // Step 2 — Pre-write snapshot
  await writeSnapshot(ctx, resolved);

  if (ctx.dryRun) {
    ctx.log("Dry-run: no writes will be performed. Operation plan follows.");
  }

  // ── Op 1 — Delete orphan week item ────────────────────
  ctx.log(
    `--- Op 1: delete orphan week item "${ORPHAN_ITEM_TITLE}" (weekOf=${resolved.orphanItem.weekOf}, date=${resolved.orphanItem.date}, projectId=null) ---`
  );
  if (!ctx.dryRun) {
    const result = await deleteWeekItem({
      id: resolved.orphanItem.id,
      updatedBy: UPDATED_BY,
    });
    if (!result.ok) {
      throw new Error(`Delete orphan '${ORPHAN_ITEM_TITLE}' failed: ${result.error}`);
    }
  }

  // ── Op 2 — Delete redundant L1 ────────────────────────
  ctx.log(
    `--- Op 2: delete redundant L1 '${DELETE_PARENT_NAME}' (id=${resolved.deleteParent.id}, 0 children) ---`
  );
  if (!ctx.dryRun) {
    const result = await deleteProject({
      clientSlug: DAVE_SLUG,
      projectName: DELETE_PARENT_NAME,
      updatedBy: UPDATED_BY,
    });
    if (!result.ok) {
      throw new Error(`Delete '${DELETE_PARENT_NAME}' failed: ${result.error}`);
    }
  }

  // ── Op 3/4/5 — Create 3 new L2s under PARENT_NAME ──────
  for (let i = 0; i < CREATE_WEEK_ITEM_SPECS.length; i++) {
    const spec = CREATE_WEEK_ITEM_SPECS[i];
    ctx.log(`--- Op ${i + 3}: create L2 '${spec.title}' ---`);
    await applyCreateWeekItem(ctx, spec);
  }

  // ── Verification ──
  if (!ctx.dryRun) {
    await verify(ctx, resolved);
  }

  ctx.log("=== Dave Asprey Cleanup Part 2 complete ===");
}

// ── Pre-checks ───────────────────────────────────────────

interface ResolvedState {
  readonly dave: typeof clients.$inferSelect;
  readonly parent: typeof projects.$inferSelect;
  readonly deleteParent: typeof projects.$inferSelect;
  readonly orphanItem: typeof weekItems.$inferSelect;
}

async function preChecks(ctx: MigrationContext): Promise<ResolvedState> {
  ctx.log("--- Pre-checks ---");

  // Resolve Dave Asprey client
  const daveRows = await ctx.db
    .select()
    .from(clients)
    .where(eq(clients.slug, DAVE_SLUG));
  const dave = daveRows[0];
  if (!dave) {
    throw new Error(`Pre-check failed: client '${DAVE_SLUG}' not found.`);
  }
  if (dave.id !== DAVE_ID) {
    throw new Error(
      `Pre-check failed: Dave Asprey ID mismatch (got ${dave.id}, expected ${DAVE_ID}). Abort.`
    );
  }

  // Resolve the consolidated parent L1 (must exist — previous migration Op 1 renamed it).
  const allDaveProjects = await ctx.db
    .select()
    .from(projects)
    .where(eq(projects.clientId, dave.id));

  const parent = allDaveProjects.find(
    (p) => p.name.trim().toLowerCase() === PARENT_NAME.toLowerCase()
  );
  if (!parent) {
    throw new Error(
      `Pre-check failed: consolidated parent '${PARENT_NAME}' not found for Dave Asprey. Expected from prior migration Op 1. Abort.`
    );
  }

  // Resolve the redundant L1 we intend to delete.
  const deleteParent = allDaveProjects.find(
    (p) => p.name.trim().toLowerCase() === DELETE_PARENT_NAME.toLowerCase()
  );
  if (!deleteParent) {
    throw new Error(
      `Pre-check failed: delete-target L1 '${DELETE_PARENT_NAME}' not found for Dave Asprey. Abort.`
    );
  }

  // Assert the delete-target has 0 linked children.
  const deleteChildren = await ctx.db
    .select({ id: weekItems.id })
    .from(weekItems)
    .where(eq(weekItems.projectId, deleteParent.id));
  if (deleteChildren.length !== 0) {
    throw new Error(
      `Pre-check failed: delete-target '${DELETE_PARENT_NAME}' has ${deleteChildren.length} linked child(ren), expected 0. State changed since pre-check — Abort.`
    );
  }

  // Resolve the orphan week item.
  const allDaveItems = await ctx.db
    .select()
    .from(weekItems)
    .where(eq(weekItems.clientId, dave.id));

  const orphanMatches = allDaveItems.filter(
    (i) =>
      i.title === ORPHAN_ITEM_TITLE &&
      i.date === ORPHAN_ITEM_DATE
  );
  if (orphanMatches.length !== 1) {
    throw new Error(
      `Pre-check failed: orphan week item '${ORPHAN_ITEM_TITLE}' (${ORPHAN_ITEM_DATE}) resolved to ${orphanMatches.length} rows (expected 1). Abort.`
    );
  }
  const orphanItem = orphanMatches[0];

  // Strict invariant: the orphan MUST have projectId = null. If it now points
  // at something, state has drifted and we must stop.
  if (orphanItem.projectId !== null) {
    throw new Error(
      `Pre-check failed: orphan '${ORPHAN_ITEM_TITLE}' has non-null projectId=${orphanItem.projectId}. State changed since pre-check — Abort.`
    );
  }
  if (orphanItem.weekOf !== ORPHAN_ITEM_WEEKOF) {
    throw new Error(
      `Pre-check failed: orphan '${ORPHAN_ITEM_TITLE}' weekOf="${orphanItem.weekOf}", expected "${ORPHAN_ITEM_WEEKOF}". Abort.`
    );
  }

  // Assert none of the 3 new L2 titles already exist under the parent at their
  // target weekOf — protects against partial re-run.
  for (const spec of CREATE_WEEK_ITEM_SPECS) {
    const clash = allDaveItems.find(
      (i) =>
        i.title.trim().toLowerCase() === spec.title.toLowerCase() &&
        i.weekOf === spec.weekOf
    );
    if (clash) {
      throw new Error(
        `Pre-check failed: new L2 '${spec.title}' (weekOf=${spec.weekOf}) already exists for Dave (id=${clash.id}). Abort.`
      );
    }
  }

  // Sanity: fuzzy-match the parent name to confirm the helper will resolve it cleanly in creates.
  const fuzzyParent = await findProjectByFuzzyName(DAVE_ID, PARENT_NAME);
  if (!fuzzyParent || fuzzyParent.id !== parent.id) {
    throw new Error(
      `Pre-check failed: fuzzy-match for '${PARENT_NAME}' resolved to ${fuzzyParent?.id ?? "(nothing)"}, expected ${parent.id}. Abort.`
    );
  }

  ctx.log(
    `Pre-checks passed. dave=${dave.id}, parent=${parent.id} '${parent.name}', deleteParent=${deleteParent.id} '${deleteParent.name}', orphanItem=${orphanItem.id}.`
  );

  return { dave, parent, deleteParent, orphanItem };
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
    client: r.dave,
    parentL1: r.parent,
    deleteTargetL1: r.deleteParent,
    orphanItem: r.orphanItem,
    newWeekItemsPlanned: CREATE_WEEK_ITEM_SPECS,
  };

  const suffix = ctx.dryRun ? "-dryrun" : "";
  const outPath = resolvePath(
    process.cwd(),
    `docs/tmp/dave-asprey-part2-pre-apply-snapshot${suffix}.json`
  );
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2), "utf8");
  ctx.log(`Wrote pre-apply snapshot → ${outPath}`);
}

// ── Helpers ──────────────────────────────────────────────

async function applyCreateWeekItem(
  ctx: MigrationContext,
  spec: CreateWeekItemSpec
): Promise<void> {
  ctx.log(
    `Create week item: "${spec.title}" (${spec.date} ${spec.dayOfWeek}, weekOf=${spec.weekOf}, ${spec.category}${spec.status ? `/${spec.status}` : ""}, owner=${spec.owner}, resources=${spec.resources ?? "null"}) → project "${PARENT_NAME}"`
  );
  if (ctx.dryRun) return;
  const result = await createWeekItem({
    clientSlug: DAVE_SLUG,
    projectName: PARENT_NAME,
    date: spec.date,
    weekOf: spec.weekOf,
    dayOfWeek: spec.dayOfWeek,
    title: spec.title,
    category: spec.category,
    status: spec.status,
    owner: spec.owner,
    resources: spec.resources,
    notes: spec.notes,
    updatedBy: UPDATED_BY,
  });
  if (!result.ok) {
    throw new Error(`Create '${spec.title}' failed: ${result.error}`);
  }
}

// ── Verification ─────────────────────────────────────────

async function verify(
  ctx: MigrationContext,
  r: ResolvedState
): Promise<void> {
  ctx.log("--- Verification ---");

  // 1. Orphan week item is gone.
  const orphanRows = await ctx.db
    .select({ id: weekItems.id })
    .from(weekItems)
    .where(eq(weekItems.id, r.orphanItem.id));
  if (orphanRows.length !== 0) {
    throw new Error(
      `VERIFICATION FAILED: orphan week item ${r.orphanItem.id} ('${ORPHAN_ITEM_TITLE}') still exists.`
    );
  }
  ctx.log(`Orphan week item confirmed gone.`);

  // 2. Delete-target L1 is gone.
  const deleteRows = await ctx.db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, r.deleteParent.id));
  if (deleteRows.length !== 0) {
    throw new Error(
      `VERIFICATION FAILED: delete-target '${DELETE_PARENT_NAME}' (${r.deleteParent.id}) still exists.`
    );
  }
  ctx.log(`Delete-target L1 confirmed gone.`);

  // 3. Each of 3 new L2s exists, linked to parent, with expected fields.
  for (const spec of CREATE_WEEK_ITEM_SPECS) {
    const rows = await ctx.db
      .select()
      .from(weekItems)
      .where(
        and(
          eq(weekItems.clientId, r.dave.id),
          eq(weekItems.weekOf, spec.weekOf),
          eq(weekItems.title, spec.title)
        )
      );
    if (rows.length !== 1) {
      throw new Error(
        `VERIFICATION FAILED: new L2 '${spec.title}' (weekOf=${spec.weekOf}) resolved to ${rows.length} rows.`
      );
    }
    const item = rows[0];
    if (item.projectId !== r.parent.id) {
      throw new Error(
        `VERIFICATION FAILED: new L2 '${spec.title}' projectId is ${item.projectId ?? "null"}, expected ${r.parent.id}.`
      );
    }
    if (item.date !== spec.date) {
      throw new Error(
        `VERIFICATION FAILED: new L2 '${spec.title}' date is "${item.date}", expected "${spec.date}".`
      );
    }
    if (item.dayOfWeek !== spec.dayOfWeek) {
      throw new Error(
        `VERIFICATION FAILED: new L2 '${spec.title}' dayOfWeek is "${item.dayOfWeek}", expected "${spec.dayOfWeek}".`
      );
    }
    if (item.category !== spec.category) {
      throw new Error(
        `VERIFICATION FAILED: new L2 '${spec.title}' category is "${item.category}", expected "${spec.category}".`
      );
    }
    if ((spec.status ?? null) !== item.status) {
      throw new Error(
        `VERIFICATION FAILED: new L2 '${spec.title}' status is ${item.status === null ? "null" : `"${item.status}"`}, expected ${spec.status === undefined ? "null" : `"${spec.status}"`}.`
      );
    }
    if (item.owner !== spec.owner) {
      throw new Error(
        `VERIFICATION FAILED: new L2 '${spec.title}' owner is "${item.owner}", expected "${spec.owner}".`
      );
    }
    if ((spec.resources ?? null) !== item.resources) {
      throw new Error(
        `VERIFICATION FAILED: new L2 '${spec.title}' resources is ${item.resources === null ? "null" : `"${item.resources}"`}, expected ${spec.resources === undefined ? "null" : `"${spec.resources}"`}.`
      );
    }
  }
  ctx.log(`All 3 new L2s verified.`);

  // 4. Strict orphan invariant: 0 non-completed orphans for Dave.
  const strictOrphans = await ctx.db
    .select({ id: weekItems.id, title: weekItems.title, status: weekItems.status })
    .from(weekItems)
    .where(
      and(
        eq(weekItems.clientId, r.dave.id),
        isNull(weekItems.projectId),
        ne(weekItems.status, "completed")
      )
    );
  if (strictOrphans.length !== 0) {
    throw new Error(
      `VERIFICATION FAILED: expected 0 non-completed orphans for Dave, got ${strictOrphans.length}: ${strictOrphans
        .map((o) => `${o.id.slice(0, 8)} (${o.title}, status=${o.status})`)
        .join("; ")}.`
    );
  }
  ctx.log(`Strict orphan invariant verified (0 non-completed orphans).`);

  // 5. Total Dave project count: 2 − 1 = 1.
  const allProjects = await ctx.db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.clientId, r.dave.id));
  if (allProjects.length !== 1) {
    throw new Error(
      `VERIFICATION FAILED: expected 1 Dave project, got ${allProjects.length}: ${allProjects
        .map((p) => p.id.slice(0, 8))
        .join(", ")}.`
    );
  }
  ctx.log(`Total Dave projects: 1 (expected 1).`);

  // 6. Total Dave week items: 1 preflight orphan deleted + 3 new = 3.
  const allItems = await ctx.db
    .select({ id: weekItems.id })
    .from(weekItems)
    .where(eq(weekItems.clientId, r.dave.id));
  if (allItems.length !== 3) {
    throw new Error(
      `VERIFICATION FAILED: expected 3 Dave week items (orphan deleted + 3 new), got ${allItems.length}.`
    );
  }
  ctx.log(`Total Dave week items: ${allItems.length} (expected 3).`);

  ctx.log("Verification passed.");
}
