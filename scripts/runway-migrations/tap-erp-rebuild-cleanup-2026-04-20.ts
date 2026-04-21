/**
 * Migration: TAP Data Cleanup — 2026-04-20
 *
 * Consolidates 10 TAP phase-projects (Discovery, SRD, Travel Invoice, TAP
 * Reviews, DB Design, Dev, Data Migration, Testing, Deployment, Training) into
 * a single Level 1 `TAP ERP Rebuild` parent. Rewires 2 orphan week items
 * under the new parent (marking both completed), creates 8 new phase-
 * milestone L2s, and reformats the TAP client team field to role
 * abbreviations.
 *
 * Operation order (Variant A — phase-projects exist):
 *   pre-checks → pre-write JSON snapshot → delete 10 phase-projects →
 *   create parent → update 2 orphan week items (status/resources/notes/title)
 *   → link 2 items to parent → create 8 new week items → update TAP client
 *   team → verify.
 *
 * Pre-checks abort loudly if expected pre-state is missing; no partial-apply
 * recovery path.
 */
import { writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { and, count, eq, inArray, isNull, like, ne } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { clients, projects, weekItems } from "@/lib/db/runway-schema";
import {
  addProject,
  createWeekItem,
  deleteProject,
  findProjectByFuzzyName,
  getBatchId,
  linkWeekItemToProject,
  updateClientField,
  updateWeekItemField,
} from "@/lib/runway/operations";

// ── Constants ────────────────────────────────────────────

const TAP_SLUG = "tap";
const TAP_CLIENT_ID = "79eb5f61e1f248a2a990ccdd6";
const PARENT_PROJECT_NAME = "TAP ERP Rebuild";
const PARENT_OWNER = "Jason";
const PARENT_RESOURCES = "Dev: Tim";
const PARENT_STATUS = "in-production";
const PARENT_CATEGORY = "active";
const PARENT_NOTES =
  "ERP rebuild for Mount Pleasant, TN org (Kim Sproul). Access 97 → PostgreSQL migration + 8-module development. Contract: Mar 1–Nov 30, 2026. Sequential phases: Discovery → SRD → DB Design → Dev (current) → Data Migration → Testing → Deployment → Training. Each phase blocked by predecessor.";

const TAP_TEAM_NEW = "Owner: Jason, Dev: Tim";

const UPDATED_BY = "migration";

// 10 existing L1 phase-projects to delete. All have zero linked week items
// per preflight (both TAP week items are orphans).
const PHASE_PROJECT_PREFIXES = [
  { prefix: "382ef69c", name: "Discovery Session (3 days onsite)" },
  { prefix: "efff9dce", name: "Requirements Doc (SRD)" },
  { prefix: "06cb2993", name: "Travel Invoice ($2,723 actuals)" },
  { prefix: "780f7ae2", name: "TAP Reviews SRD + Greenlights" },
  { prefix: "2d198789", name: "Database Design & Architecture" },
  { prefix: "d79d8271", name: "Development (8 modules)" },
  { prefix: "28ef513f", name: "Data Migration" },
  { prefix: "61b6cbc3", name: "Testing & QA" },
  { prefix: "09737544", name: "Deployment & Go-Live" },
  { prefix: "3dc300f1", name: "Training & Handoff" },
] as const;

// 2 orphan week items to rewire to new parent + flip status to completed.
type ExistingItemPlan = {
  prefix: string;
  expectedCurrentTitle: string;
  expectedWeekOf: string;
  fields: {
    status: string;
    resources: string;
    notes: string;
    title: string; // always written last
  };
};

const EXISTING_ITEM_PLANS: ExistingItemPlan[] = [
  {
    prefix: "8c44c7cc",
    expectedCurrentTitle: "TAP Travel Invoice",
    expectedWeekOf: "2026-04-06",
    fields: {
      status: "completed",
      resources: "Billing: Allie",
      notes: "Travel actuals $2,723. Out the door and paid.",
      title: "Travel Invoice — Actuals Paid",
    },
  },
  {
    prefix: "e52009ca",
    expectedCurrentTitle: "Route TAP Requirements Doc",
    expectedWeekOf: "2026-04-06",
    fields: {
      status: "completed",
      resources: "Dev: Tim",
      notes: "Final SRD delivered to Kim. Greenlit for Dev.",
      title: "Requirements Doc (SRD) — Delivered",
    },
  },
];

// 8 new L2 phase-milestone week items to create under the new parent.
type NewItemPlan = {
  title: string;
  date: string;
  dayOfWeek: string;
  weekOf: string;
  category: string;
  status: string | null;
  owner: string;
  resources: string | null;
  notes: string;
};

const NEW_ITEM_PLANS: NewItemPlan[] = [
  {
    title: "Discovery Session (3 days onsite)",
    date: "2026-03-16",
    dayOfWeek: "monday",
    weekOf: "2026-03-16",
    category: "kickoff",
    status: "completed",
    owner: "Jason",
    resources: "Dev: Tim",
    notes: "Mount Pleasant, TN. Mid-March. 3 days onsite.",
  },
  {
    title: "SRD Greenlit by Kim",
    date: "2026-04-10",
    dayOfWeek: "friday",
    weekOf: "2026-04-06",
    category: "approval",
    status: "completed",
    owner: "Jason",
    resources: null,
    notes: "Kim greenlit the project to move into Dev.",
  },
  {
    title: "Database Design & Architecture",
    date: "2026-04-15",
    dayOfWeek: "wednesday",
    weekOf: "2026-04-13",
    category: "delivery",
    status: "completed",
    owner: "Jason",
    resources: "Dev: Tim",
    notes: "Architecture locked. 2-3 weeks post-discovery.",
  },
  {
    title: "Development (8 modules)",
    date: "2026-04-20",
    dayOfWeek: "monday",
    weekOf: "2026-04-20",
    category: "kickoff",
    status: "in-progress",
    owner: "Jason",
    resources: "Dev: Tim",
    notes:
      "Firmly in Dev right now. Iterative, module by module. Target Mid-April–Mid-August.",
  },
  {
    title: "Data Migration — Kickoff",
    date: "2026-08-17",
    dayOfWeek: "monday",
    weekOf: "2026-08-17",
    category: "kickoff",
    status: "blocked",
    owner: "Jason",
    resources: "Dev: Tim",
    notes:
      "Access 97 → PostgreSQL. Blocked until Dev complete. Target Mid-Aug–Late Aug.",
  },
  {
    title: "Testing & QA — Kickoff",
    date: "2026-09-01",
    dayOfWeek: "tuesday",
    weekOf: "2026-08-31",
    category: "kickoff",
    status: "blocked",
    owner: "Jason",
    resources: "Dev: Tim",
    notes:
      "Civ QA + TAP UAT. Blocked until Data Migration complete. Target September.",
  },
  {
    title: "Deployment & Go-Live — Kickoff",
    date: "2026-10-14",
    dayOfWeek: "wednesday",
    weekOf: "2026-10-12",
    category: "kickoff",
    status: "blocked",
    owner: "Jason",
    resources: "Dev: Tim",
    notes:
      "Cloud or on-prem TBD. Blocked until Testing complete. Target Mid-October.",
  },
  {
    title: "Training & Handoff — Kickoff",
    date: "2026-10-26",
    dayOfWeek: "monday",
    weekOf: "2026-10-26",
    category: "kickoff",
    status: "blocked",
    owner: "Jason",
    resources: "Dev: Tim",
    notes: "All three orgs. Blocked until Deployment complete. Target Late October.",
  },
];

// ── Exports ──────────────────────────────────────────────

export const description =
  "TAP cleanup 2026-04-20: consolidate 10 phase-projects into one TAP ERP Rebuild parent; rewire 2 orphans (status→completed); create 8 new phase L2s; reformat client team.";

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("=== TAP Cleanup 2026-04-20 ===");

  // Step 1 — Pre-checks + resolve IDs
  const resolved = await preChecks(ctx);

  // Step 2 — Pre-write snapshot (written immediately before first write)
  await writeSnapshot(ctx, resolved);

  if (ctx.dryRun) {
    ctx.log("Dry-run: no writes will be performed. Operation plan follows.");
  }

  // Step 3 — Delete 10 phase-projects FIRST (no children per preflight).
  // Use exact current names so `deleteProject`'s fuzzy resolution is deterministic.
  for (const { name } of PHASE_PROJECT_PREFIXES) {
    ctx.log(`Delete project: TAP / ${name}`);
    if (!ctx.dryRun) {
      const result = await deleteProject({
        clientSlug: TAP_SLUG,
        projectName: name,
        updatedBy: UPDATED_BY,
      });
      if (!result.ok) throw new Error(`Delete ${name} failed: ${result.error}`);
    }
  }

  // Step 4 — Create new parent project, capture ID via fuzzy re-query
  ctx.log(
    `Create project: TAP / ${PARENT_PROJECT_NAME} (status=${PARENT_STATUS}, category=${PARENT_CATEGORY}, owner=${PARENT_OWNER}, resources="${PARENT_RESOURCES}")`
  );
  let newParentId: string | null = null;
  if (!ctx.dryRun) {
    const result = await addProject({
      clientSlug: TAP_SLUG,
      name: PARENT_PROJECT_NAME,
      status: PARENT_STATUS,
      category: PARENT_CATEGORY,
      owner: PARENT_OWNER,
      resources: PARENT_RESOURCES,
      notes: PARENT_NOTES,
      updatedBy: UPDATED_BY,
    });
    if (!result.ok) throw new Error(`Create parent failed: ${result.error}`);

    const parent = await findProjectByFuzzyName(resolved.tap.id, PARENT_PROJECT_NAME);
    if (!parent) throw new Error("New parent project not found after create.");
    newParentId = parent.id;
    ctx.log(`  → new parent id: ${newParentId}`);
  }

  // Step 5 — Update the 2 existing orphan week items (field changes)
  for (const plan of EXISTING_ITEM_PLANS) {
    const row = resolved.itemsByPrefix.get(plan.prefix);
    if (!row) throw new Error(`Missing resolved row for ${plan.prefix}`);
    await applyItemFieldUpdates(ctx, plan, row);
  }

  // Step 6 — Link the 2 rewired items to the new parent
  for (const plan of EXISTING_ITEM_PLANS) {
    const row = resolved.itemsByPrefix.get(plan.prefix);
    if (!row) throw new Error(`Missing resolved row for ${plan.prefix}`);
    ctx.log(`Link week item ${plan.prefix} → new parent`);
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

  // Step 6.5 — Sanity check: fuzzy-match for new parent resolves to captured ID
  // (After Phase 1 deletes the 10 old TAP projects, only the new parent exists.
  // createWeekItem relies on fuzzy-match to set projectId — make sure it's unambiguous.)
  if (!ctx.dryRun) {
    const resolvedParent = await findProjectByFuzzyName(
      resolved.tap.id,
      PARENT_PROJECT_NAME
    );
    if (!resolvedParent || resolvedParent.id !== newParentId) {
      throw new Error(
        `Fuzzy-match sanity check failed: '${PARENT_PROJECT_NAME}' resolved to ${resolvedParent?.id ?? "(nothing)"}; expected ${newParentId}.`
      );
    }
  }

  // Step 7 — Create 8 new L2 phase-milestone week items under the parent
  for (const item of NEW_ITEM_PLANS) {
    ctx.log(
      `Create week item: ${item.title} (${item.date} ${item.dayOfWeek}, status=${item.status ?? "null"})`
    );
    if (!ctx.dryRun) {
      const result = await createWeekItem({
        clientSlug: TAP_SLUG,
        projectName: PARENT_PROJECT_NAME,
        date: item.date,
        weekOf: item.weekOf,
        dayOfWeek: item.dayOfWeek,
        title: item.title,
        category: item.category,
        status: item.status ?? undefined,
        owner: item.owner,
        resources: item.resources ?? undefined,
        notes: item.notes,
        updatedBy: UPDATED_BY,
      });
      if (!result.ok) throw new Error(`Create '${item.title}' failed: ${result.error}`);
    }
  }

  // Step 8 — Update TAP client team field
  ctx.log(`Update client: TAP team → "${TAP_TEAM_NEW}"`);
  if (!ctx.dryRun) {
    const result = await updateClientField({
      clientSlug: TAP_SLUG,
      field: "team",
      newValue: TAP_TEAM_NEW,
      updatedBy: UPDATED_BY,
    });
    if (!result.ok) throw new Error(`Update client team failed: ${result.error}`);
  }

  // Step 9 — Verification
  if (!ctx.dryRun) {
    await verify(ctx, resolved.tap.id, newParentId!);
  }

  ctx.log("=== TAP Cleanup complete ===");
}

// ── Pre-checks ───────────────────────────────────────────

interface ResolvedState {
  tap: typeof clients.$inferSelect;
  phaseProjectIds: string[];
  itemsByPrefix: Map<string, typeof weekItems.$inferSelect>;
}

async function preChecks(ctx: MigrationContext): Promise<ResolvedState> {
  ctx.log("--- Pre-checks ---");

  // Resolve TAP client by slug
  const tapRows = await ctx.db.select().from(clients).where(eq(clients.slug, TAP_SLUG));
  const tap = tapRows[0];
  if (!tap) throw new Error(`Pre-check failed: client '${TAP_SLUG}' not found.`);
  if (tap.id !== TAP_CLIENT_ID) {
    throw new Error(
      `Pre-check failed: TAP client ID is ${tap.id}, expected ${TAP_CLIENT_ID}. ID-based assertions would be stale. Abort.`
    );
  }

  // Assert no TAP ERP Rebuild parent already exists (case-insensitive exact)
  const existingParents = await ctx.db
    .select()
    .from(projects)
    .where(eq(projects.clientId, tap.id));
  const existingParent = existingParents.find(
    (p) => p.name.trim().toLowerCase() === PARENT_PROJECT_NAME.toLowerCase()
  );
  if (existingParent) {
    throw new Error(
      `Pre-check failed: a '${PARENT_PROJECT_NAME}' project already exists for TAP (id=${existingParent.id}). Abort.`
    );
  }

  // Resolve 10 phase-project IDs by prefix
  const phaseProjectIds: string[] = [];
  for (const { prefix, name } of PHASE_PROJECT_PREFIXES) {
    const matches = await ctx.db
      .select()
      .from(projects)
      .where(and(eq(projects.clientId, tap.id), like(projects.id, `${prefix}%`)));
    if (matches.length !== 1) {
      throw new Error(
        `Pre-check failed: expected exactly 1 project with id prefix '${prefix}' (${name}), got ${matches.length}.`
      );
    }
    phaseProjectIds.push(matches[0].id);
  }

  // Assert none of the 10 phase-projects has linked week items.
  // Standard template rule — not an intentional deviation.
  const linkedToPhases = await ctx.db
    .select()
    .from(weekItems)
    .where(inArray(weekItems.projectId, phaseProjectIds));
  if (linkedToPhases.length > 0) {
    throw new Error(
      `Pre-check failed: ${linkedToPhases.length} week item(s) currently point at the 10 delete-list projects. Expected 0 per preflight. Abort.`
    );
  }

  // Resolve 2 rewire week-item IDs by prefix, assert currently orphaned
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
        `Pre-check failed: week item ${plan.prefix} already has projectId=${row.projectId}; expected null (orphan). Abort.`
      );
    }
    if (row.clientId !== tap.id) {
      throw new Error(
        `Pre-check failed: week item ${plan.prefix} clientId=${row.clientId ?? "null"}; expected ${tap.id} (TAP). Abort.`
      );
    }
    itemsByPrefix.set(plan.prefix, row);
  }

  ctx.log(
    `Pre-checks passed. TAP id=${tap.id}, 10 phase-projects resolved (no children), 2 orphan week items resolved.`
  );

  return { tap, phaseProjectIds, itemsByPrefix };
}

// ── Snapshot ─────────────────────────────────────────────

async function writeSnapshot(ctx: MigrationContext, r: ResolvedState): Promise<void> {
  const capturedAt = new Date().toISOString();
  const phaseProjectRows = await ctx.db
    .select()
    .from(projects)
    .where(inArray(projects.id, r.phaseProjectIds));

  const itemsToUpdate = Array.from(r.itemsByPrefix.values());

  const snapshot = {
    capturedAt,
    mode: ctx.dryRun ? "dry-run" : "apply",
    batchId: getBatchId(),
    client: r.tap,
    projectsToDelete: phaseProjectRows,
    weekItemsToRewire: itemsToUpdate,
    newParentPlanned: {
      name: PARENT_PROJECT_NAME,
      status: PARENT_STATUS,
      category: PARENT_CATEGORY,
      owner: PARENT_OWNER,
      resources: PARENT_RESOURCES,
      notes: PARENT_NOTES,
      dueDate: null,
      clientId: r.tap.id,
    },
    newWeekItemsPlanned: NEW_ITEM_PLANS,
    clientTeamPlanned: TAP_TEAM_NEW,
  };

  const suffix = ctx.dryRun ? "-dryrun" : "";
  const outPath = resolvePath(
    process.cwd(),
    `docs/tmp/tap-pre-apply-snapshot${suffix}.json`
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
  // Track current weekOf + title (mutate as we write). weekOf does not change
  // for either TAP rewire, so it stays stable. Title writes LAST because the
  // `updateWeekItemField` lookup uses (weekOf, title) fuzzy-match.
  const currentWeekOf = row.weekOf ?? plan.expectedWeekOf;
  let currentTitle = row.title;

  const fields = plan.fields;

  // Order: status → resources → notes → title (LAST).
  await writeField(ctx, plan.prefix, currentWeekOf, currentTitle, "status", fields.status);
  await writeField(ctx, plan.prefix, currentWeekOf, currentTitle, "resources", fields.resources);
  await writeField(ctx, plan.prefix, currentWeekOf, currentTitle, "notes", fields.notes);
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
  tapId: string,
  newParentId: string
): Promise<void> {
  ctx.log("--- Verification ---");

  // 1. Strict orphan invariant: no non-completed orphans for TAP.
  const strictOrphans = await ctx.db
    .select({ c: count() })
    .from(weekItems)
    .where(
      and(
        isNull(weekItems.projectId),
        eq(weekItems.clientId, tapId),
        ne(weekItems.status, "completed")
      )
    );
  const strictOrphanCount = strictOrphans[0]?.c ?? 0;
  ctx.log(`Strict TAP orphans (projectId IS NULL AND status != 'completed'): ${strictOrphanCount} (expected 0)`);
  if (strictOrphanCount !== 0) {
    throw new Error(
      `VERIFICATION FAILED: expected 0 strict orphans for TAP, got ${strictOrphanCount}.`
    );
  }

  // 2. Loose orphan invariant (informational): expect 0.
  const looseOrphans = await ctx.db
    .select({ c: count() })
    .from(weekItems)
    .where(and(isNull(weekItems.projectId), eq(weekItems.clientId, tapId)));
  const looseOrphanCount = looseOrphans[0]?.c ?? 0;
  ctx.log(`Loose TAP orphans (projectId IS NULL): ${looseOrphanCount} (expected 0)`);
  if (looseOrphanCount !== 0) {
    throw new Error(
      `VERIFICATION FAILED: expected 0 loose orphans for TAP, got ${looseOrphanCount}.`
    );
  }

  // 3. Each of the 10 deleted project IDs → 0 rows.
  for (const { prefix, name } of PHASE_PROJECT_PREFIXES) {
    const rows = await ctx.db
      .select({ id: projects.id })
      .from(projects)
      .where(like(projects.id, `${prefix}%`));
    if (rows.length !== 0) {
      throw new Error(`VERIFICATION FAILED: phase-project ${name} (${prefix}) still exists.`);
    }
  }

  // 4. New parent exists with expected state.
  const parentRows = await ctx.db.select().from(projects).where(eq(projects.id, newParentId));
  const parent = parentRows[0];
  if (!parent) throw new Error("VERIFICATION FAILED: new parent project not found.");
  if (parent.name !== PARENT_PROJECT_NAME)
    throw new Error(`VERIFICATION FAILED: parent name is "${parent.name}", expected "${PARENT_PROJECT_NAME}".`);
  if (parent.status !== PARENT_STATUS)
    throw new Error(`VERIFICATION FAILED: parent status is "${parent.status}", expected "${PARENT_STATUS}".`);
  if (parent.category !== PARENT_CATEGORY)
    throw new Error(`VERIFICATION FAILED: parent category is "${parent.category}", expected "${PARENT_CATEGORY}".`);
  if (parent.owner !== PARENT_OWNER)
    throw new Error(`VERIFICATION FAILED: parent owner is "${parent.owner}", expected "${PARENT_OWNER}".`);
  if (parent.resources !== PARENT_RESOURCES)
    throw new Error(`VERIFICATION FAILED: parent resources is "${parent.resources}", expected "${PARENT_RESOURCES}".`);
  if (parent.dueDate !== null)
    throw new Error(`VERIFICATION FAILED: parent dueDate is "${parent.dueDate}", expected null.`);

  // 5. Client team field matches.
  const tapRows = await ctx.db.select().from(clients).where(eq(clients.id, tapId));
  const tapRow = tapRows[0];
  if (tapRow.team !== TAP_TEAM_NEW) {
    throw new Error(
      `VERIFICATION FAILED: TAP team is "${tapRow.team}", expected "${TAP_TEAM_NEW}".`
    );
  }

  // 6. Count of week items with projectId = newParentId: expect 10 (2 rewired + 8 new).
  const linkedItems = await ctx.db
    .select()
    .from(weekItems)
    .where(eq(weekItems.projectId, newParentId));
  ctx.log(`Week items linked to new parent: ${linkedItems.length} (expected 10)`);
  if (linkedItems.length !== 10) {
    throw new Error(
      `VERIFICATION FAILED: expected 10 week items under new parent, got ${linkedItems.length}.`
    );
  }

  // 7. Total TAP project count: expect 1.
  const tapProjects = await ctx.db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.clientId, tapId));
  if (tapProjects.length !== 1) {
    throw new Error(
      `VERIFICATION FAILED: expected 1 TAP project, got ${tapProjects.length}.`
    );
  }

  // 8. Each of the 2 rewires: verify projectId, status, resources, title.
  for (const plan of EXISTING_ITEM_PLANS) {
    const rows = await ctx.db
      .select()
      .from(weekItems)
      .where(like(weekItems.id, `${plan.prefix}%`));
    const row = rows[0];
    if (!row) throw new Error(`VERIFICATION FAILED: rewire ${plan.prefix} row missing.`);
    if (row.projectId !== newParentId)
      throw new Error(
        `VERIFICATION FAILED: rewire ${plan.prefix} projectId is ${row.projectId ?? "null"}, expected ${newParentId}.`
      );
    if (row.status !== plan.fields.status)
      throw new Error(
        `VERIFICATION FAILED: rewire ${plan.prefix} status is "${row.status}", expected "${plan.fields.status}".`
      );
    if (row.resources !== plan.fields.resources)
      throw new Error(
        `VERIFICATION FAILED: rewire ${plan.prefix} resources is "${row.resources}", expected "${plan.fields.resources}".`
      );
    if (row.title !== plan.fields.title)
      throw new Error(
        `VERIFICATION FAILED: rewire ${plan.prefix} title is "${row.title}", expected "${plan.fields.title}".`
      );
  }

  ctx.log("Verification passed.");
}
