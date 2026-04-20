/**
 * Migration: Bonterra Data Cleanup — 2026-04-19
 *
 * Collapses 3 Impact Report phase-projects (Design, Dev, Publish) into a
 * single Level 1 `Impact Report` parent, links 4 orphan week items + 2 new
 * items to it, and updates the Bonterra client team field.
 *
 * Operation order (pinned):
 *   pre-checks → pre-write JSON snapshot → delete 3 phase-projects →
 *   create parent → update 4 existing week items → link 4 items to parent →
 *   create 2 new week items → update Bonterra client team → verify.
 *
 * Pre-checks abort loudly if expected pre-state is missing; no partial-apply
 * recovery path.
 */
import { writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { and, eq, inArray, isNull, like } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { clients, projects, weekItems } from "@/lib/db/runway-schema";
import {
  addProject,
  createWeekItem,
  deleteProject,
  findProjectByFuzzyName,
  generateIdempotencyKey,
  getBatchId,
  insertAuditRecord,
  linkWeekItemToProject,
  updateClientField,
  updateWeekItemField,
} from "@/lib/runway/operations";

// ── Constants ────────────────────────────────────────────

const BONTERRA_SLUG = "bonterra";
const PARENT_PROJECT_NAME = "Impact Report";
const UPDATED_BY = "migration";

const PHASE_PROJECT_PREFIXES = [
  { prefix: "e6289aba", name: "Impact Report — Design" },
  { prefix: "61015292", name: "Impact Report — Dev" },
  { prefix: "3aba1449", name: "Impact Report — Publish" },
] as const;

type ExistingItemPlan = {
  prefix: string;
  expectedCurrentTitle: string;
  expectedWeekOf: string;
  fields: {
    status?: string | null; // null means "ensure null" (skip or raw UPDATE)
    date?: string;
    dayOfWeek?: string;
    weekOf?: string;
    resources?: string;
    category?: string;
    title: string; // always written last
  };
};

const EXISTING_ITEM_PLANS: ExistingItemPlan[] = [
  {
    prefix: "73bf95c4",
    expectedCurrentTitle: "Bonterra — Paige presenting designs",
    expectedWeekOf: "2026-04-06",
    fields: {
      status: "completed",
      resources: "CD: Lane",
      title: "Impact Report — Design Presentation",
    },
  },
  {
    prefix: "c524b951",
    expectedCurrentTitle: "Bonterra approval needed",
    expectedWeekOf: "2026-04-06",
    fields: {
      status: "completed",
      resources: "CD: Lane",
      title: "Impact Report — Design Approval",
    },
  },
  {
    prefix: "0dc160b4",
    expectedCurrentTitle: "Bonterra Impact Report — code handoff",
    expectedWeekOf: "2026-04-20",
    fields: {
      date: "2026-04-28",
      dayOfWeek: "tuesday",
      weekOf: "2026-04-27",
      resources: "Dev: Leslie",
      status: null,
      title: "Impact Report — Dev Handoff",
    },
  },
  {
    prefix: "ffe37e79",
    expectedCurrentTitle: "Bonterra Impact Report — Go Live",
    expectedWeekOf: "2026-05-11",
    fields: {
      category: "launch",
      resources: "Bonterra",
      status: null,
      title: "Impact Report — Go Live",
    },
  },
];

const BONTERRA_TEAM_NEW = "AM: Jill, CD: Lane, Dev: Leslie";

// ── Exports ──────────────────────────────────────────────

export const description =
  "Bonterra cleanup 2026-04-19: collapse Impact Report phase-projects into one parent; link 6 week items; update client team.";

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("=== Bonterra Cleanup 2026-04-19 ===");

  // Step 1 — Pre-checks + resolve IDs
  const resolved = await preChecks(ctx);

  // Step 2 — Pre-write snapshot
  await writeSnapshot(ctx, resolved);

  if (ctx.dryRun) {
    ctx.log("Dry-run: no writes will be performed. Operation plan follows.");
  }

  // Step 3 — Delete 3 phase-projects (they are leaf projects per pre-checks)
  for (const { name } of PHASE_PROJECT_PREFIXES) {
    ctx.log(`Delete project: Bonterra / ${name}`);
    if (!ctx.dryRun) {
      const result = await deleteProject({
        clientSlug: BONTERRA_SLUG,
        projectName: name,
        updatedBy: UPDATED_BY,
      });
      if (!result.ok) throw new Error(`Delete ${name} failed: ${result.error}`);
    }
  }

  // Step 4 — Create parent project
  ctx.log(`Create project: Bonterra / ${PARENT_PROJECT_NAME} (owner=Jill, dueDate=null)`);
  let newParentId: string | null = null;
  if (!ctx.dryRun) {
    const result = await addProject({
      clientSlug: BONTERRA_SLUG,
      name: PARENT_PROJECT_NAME,
      owner: "Jill",
      updatedBy: UPDATED_BY,
    });
    if (!result.ok) throw new Error(`Create parent failed: ${result.error}`);

    // Capture the new project's ID by re-querying (addProject doesn't return it)
    const parent = await findProjectByFuzzyName(resolved.bonterra.id, PARENT_PROJECT_NAME);
    if (!parent) throw new Error("New parent project not found after create.");
    newParentId = parent.id;
    ctx.log(`  → new parent id: ${newParentId}`);
  }

  // Step 5 — Update 4 existing week items
  for (const plan of EXISTING_ITEM_PLANS) {
    const row = resolved.itemsByPrefix.get(plan.prefix);
    if (!row) throw new Error(`Missing resolved row for ${plan.prefix}`);
    await applyItemFieldUpdates(ctx, plan, row);
  }

  // Step 6 — Link 4 items to new parent
  for (const plan of EXISTING_ITEM_PLANS) {
    const row = resolved.itemsByPrefix.get(plan.prefix);
    if (!row) throw new Error(`Missing resolved row for ${plan.prefix}`);
    ctx.log(`Link week item ${plan.prefix} to parent project`);
    if (!ctx.dryRun) {
      if (!newParentId) throw new Error("newParentId not set");
      const result = await linkWeekItemToProject({
        weekItemId: row.id,
        projectId: newParentId,
        updatedBy: UPDATED_BY,
      });
      if (!result.ok) throw new Error(`Link ${plan.prefix} failed: ${result.error}`);
    }
  }

  // Step 7 — Create 2 new week items
  ctx.log("Create week item: Impact Report — Dev K/O (2026-04-15)");
  if (!ctx.dryRun) {
    const result = await createWeekItem({
      clientSlug: BONTERRA_SLUG,
      projectName: PARENT_PROJECT_NAME,
      date: "2026-04-15",
      weekOf: "2026-04-13",
      dayOfWeek: "wednesday",
      title: "Impact Report — Dev K/O",
      category: "kickoff",
      status: "in-progress",
      owner: "Jill",
      resources: "Dev: Leslie",
      notes: "Build HTML/CSS/JS against final approved design",
      updatedBy: UPDATED_BY,
    });
    if (!result.ok) throw new Error(`Create Dev K/O failed: ${result.error}`);
  }

  ctx.log("Create week item: Impact Report — Internal Review (2026-04-23)");
  if (!ctx.dryRun) {
    const result = await createWeekItem({
      clientSlug: BONTERRA_SLUG,
      projectName: PARENT_PROJECT_NAME,
      date: "2026-04-23",
      weekOf: "2026-04-20",
      dayOfWeek: "thursday",
      title: "Impact Report — Internal Review",
      category: "review",
      owner: "Jill",
      resources: "Dev: Leslie",
      notes: "Walk team through Dev build; flag issues to fix before 4/28 handoff",
      updatedBy: UPDATED_BY,
    });
    if (!result.ok) throw new Error(`Create Internal Review failed: ${result.error}`);
  }

  // Step 8 — Update Bonterra client team
  ctx.log(`Update client: Bonterra team → "${BONTERRA_TEAM_NEW}"`);
  if (!ctx.dryRun) {
    const result = await updateClientField({
      clientSlug: BONTERRA_SLUG,
      field: "team",
      newValue: BONTERRA_TEAM_NEW,
      updatedBy: UPDATED_BY,
    });
    if (!result.ok) throw new Error(`Update client team failed: ${result.error}`);
  }

  // Step 9 — Verification
  if (!ctx.dryRun) {
    await verify(ctx, resolved.bonterra.id, newParentId!);
  }

  ctx.log("=== Bonterra Cleanup complete ===");
}

// ── Pre-checks ───────────────────────────────────────────

interface ResolvedState {
  bonterra: typeof clients.$inferSelect;
  phaseProjectIds: string[];
  itemsByPrefix: Map<string, typeof weekItems.$inferSelect>;
}

async function preChecks(ctx: MigrationContext): Promise<ResolvedState> {
  ctx.log("--- Pre-checks ---");

  // Resolve Bonterra client
  const bonterraRows = await ctx.db.select().from(clients).where(eq(clients.slug, BONTERRA_SLUG));
  const bonterra = bonterraRows[0];
  if (!bonterra) throw new Error(`Pre-check failed: client '${BONTERRA_SLUG}' not found.`);

  // Assert no Impact Report parent already exists (case-insensitive exact match)
  const existingParents = await ctx.db
    .select()
    .from(projects)
    .where(eq(projects.clientId, bonterra.id));
  const existingParent = existingParents.find(
    (p) => p.name.trim().toLowerCase() === PARENT_PROJECT_NAME.toLowerCase()
  );
  if (existingParent) {
    throw new Error(
      `Pre-check failed: an '${PARENT_PROJECT_NAME}' project already exists for Bonterra (id=${existingParent.id}). Abort.`
    );
  }

  // Resolve 3 phase-project IDs by prefix
  const phaseProjectIds: string[] = [];
  for (const { prefix, name } of PHASE_PROJECT_PREFIXES) {
    const matches = await ctx.db
      .select()
      .from(projects)
      .where(and(eq(projects.clientId, bonterra.id), like(projects.id, `${prefix}%`)));
    if (matches.length !== 1) {
      throw new Error(
        `Pre-check failed: expected exactly 1 project with id prefix '${prefix}' (${name}), got ${matches.length}.`
      );
    }
    phaseProjectIds.push(matches[0].id);
  }

  // Assert no week items point at any of the 3 phase-projects
  const linkedToPhases = await ctx.db
    .select()
    .from(weekItems)
    .where(inArray(weekItems.projectId, phaseProjectIds));
  if (linkedToPhases.length > 0) {
    throw new Error(
      `Pre-check failed: ${linkedToPhases.length} week item(s) currently point at the 3 phase-projects. Expected 0. Abort.`
    );
  }

  // Resolve 4 week-item IDs by prefix
  const itemsByPrefix = new Map<string, typeof weekItems.$inferSelect>();
  for (const plan of EXISTING_ITEM_PLANS) {
    const matches = await ctx.db
      .select()
      .from(weekItems)
      .where(like(weekItems.id, `${plan.prefix}%`));
    if (matches.length !== 1) {
      throw new Error(
        `Pre-check failed: expected exactly 1 week item with id prefix '${plan.prefix}' (${plan.expectedCurrentTitle}), got ${matches.length}.`
      );
    }
    const row = matches[0];
    if (row.projectId !== null) {
      throw new Error(
        `Pre-check failed: week item ${plan.prefix} already has projectId=${row.projectId}; expected null. Abort.`
      );
    }
    itemsByPrefix.set(plan.prefix, row);
  }

  ctx.log(
    `Pre-checks passed. Bonterra id=${bonterra.id}, 3 phases resolved, 4 week items resolved (all orphan).`
  );

  return { bonterra, phaseProjectIds, itemsByPrefix };
}

// ── Snapshot ─────────────────────────────────────────────

async function writeSnapshot(ctx: MigrationContext, r: ResolvedState): Promise<void> {
  const capturedAt = new Date().toISOString();
  const phaseProjects = await ctx.db
    .select()
    .from(projects)
    .where(inArray(projects.id, r.phaseProjectIds));

  const itemsToUpdate = Array.from(r.itemsByPrefix.values());

  const snapshot = {
    capturedAt,
    mode: ctx.dryRun ? "dry-run" : "apply",
    batchId: getBatchId(),
    client: r.bonterra,
    projectsToDelete: phaseProjects,
    weekItemsToUpdate: itemsToUpdate,
    newParentPlanned: {
      name: PARENT_PROJECT_NAME,
      owner: "Jill",
      dueDate: null,
      clientId: r.bonterra.id,
    },
  };

  const suffix = ctx.dryRun ? "-dryrun" : "";
  const outPath = resolvePath(
    process.cwd(),
    `docs/tmp/bonterra-pre-apply-snapshot${suffix}.json`
  );
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2), "utf8");
  ctx.log(`Wrote pre-apply snapshot → ${outPath}`);
}

// ── Item field updates ──────────────────────────────────

async function applyItemFieldUpdates(
  ctx: MigrationContext,
  plan: ExistingItemPlan,
  row: typeof weekItems.$inferSelect
): Promise<void> {
  // Track current weekOf + title (mutate as we write)
  let currentWeekOf = row.weekOf ?? plan.expectedWeekOf;
  let currentTitle = row.title;
  let currentStatus = row.status;

  const fields = plan.fields;

  // Handle status: null first (either skip if already null, or raw UPDATE).
  // Doing this up front keeps remaining field writes through the standard helper.
  if (fields.status === null) {
    if (currentStatus === null) {
      ctx.log(`Week item ${plan.prefix}: status already null, skipping`);
    } else {
      ctx.log(
        `Week item ${plan.prefix}: status "${currentStatus}" → null (raw UPDATE, unexpected pre-state)`
      );
      if (!ctx.dryRun) {
        await ctx.db
          .update(weekItems)
          .set({ status: null, updatedAt: new Date() })
          .where(eq(weekItems.id, row.id));

        const idemKey = generateIdempotencyKey(
          "week-field-change",
          row.id,
          "status",
          "(null)",
          UPDATED_BY
        );
        await insertAuditRecord({
          idempotencyKey: idemKey,
          clientId: row.clientId,
          updatedBy: UPDATED_BY,
          updateType: "week-field-change",
          previousValue: currentStatus,
          newValue: "(null)",
          summary: `Week item '${currentTitle}': status changed from "${currentStatus}" to null`,
          metadata: JSON.stringify({ field: "status" }),
        });
      }
      currentStatus = null;
    }
  } else if (typeof fields.status === "string") {
    await writeField(ctx, plan.prefix, currentWeekOf, currentTitle, "status", fields.status);
  }

  // Non-title, non-weekOf fields (use stable lookup).
  if (fields.date !== undefined) {
    await writeField(ctx, plan.prefix, currentWeekOf, currentTitle, "date", fields.date);
  }
  if (fields.dayOfWeek !== undefined) {
    await writeField(ctx, plan.prefix, currentWeekOf, currentTitle, "dayOfWeek", fields.dayOfWeek);
  }
  if (fields.resources !== undefined) {
    await writeField(ctx, plan.prefix, currentWeekOf, currentTitle, "resources", fields.resources);
  }
  if (fields.category !== undefined) {
    await writeField(ctx, plan.prefix, currentWeekOf, currentTitle, "category", fields.category);
  }

  // weekOf change — row's weekOf column mutates, future lookups use the new weekOf.
  if (fields.weekOf !== undefined && fields.weekOf !== currentWeekOf) {
    await writeField(ctx, plan.prefix, currentWeekOf, currentTitle, "weekOf", fields.weekOf);
    currentWeekOf = fields.weekOf;
  }

  // Title last — future lookups (there aren't any after this) would use the new title.
  if (fields.title !== currentTitle) {
    await writeField(ctx, plan.prefix, currentWeekOf, currentTitle, "title", fields.title);
    currentTitle = fields.title;
  }
}

async function writeField(
  ctx: MigrationContext,
  prefix: string,
  weekOf: string,
  title: string,
  field: string,
  newValue: string
): Promise<void> {
  ctx.log(`Week item ${prefix} (${title}) ${field} → "${newValue}"`);
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

// ── Verification ─────────────────────────────────────────

async function verify(
  ctx: MigrationContext,
  bonterraId: string,
  newParentId: string
): Promise<void> {
  ctx.log("--- Verification ---");

  const orphanRows = await ctx.db
    .select({ id: weekItems.id })
    .from(weekItems)
    .where(isNull(weekItems.projectId));
  ctx.log(`Total orphan week items: ${orphanRows.length} (expected 20)`);
  if (orphanRows.length !== 20) {
    throw new Error(`VERIFICATION FAILED: expected 20 orphan week items, got ${orphanRows.length}.`);
  }

  const bonterraItems = await ctx.db
    .select()
    .from(weekItems)
    .where(eq(weekItems.clientId, bonterraId));
  ctx.log(`Bonterra week items: ${bonterraItems.length} (expected 6)`);
  if (bonterraItems.length !== 6) {
    throw new Error(`VERIFICATION FAILED: expected 6 Bonterra week items, got ${bonterraItems.length}.`);
  }
  const wrongParent = bonterraItems.filter((w) => w.projectId !== newParentId);
  if (wrongParent.length > 0) {
    throw new Error(
      `VERIFICATION FAILED: ${wrongParent.length} Bonterra week item(s) not linked to new parent: ${wrongParent.map((w) => w.id).join(", ")}.`
    );
  }

  for (const { prefix, name } of PHASE_PROJECT_PREFIXES) {
    const rows = await ctx.db
      .select({ id: projects.id })
      .from(projects)
      .where(like(projects.id, `${prefix}%`));
    if (rows.length !== 0) {
      throw new Error(`VERIFICATION FAILED: phase-project ${name} (${prefix}) still exists.`);
    }
  }

  const parentRows = await ctx.db.select().from(projects).where(eq(projects.id, newParentId));
  const parent = parentRows[0];
  if (!parent) throw new Error("VERIFICATION FAILED: new parent project not found.");
  if (parent.name !== PARENT_PROJECT_NAME) {
    throw new Error(`VERIFICATION FAILED: parent name is "${parent.name}", expected "${PARENT_PROJECT_NAME}".`);
  }
  if (parent.owner !== "Jill") {
    throw new Error(`VERIFICATION FAILED: parent owner is "${parent.owner}", expected "Jill".`);
  }
  if (parent.dueDate !== null) {
    throw new Error(`VERIFICATION FAILED: parent dueDate is "${parent.dueDate}", expected null.`);
  }

  const bonterraRows = await ctx.db.select().from(clients).where(eq(clients.id, bonterraId));
  const bonterra = bonterraRows[0];
  if (bonterra.team !== BONTERRA_TEAM_NEW) {
    throw new Error(
      `VERIFICATION FAILED: Bonterra team is "${bonterra.team}", expected "${BONTERRA_TEAM_NEW}".`
    );
  }

  ctx.log("Verification passed.");
}
