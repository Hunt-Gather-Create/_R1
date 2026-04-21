/**
 * Migration: Dave Asprey Client Cleanup — 2026-04-21
 *
 * Small retainer wind-down cleanup (7th client cleanup in the arc).
 *
 * Shape: hybrid — rename + field updates on an existing L1, relink an orphan
 * week item to that renamed L1, delete a now-redundant L1, then create 2 new
 * L2 week items under the renamed parent.
 *
 * Ops (pinned order):
 *   Op 1 — Rename + field-update L1 `Social Content — Wind Down`
 *          → `Social Retainer — Wind Down` (owner/resources/target/notes)
 *   Op 2 — Link the orphan week item `Disconnect Google Sheet from Dave ManyChat`
 *          (2026-04-29, projectId currently NULL) to the renamed L1 via
 *          `linkWeekItemToProject` (NEVER updateWeekItemField for projectId)
 *   Op 3 — Delete the now-redundant L1 `Disconnect Google Sheet from ManyChat`
 *          (0 children after Op 2 — nothing to cascade)
 *   Op 4 — Create new L2 `Daily Social Posts + ManyChat — Retainer (through 4/30)`
 *          under the renamed L1 (2026-04-20, category=delivery, in-progress)
 *   Op 5 — Rename + resources update on the existing Disconnect L2
 *          → `Disconnect Google Sheet from ManyChat`, resources=`PM: Jason`
 *   Op 6 — Create new L2 `Retainer Close — Final Post` under the renamed L1
 *          (2026-04-30, category=deadline, status null)
 *
 * Pre-state snapshot (captured 2026-04-21 from prod):
 *   Dave Asprey client id: 7d22f3b6e72640499e78dbfd1
 *   L1 `Social Content — Wind Down`: 00a4e855
 *   L1 `Disconnect Google Sheet from ManyChat`: 18aee5e0 (0 children — preflight)
 *   Week item `Disconnect Google Sheet from Dave ManyChat`: 894713a7
 *     → projectId=NULL (orphan, not linked to 18aee5e0 despite name alignment)
 *
 * Because Op 3 deletes a project with zero children, `deleteProject` does a
 * straight delete (no cascade). Op 2 links the orphan BEFORE Op 3 runs —
 * necessary only because the rename in Op 1 unlocks a valid fuzzy-match target
 * for the link.
 */
import { writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { and, eq, isNull, like, ne } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { clients, projects, weekItems } from "@/lib/db/runway-schema";
import {
  createWeekItem,
  deleteProject,
  findProjectByFuzzyName,
  getBatchId,
  linkWeekItemToProject,
  updateProjectField,
  updateWeekItemField,
} from "@/lib/runway/operations";

// ── Constants ────────────────────────────────────────────

const DAVE_SLUG = "dave-asprey";
const DAVE_ID = "7d22f3b6e72640499e78dbfd1";
const UPDATED_BY = "TP";

// L1 being renamed + updated
const OLD_PARENT_NAME = "Social Content — Wind Down";
const NEW_PARENT_NAME = "Social Retainer — Wind Down";
const PARENT_PREFIX = "00a4e855";

const PARENT_FIELD_UPDATES = {
  owner: "Allison",
  resources: "AM: Allison, CM: Sami, PM: Jason",
  target: "Retainer ends 4/30",
  notes:
    "Daily social posts + ManyChat automations through 4/30. Account closes EOM April. Sami executing day-to-day under Allison. Jason handling Google Sheet/ManyChat disconnect as part of cutoff.",
};

// L1 being deleted (after its orphan is relinked to the renamed parent in Op 2)
const DELETE_PARENT_NAME = "Disconnect Google Sheet from ManyChat";
const DELETE_PARENT_PREFIX = "18aee5e0";

// The existing week item to relink + rename (currently an orphan)
const DISCONNECT_ITEM_PREFIX = "894713a7";
const DISCONNECT_ITEM_CURRENT_TITLE = "Disconnect Google Sheet from Dave ManyChat";
const DISCONNECT_ITEM_CURRENT_WEEKOF = "2026-04-27";
const DISCONNECT_ITEM_CURRENT_DATE = "2026-04-29";

// New title for the Disconnect L2 (drop "Dave" — account field carries client name)
const DISCONNECT_ITEM_NEW_TITLE = "Disconnect Google Sheet from ManyChat";
const DISCONNECT_ITEM_NEW_RESOURCES = "PM: Jason";

// ── New L2 week items (2 creates) ────────────────────────

type CreateWeekItemSpec = {
  readonly title: string;
  readonly date: string;
  readonly dayOfWeek: string;
  readonly weekOf: string;
  readonly category: string;
  readonly status?: string;
  readonly owner: string;
  readonly resources?: string;
  readonly notes: string;
};

const CREATE_WEEK_ITEM_SPECS: readonly CreateWeekItemSpec[] = [
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
  "Dave Asprey cleanup 2026-04-21: rename 'Social Content → Social Retainer — Wind Down' + field updates, relink orphan Disconnect week item, delete redundant Disconnect L1, rename/update Disconnect L2, create 2 new retainer L2s (Daily Posts + Retainer Close).";

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("=== Dave Asprey Cleanup 2026-04-21 ===");

  // Step 1 — Pre-checks
  const resolved = await preChecks(ctx);

  // Step 2 — Pre-write snapshot
  await writeSnapshot(ctx, resolved);

  if (ctx.dryRun) {
    ctx.log("Dry-run: no writes will be performed. Operation plan follows.");
  }

  // ── Op 1 — Rename + field-update L1 `Social Content — Wind Down` ──
  ctx.log("--- Op 1: rename + update L1 'Social Content — Wind Down' ---");
  const parent = resolved.parent;
  const f = PARENT_FIELD_UPDATES;

  // Write-only-if-different
  if (f.owner !== parent.owner) {
    await writeProjectField(ctx, parent.name, "owner", f.owner);
  } else {
    ctx.log(`Project ${PARENT_PREFIX}: owner already "${f.owner}", skipping`);
  }
  if (f.resources !== parent.resources) {
    await writeProjectField(ctx, parent.name, "resources", f.resources);
  } else {
    ctx.log(`Project ${PARENT_PREFIX}: resources already "${f.resources}", skipping`);
  }
  if (f.target !== parent.target) {
    await writeProjectField(ctx, parent.name, "target", f.target);
  } else {
    ctx.log(`Project ${PARENT_PREFIX}: target already "${f.target}", skipping`);
  }
  if (f.notes !== parent.notes) {
    await writeProjectField(ctx, parent.name, "notes", f.notes);
  } else {
    ctx.log(`Project ${PARENT_PREFIX}: notes already match, skipping`);
  }
  // Rename last — fuzzy-lookup key is name
  if (NEW_PARENT_NAME !== parent.name) {
    await writeProjectField(ctx, parent.name, "name", NEW_PARENT_NAME);
  } else {
    ctx.log(`Project ${PARENT_PREFIX}: name already "${NEW_PARENT_NAME}", skipping`);
  }

  // Sanity check: renamed parent resolves via fuzzy match to the same ID
  if (!ctx.dryRun) {
    const resolvedParent = await findProjectByFuzzyName(DAVE_ID, NEW_PARENT_NAME);
    if (!resolvedParent || resolvedParent.id !== parent.id) {
      throw new Error(
        `Post-Op-1 sanity check: renamed parent '${NEW_PARENT_NAME}' resolved to ${resolvedParent?.id ?? "(nothing)"}; expected ${parent.id}.`
      );
    }
  }

  // ── Op 2 — Link the orphan Disconnect week item to renamed parent ──
  ctx.log(
    `--- Op 2: link week item ${DISCONNECT_ITEM_PREFIX} → renamed parent '${NEW_PARENT_NAME}' (${parent.id}) ---`
  );
  const disconnectItem = resolved.disconnectItem;
  ctx.log(
    `Link week item ${DISCONNECT_ITEM_PREFIX} (current projectId=${disconnectItem.projectId ?? "null"}) → ${parent.id}`
  );
  if (!ctx.dryRun) {
    const result = await linkWeekItemToProject({
      weekItemId: disconnectItem.id,
      projectId: parent.id,
      updatedBy: UPDATED_BY,
    });
    if (!result.ok) {
      throw new Error(`Link ${DISCONNECT_ITEM_PREFIX} failed: ${result.error}`);
    }
  }

  // ── Op 3 — Delete redundant L1 `Disconnect Google Sheet from ManyChat` ──
  ctx.log(
    `--- Op 3: delete redundant L1 '${DELETE_PARENT_NAME}' (prefix=${DELETE_PARENT_PREFIX}, 0 children) ---`
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

  // ── Op 4 — Create new L2 'Daily Social Posts + ManyChat — Retainer' ──
  ctx.log("--- Op 4: create L2 'Daily Social Posts + ManyChat — Retainer (through 4/30)' ---");
  await applyCreateWeekItem(ctx, CREATE_WEEK_ITEM_SPECS[0]);

  // ── Op 5 — Rename + update resources on the Disconnect L2 ──
  ctx.log("--- Op 5: rename + update Disconnect L2 (drop 'Dave', resources → 'PM: Jason') ---");
  // Use current (pre-rename) weekOf + title for lookup. weekOf unchanged.
  const currentWeekOf = disconnectItem.weekOf;
  let currentTitle = disconnectItem.title;

  if (DISCONNECT_ITEM_NEW_RESOURCES !== disconnectItem.resources) {
    await writeWeekItemField(
      ctx,
      DISCONNECT_ITEM_PREFIX,
      currentWeekOf,
      currentTitle,
      "resources",
      DISCONNECT_ITEM_NEW_RESOURCES
    );
  } else {
    ctx.log(
      `Week item ${DISCONNECT_ITEM_PREFIX}: resources already "${DISCONNECT_ITEM_NEW_RESOURCES}", skipping`
    );
  }
  if (DISCONNECT_ITEM_NEW_TITLE !== currentTitle) {
    await writeWeekItemField(
      ctx,
      DISCONNECT_ITEM_PREFIX,
      currentWeekOf,
      currentTitle,
      "title",
      DISCONNECT_ITEM_NEW_TITLE
    );
    currentTitle = DISCONNECT_ITEM_NEW_TITLE;
  } else {
    ctx.log(
      `Week item ${DISCONNECT_ITEM_PREFIX}: title already "${DISCONNECT_ITEM_NEW_TITLE}", skipping`
    );
  }

  // ── Op 6 — Create new L2 'Retainer Close — Final Post' ──
  ctx.log("--- Op 6: create L2 'Retainer Close — Final Post' ---");
  await applyCreateWeekItem(ctx, CREATE_WEEK_ITEM_SPECS[1]);

  // ── Verification ──
  if (!ctx.dryRun) {
    await verify(ctx, resolved);
  }

  ctx.log("=== Dave Asprey Cleanup complete ===");
}

// ── Pre-checks ───────────────────────────────────────────

interface ResolvedState {
  readonly dave: typeof clients.$inferSelect;
  readonly parent: typeof projects.$inferSelect;
  readonly deleteParent: typeof projects.$inferSelect;
  readonly disconnectItem: typeof weekItems.$inferSelect;
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

  // Assert new parent name doesn't already exist for Dave (case-insensitive).
  // This catches the case where a prior migration attempt partially succeeded.
  const allDaveProjects = await ctx.db
    .select()
    .from(projects)
    .where(eq(projects.clientId, dave.id));
  const clashWithNewName = allDaveProjects.find(
    (p) =>
      p.name.trim().toLowerCase() === NEW_PARENT_NAME.toLowerCase() &&
      !p.id.startsWith(PARENT_PREFIX)
  );
  if (clashWithNewName) {
    throw new Error(
      `Pre-check failed: a '${NEW_PARENT_NAME}' project already exists for Dave on a different row (id=${clashWithNewName.id}). Abort.`
    );
  }

  // Resolve parent L1 (to be renamed)
  const parentMatches = await ctx.db
    .select()
    .from(projects)
    .where(and(eq(projects.clientId, dave.id), like(projects.id, `${PARENT_PREFIX}%`)));
  if (parentMatches.length !== 1) {
    throw new Error(
      `Pre-check failed: parent prefix '${PARENT_PREFIX}' resolved to ${parentMatches.length} rows (expected 1).`
    );
  }
  const parent = parentMatches[0];
  if (parent.name !== OLD_PARENT_NAME) {
    throw new Error(
      `Pre-check failed: parent ${PARENT_PREFIX} name is "${parent.name}", expected "${OLD_PARENT_NAME}". Preflight drift — abort.`
    );
  }

  // Resolve delete-target L1
  const deleteMatches = await ctx.db
    .select()
    .from(projects)
    .where(and(eq(projects.clientId, dave.id), like(projects.id, `${DELETE_PARENT_PREFIX}%`)));
  if (deleteMatches.length !== 1) {
    throw new Error(
      `Pre-check failed: delete-target prefix '${DELETE_PARENT_PREFIX}' resolved to ${deleteMatches.length} rows (expected 1).`
    );
  }
  const deleteParent = deleteMatches[0];
  if (deleteParent.name !== DELETE_PARENT_NAME) {
    throw new Error(
      `Pre-check failed: delete-target ${DELETE_PARENT_PREFIX} name is "${deleteParent.name}", expected "${DELETE_PARENT_NAME}". Abort.`
    );
  }

  // Assert 0 children for delete-target (after Op 2 links the orphan to parent,
  // deleteParent is guaranteed to have 0 children; current pre-state is also 0).
  const deleteChildren = await ctx.db
    .select({ id: weekItems.id })
    .from(weekItems)
    .where(eq(weekItems.projectId, deleteParent.id));
  if (deleteChildren.length !== 0) {
    throw new Error(
      `Pre-check failed: delete-target '${DELETE_PARENT_NAME}' has ${deleteChildren.length} linked child(ren), expected 0. Abort.`
    );
  }

  // Resolve the orphan week item
  const itemMatches = await ctx.db
    .select()
    .from(weekItems)
    .where(and(eq(weekItems.clientId, dave.id), like(weekItems.id, `${DISCONNECT_ITEM_PREFIX}%`)));
  if (itemMatches.length !== 1) {
    throw new Error(
      `Pre-check failed: disconnect item prefix '${DISCONNECT_ITEM_PREFIX}' resolved to ${itemMatches.length} rows (expected 1).`
    );
  }
  const disconnectItem = itemMatches[0];
  if (disconnectItem.title !== DISCONNECT_ITEM_CURRENT_TITLE) {
    throw new Error(
      `Pre-check failed: disconnect item title is "${disconnectItem.title}", expected "${DISCONNECT_ITEM_CURRENT_TITLE}". Abort.`
    );
  }
  if (disconnectItem.weekOf !== DISCONNECT_ITEM_CURRENT_WEEKOF) {
    throw new Error(
      `Pre-check failed: disconnect item weekOf is "${disconnectItem.weekOf}", expected "${DISCONNECT_ITEM_CURRENT_WEEKOF}". Abort.`
    );
  }
  if (disconnectItem.date !== DISCONNECT_ITEM_CURRENT_DATE) {
    throw new Error(
      `Pre-check failed: disconnect item date is "${disconnectItem.date}", expected "${DISCONNECT_ITEM_CURRENT_DATE}". Abort.`
    );
  }
  // Note: projectId may be null (orphan) OR point at deleteParent — both are
  // acceptable pre-states. Op 2 sets projectId → parent.id either way.
  // Log the current state for transparency.
  ctx.log(
    `  pre-check: disconnect item ${DISCONNECT_ITEM_PREFIX} current projectId=${disconnectItem.projectId ?? "null"} (will be set to ${parent.id} in Op 2)`
  );

  // Assert the 2 new L2 titles don't already exist for Dave (case-insensitive)
  // at their target dates — protects against partial re-run.
  const allDaveItems = await ctx.db
    .select()
    .from(weekItems)
    .where(eq(weekItems.clientId, dave.id));
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

  ctx.log(
    `Pre-checks passed. dave=${dave.id}, parent=${parent.id}, deleteParent=${deleteParent.id}, disconnectItem=${disconnectItem.id}.`
  );

  return { dave, parent, deleteParent, disconnectItem };
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
    parentL1Before: r.parent,
    deleteTargetL1Before: r.deleteParent,
    disconnectItemBefore: r.disconnectItem,
    parentRenamePlan: {
      fromName: OLD_PARENT_NAME,
      toName: NEW_PARENT_NAME,
      fields: PARENT_FIELD_UPDATES,
    },
    relinkPlan: {
      weekItemId: r.disconnectItem.id,
      fromProjectId: r.disconnectItem.projectId,
      toProjectId: r.parent.id,
      itemRename: {
        fromTitle: DISCONNECT_ITEM_CURRENT_TITLE,
        toTitle: DISCONNECT_ITEM_NEW_TITLE,
        newResources: DISCONNECT_ITEM_NEW_RESOURCES,
      },
    },
    deletePlan: {
      name: DELETE_PARENT_NAME,
      id: r.deleteParent.id,
    },
    newWeekItemsPlanned: CREATE_WEEK_ITEM_SPECS,
  };

  const suffix = ctx.dryRun ? "-dryrun" : "";
  const outPath = resolvePath(
    process.cwd(),
    `docs/tmp/dave-asprey-pre-apply-snapshot${suffix}.json`
  );
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2), "utf8");
  ctx.log(`Wrote pre-apply snapshot → ${outPath}`);
}

// ── Helpers ──────────────────────────────────────────────

async function writeProjectField(
  ctx: MigrationContext,
  projectName: string,
  field: string,
  newValue: string
): Promise<void> {
  ctx.log(`Project '${projectName}' ${field} → "${newValue}"`);
  if (ctx.dryRun) return;
  const result = await updateProjectField({
    clientSlug: DAVE_SLUG,
    projectName,
    field,
    newValue,
    updatedBy: UPDATED_BY,
  });
  if (!result.ok) {
    throw new Error(`Update '${projectName}'.${field} failed: ${result.error}`);
  }
}

async function writeWeekItemField(
  ctx: MigrationContext,
  prefix: string,
  weekOf: string,
  title: string,
  field: string,
  newValue: string
): Promise<void> {
  ctx.log(`Week item ${prefix} (weekOf=${weekOf}, title="${title}") ${field} → "${newValue}"`);
  if (ctx.dryRun) return;
  const result = await updateWeekItemField({
    weekOf,
    weekItemTitle: title,
    field,
    newValue,
    updatedBy: UPDATED_BY,
  });
  if (!result.ok) {
    throw new Error(`Update ${prefix}.${field} failed: ${result.error}`);
  }
}

async function applyCreateWeekItem(
  ctx: MigrationContext,
  spec: CreateWeekItemSpec
): Promise<void> {
  ctx.log(
    `Create week item: "${spec.title}" (${spec.date} ${spec.dayOfWeek}, ${spec.category}${spec.status ? `/${spec.status}` : ""}, owner=${spec.owner}, resources=${spec.resources ?? "null"}) → project "${NEW_PARENT_NAME}"`
  );
  if (ctx.dryRun) return;
  const result = await createWeekItem({
    clientSlug: DAVE_SLUG,
    projectName: NEW_PARENT_NAME,
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

  // 1. Renamed parent L1 exists with expected fields
  const parentRows = await ctx.db
    .select()
    .from(projects)
    .where(eq(projects.id, r.parent.id));
  const newParent = parentRows[0];
  if (!newParent) {
    throw new Error(`VERIFICATION FAILED: renamed parent ${r.parent.id} not found.`);
  }
  if (newParent.name !== NEW_PARENT_NAME) {
    throw new Error(
      `VERIFICATION FAILED: parent name is "${newParent.name}", expected "${NEW_PARENT_NAME}".`
    );
  }
  if (newParent.owner !== PARENT_FIELD_UPDATES.owner) {
    throw new Error(
      `VERIFICATION FAILED: parent owner is "${newParent.owner}", expected "${PARENT_FIELD_UPDATES.owner}".`
    );
  }
  if (newParent.resources !== PARENT_FIELD_UPDATES.resources) {
    throw new Error(
      `VERIFICATION FAILED: parent resources is "${newParent.resources}", expected "${PARENT_FIELD_UPDATES.resources}".`
    );
  }
  if (newParent.target !== PARENT_FIELD_UPDATES.target) {
    throw new Error(
      `VERIFICATION FAILED: parent target is "${newParent.target}", expected "${PARENT_FIELD_UPDATES.target}".`
    );
  }
  if (newParent.notes !== PARENT_FIELD_UPDATES.notes) {
    throw new Error(
      `VERIFICATION FAILED: parent notes mismatch.`
    );
  }
  ctx.log(`Renamed parent L1 verified.`);

  // 2. Delete-target L1 is gone
  const deleteRows = await ctx.db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.clientId, r.dave.id), like(projects.id, `${DELETE_PARENT_PREFIX}%`)));
  if (deleteRows.length !== 0) {
    throw new Error(
      `VERIFICATION FAILED: delete-target '${DELETE_PARENT_NAME}' (${DELETE_PARENT_PREFIX}) still exists.`
    );
  }
  ctx.log(`Delete-target L1 confirmed gone.`);

  // 3. Disconnect L2 is now linked to renamed parent, with new title + resources
  const disconnectRows = await ctx.db
    .select()
    .from(weekItems)
    .where(eq(weekItems.id, r.disconnectItem.id));
  const disconnect = disconnectRows[0];
  if (!disconnect) {
    throw new Error(`VERIFICATION FAILED: disconnect L2 ${r.disconnectItem.id} not found.`);
  }
  if (disconnect.projectId !== r.parent.id) {
    throw new Error(
      `VERIFICATION FAILED: disconnect L2 projectId is ${disconnect.projectId ?? "null"}, expected ${r.parent.id}.`
    );
  }
  if (disconnect.title !== DISCONNECT_ITEM_NEW_TITLE) {
    throw new Error(
      `VERIFICATION FAILED: disconnect L2 title is "${disconnect.title}", expected "${DISCONNECT_ITEM_NEW_TITLE}".`
    );
  }
  if (disconnect.resources !== DISCONNECT_ITEM_NEW_RESOURCES) {
    throw new Error(
      `VERIFICATION FAILED: disconnect L2 resources is "${disconnect.resources}", expected "${DISCONNECT_ITEM_NEW_RESOURCES}".`
    );
  }
  // date, category, owner unchanged
  if (disconnect.date !== DISCONNECT_ITEM_CURRENT_DATE) {
    throw new Error(
      `VERIFICATION FAILED: disconnect L2 date drifted to "${disconnect.date}", expected "${DISCONNECT_ITEM_CURRENT_DATE}".`
    );
  }
  if (disconnect.category !== "deadline") {
    throw new Error(
      `VERIFICATION FAILED: disconnect L2 category is "${disconnect.category}", expected "deadline".`
    );
  }
  if (disconnect.owner !== "Jason") {
    throw new Error(
      `VERIFICATION FAILED: disconnect L2 owner is "${disconnect.owner}", expected "Jason".`
    );
  }
  ctx.log(`Disconnect L2 verified.`);

  // 4. Both new L2s exist, linked to renamed parent, with expected fields
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
  ctx.log(`Both new L2s verified.`);

  // 5. Strict orphan invariant for Dave Asprey: 0 non-completed orphans
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

  // 6. Total Dave project count: 2 − 1 = 1
  const allProjects = await ctx.db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.clientId, r.dave.id));
  if (allProjects.length !== 1) {
    throw new Error(
      `VERIFICATION FAILED: expected 1 Dave project, got ${allProjects.length}.`
    );
  }
  ctx.log(`Total Dave projects: 1 (expected 1).`);

  // 7. Total Dave week items: 1 pre-existing + 2 new = 3
  const allItems = await ctx.db
    .select({ id: weekItems.id })
    .from(weekItems)
    .where(eq(weekItems.clientId, r.dave.id));
  if (allItems.length !== 3) {
    throw new Error(
      `VERIFICATION FAILED: expected 3 Dave week items (1 existing + 2 new), got ${allItems.length}.`
    );
  }
  ctx.log(`Total Dave week items: ${allItems.length} (expected 3).`);

  ctx.log("Verification passed.");
}
