/**
 * Migration: HDL Website Build Cleanup — 2026-04-20
 *
 * Consolidates 14 existing HDL Level 1 phase-projects into a single
 * `HDL Website Build` parent project. Rewires 5 existing week items to the
 * new parent (renames, date shifts, status flips, resources reformat, notes),
 * creates 9 new phase-milestone L2s, and sets the HDL client `team` field.
 *
 * Operation order (Variant A — phase-projects exist):
 *   pre-checks → pre-write JSON snapshot → delete 14 phase-projects (cascade
 *   nulls projectId on 5 linked children) → create `HDL Website Build` parent
 *   → apply non-FK field updates to the 5 rewire items → re-link the 5 items
 *   to the new parent → create 9 new phase L2s → update HDL client team →
 *   verify.
 *
 * DEVIATION from the standard pre-check template: the usual
 * "no week items currently point at the delete list" assertion is
 * INTENTIONALLY SKIPPED. 5 of the 14 delete-list projects have exactly 1
 * linked child each — that is the expected pre-state. `deleteProject`
 * atomically nulls `weekItems.projectId` inside a transaction; Phase 4 then
 * re-links the 5 children to the new parent via `linkWeekItemToProject`.
 *
 * Instead we POSITIVELY ASSERT the expected pre-state:
 *   - Exactly 5 of the 14 delete-list projects have linked children
 *   - Each of those 5 points at exactly the expected rewire-item prefix
 *
 * Any drift from the preflight (4/19) fails loud.
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
  generateIdempotencyKey,
  insertAuditRecord,
  linkWeekItemToProject,
  updateClientField,
  updateWeekItemField,
} from "@/lib/runway/operations";

// ── Constants ────────────────────────────────────────────

const HDL_SLUG = "hdl";
const HDL_CLIENT_ID = "9c43ae144b684a1dad702d44c";
const PARENT_PROJECT_NAME = "HDL Website Build";
const PARENT_OWNER = "Jill";
const PARENT_RESOURCES = "CD: Lane, Dev: Leslie";
const PARENT_STATUS = "in-production";
const PARENT_CATEGORY = "active";
const PARENT_NOTES =
  "14-phase website build for High Desert Law. Site Copy delivered (Chris unblocked). Full Site Design in-progress with Lane, target Fri 4/24. Dev starts Mon 4/27 with Leslie. Photo shoot slipped May → June per client. Site Live target 6/30 (at risk). **Contract EXPIRED 1/31/2026 — flag for business discussion.**";

const HDL_TEAM_NEW = "AM: Jill, CD: Lane, Dev: Leslie, PM: Jason";

const UPDATED_BY = "migration";

// 14 existing L1 phase-projects to delete. 5 have linked children (see
// EXISTING_ITEM_PLANS below); `deleteProject` cascade nulls those projectIds.
// The `hasChild` flag is asserted positively in pre-checks.
const PHASE_PROJECT_PREFIXES = [
  { prefix: "9a557604", name: "Home Page Design", hasChild: false },
  { prefix: "b126fc43", name: "Site Copy", hasChild: false },
  { prefix: "5396ad4f", name: "Site Copy Review", hasChild: true, childPrefix: "3aafc22a" },
  { prefix: "34c55af9", name: "Full Site Design", hasChild: true, childPrefix: "8ac945d6" },
  { prefix: "86eaf1c9", name: "Full Site Design Approval", hasChild: true, childPrefix: "2c0f97a7" },
  { prefix: "03af4714", name: "Photo Shoot Prep", hasChild: true, childPrefix: "b6019f8d" },
  { prefix: "e60d9be0", name: "Start Development", hasChild: true, childPrefix: "6e9ad9f6" },
  { prefix: "00948e7d", name: "Schema/SEO/AIO", hasChild: false },
  { prefix: "ba5e5040", name: "Ad Words", hasChild: false },
  { prefix: "91fe1051", name: "Smokeball Integration", hasChild: false },
  { prefix: "39d46217", name: "Domain/URL + Webflow", hasChild: false },
  { prefix: "65c8c97c", name: "Site Staging", hasChild: false },
  { prefix: "1ca3e6a2", name: "Production Shoot", hasChild: false },
  { prefix: "8d75ad57", name: "Site Live", hasChild: false },
] as const;

// 5 existing week items to rewire to the new parent.
// Per Bonterra pattern (TP-confirmed): only write fields that actually differ
// from the current row value — no no-op writes, cleaner audit trail.
type ExistingItemPlan = {
  prefix: string;
  expectedCurrentTitle: string;
  expectedWeekOf: string;
  expectedParentPrefix: string; // positively assert current parent
  fields: {
    status?: string | null; // null means "write NULL (raw UPDATE fallback)"
    date?: string;
    dayOfWeek?: string;
    weekOf?: string;
    resources?: string | null; // null means "write NULL (raw UPDATE fallback)"
    category?: string;
    notes?: string;
    title?: string; // always written LAST if differs from current
  };
};

const EXISTING_ITEM_PLANS: ExistingItemPlan[] = [
  {
    prefix: "3aafc22a",
    expectedCurrentTitle: "HDL Site Copy Review",
    expectedWeekOf: "2026-04-06",
    expectedParentPrefix: "5396ad4f",
    fields: {
      status: "completed",
      resources: "CW: Chris (client)",
      notes: "HDL reviewed copy. Copy now locked.",
      title: "Site Copy Review",
    },
  },
  {
    prefix: "8ac945d6",
    expectedCurrentTitle: "HDL Full Site Design — Civ delivers",
    expectedWeekOf: "2026-04-13",
    expectedParentPrefix: "34c55af9",
    fields: {
      status: "in-progress",
      date: "2026-04-24",
      dayOfWeek: "friday",
      weekOf: "2026-04-20",
      resources: "CD: Lane",
      notes:
        "Lane kicked off Mon 4/20, target Fri 4/24 delivery. (Risk: design-to-dev handoff tight.)",
      title: "Full Site Design — Civ Delivers",
    },
  },
  {
    prefix: "2c0f97a7",
    expectedCurrentTitle: "HDL Full Site Design Approval",
    expectedWeekOf: "2026-04-20",
    expectedParentPrefix: "86eaf1c9",
    fields: {
      status: "blocked",
      date: "2026-04-27",
      dayOfWeek: "monday",
      weekOf: "2026-04-27",
      resources: null, // client-facing, no internal resources
      notes: "HDL to approve design. Unblocks dev kickoff same day.",
      title: "Full Site Design Approval",
    },
  },
  {
    prefix: "b6019f8d",
    expectedCurrentTitle: "HDL Photo Shoot Prep",
    expectedWeekOf: "2026-04-13",
    expectedParentPrefix: "03af4714",
    fields: {
      status: "blocked",
      date: "2026-05-18",
      dayOfWeek: "monday",
      weekOf: "2026-05-18",
      resources: "CD: Lane",
      notes:
        "Production book + shot list. Shoot moved May → June. Prep lines up early-to-mid May.",
      title: "Photo Shoot Prep",
    },
  },
  {
    prefix: "6e9ad9f6",
    expectedCurrentTitle: "HDL Start Development",
    expectedWeekOf: "2026-04-27",
    expectedParentPrefix: "e60d9be0",
    fields: {
      status: "blocked",
      date: "2026-04-27",
      dayOfWeek: "monday",
      // weekOf unchanged (2026-04-27)
      resources: "Dev: Leslie",
      notes: "Leslie takes over post-approval. Blocked until Full Site Design Approval lands.",
      title: "Start Development",
    },
  },
];

// 9 new L2 phase-milestone week items under the new parent.
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
    title: "Home Page Design",
    date: "2026-02-25",
    dayOfWeek: "wednesday",
    weekOf: "2026-02-23",
    category: "delivery",
    status: "completed",
    owner: "Jill",
    resources: "CD: Lane",
    notes: "Done 2/25 (historical).",
  },
  {
    title: "Site Copy",
    date: "2026-04-18",
    dayOfWeek: "saturday",
    weekOf: "2026-04-13",
    category: "delivery",
    status: "completed",
    owner: "Jill",
    resources: "CW: Chris (client)",
    notes: "Copy delivered by Chris (client copywriter). Was late blocker, now clear.",
  },
  {
    title: "Schema/SEO/AIO",
    date: "2026-05-04",
    dayOfWeek: "monday",
    weekOf: "2026-05-04",
    category: "kickoff",
    status: "blocked",
    owner: "Jill",
    resources: "Dev: Leslie",
    notes: "Part of dev phase. Blocked until dev kickoff.",
  },
  {
    title: "Ad Words",
    date: "2026-05-11",
    dayOfWeek: "monday",
    weekOf: "2026-05-11",
    category: "kickoff",
    status: "blocked",
    owner: "Jill",
    resources: null,
    notes: "Jamie Lincoln (HDL side) to manage. Blocked on site readiness.",
  },
  {
    title: "Smokeball Integration",
    date: "2026-05-18",
    dayOfWeek: "monday",
    weekOf: "2026-05-18",
    category: "kickoff",
    status: "blocked",
    owner: "Jill",
    resources: "Dev: Leslie",
    notes: "Lead capture, form fields. Blocked on dev progress.",
  },
  {
    title: "Domain/URL + Webflow",
    date: "2026-06-01",
    dayOfWeek: "monday",
    weekOf: "2026-06-01",
    category: "kickoff",
    status: "blocked",
    owner: "Jill",
    resources: "Dev: Leslie",
    notes: "Blocked on dev progress.",
  },
  {
    title: "Site Staging",
    date: "2026-06-08",
    dayOfWeek: "monday",
    weekOf: "2026-06-08",
    category: "kickoff",
    status: "blocked",
    owner: "Jill",
    resources: "Dev: Leslie",
    notes: "Publish pages as complete. Blocked on pages ready.",
  },
  {
    title: "Production Shoot",
    date: "2026-06-15",
    dayOfWeek: "monday",
    weekOf: "2026-06-15",
    category: "deadline",
    status: "blocked",
    owner: "Jill",
    resources: null,
    notes: "Shoot moved from May to June per client. Outside original SOW timeline.",
  },
  {
    title: "Site Live",
    date: "2026-06-30",
    dayOfWeek: "tuesday",
    weekOf: "2026-06-29",
    category: "launch",
    status: "blocked",
    owner: "Jill",
    resources: "Dev: Leslie",
    notes: "Site Live target. Risk: photo shoot slip may push launch.",
  },
];

// ── Exports ──────────────────────────────────────────────

export const description =
  "HDL cleanup 2026-04-20: consolidate 14 phase-projects into one HDL Website Build parent; rewire 5 week items; create 9 new phase L2s; update client team.";

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("=== HDL Website Build Cleanup 2026-04-20 ===");

  // Step 1 — Pre-checks + resolve IDs
  const resolved = await preChecks(ctx);

  // Step 2 — Pre-write snapshot (written immediately before first write)
  await writeSnapshot(ctx, resolved);

  if (ctx.dryRun) {
    ctx.log("Dry-run: no writes will be performed. Operation plan follows.");
  }

  // Step 3 — Delete 14 phase-projects. The 5 linked children have their
  // projectId nulled atomically by deleteProject's transaction; re-linked
  // in Phase 4.
  for (const { name } of PHASE_PROJECT_PREFIXES) {
    ctx.log(`Delete project: HDL / ${name}`);
    if (!ctx.dryRun) {
      const result = await deleteProject({
        clientSlug: HDL_SLUG,
        projectName: name,
        updatedBy: UPDATED_BY,
      });
      if (!result.ok) throw new Error(`Delete ${name} failed: ${result.error}`);
    }
  }

  // Step 4 — Create new parent project, capture ID via fuzzy re-query
  ctx.log(
    `Create project: HDL / ${PARENT_PROJECT_NAME} (status=${PARENT_STATUS}, category=${PARENT_CATEGORY}, owner=${PARENT_OWNER}, resources="${PARENT_RESOURCES}")`
  );
  let newParentId: string | null = null;
  if (!ctx.dryRun) {
    const result = await addProject({
      clientSlug: HDL_SLUG,
      name: PARENT_PROJECT_NAME,
      status: PARENT_STATUS,
      category: PARENT_CATEGORY,
      owner: PARENT_OWNER,
      resources: PARENT_RESOURCES,
      notes: PARENT_NOTES,
      updatedBy: UPDATED_BY,
    });
    if (!result.ok) throw new Error(`Create parent failed: ${result.error}`);

    const parent = await findProjectByFuzzyName(resolved.hdl.id, PARENT_PROJECT_NAME);
    if (!parent) throw new Error("New parent project not found after create.");
    newParentId = parent.id;
    ctx.log(`  → new parent id: ${newParentId}`);
  }

  // Step 5 — Update the 5 existing rewire week items (field changes)
  for (const plan of EXISTING_ITEM_PLANS) {
    const row = resolved.itemsByPrefix.get(plan.prefix);
    if (!row) throw new Error(`Missing resolved row for ${plan.prefix}`);
    await applyItemFieldUpdates(ctx, plan, row);
  }

  // Step 6 — Link the 5 rewired items to the new parent
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
  // (After Phase 1 deletes the 14 old HDL projects, only the new parent exists.
  // createWeekItem relies on fuzzy-match to set projectId — make sure it's unambiguous.)
  if (!ctx.dryRun) {
    const resolvedParent = await findProjectByFuzzyName(resolved.hdl.id, PARENT_PROJECT_NAME);
    if (!resolvedParent || resolvedParent.id !== newParentId) {
      throw new Error(
        `Fuzzy-match sanity check failed: '${PARENT_PROJECT_NAME}' resolved to ${resolvedParent?.id ?? "(nothing)"}; expected ${newParentId}.`
      );
    }
  }

  // Step 7 — Create 9 new L2 phase-milestone week items under the parent
  for (const item of NEW_ITEM_PLANS) {
    ctx.log(
      `Create week item: ${item.title} (${item.date} ${item.dayOfWeek}, status=${item.status ?? "null"})`
    );
    if (!ctx.dryRun) {
      const result = await createWeekItem({
        clientSlug: HDL_SLUG,
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

  // Step 8 — Update HDL client team field
  ctx.log(`Update client: HDL team → "${HDL_TEAM_NEW}"`);
  if (!ctx.dryRun) {
    const result = await updateClientField({
      clientSlug: HDL_SLUG,
      field: "team",
      newValue: HDL_TEAM_NEW,
      updatedBy: UPDATED_BY,
    });
    if (!result.ok) throw new Error(`Update client team failed: ${result.error}`);
  }

  // Step 9 — Verification
  if (!ctx.dryRun) {
    await verify(ctx, resolved.hdl.id, newParentId!);
  }

  ctx.log("=== HDL Website Build Cleanup complete ===");
}

// ── Pre-checks ───────────────────────────────────────────

interface ResolvedState {
  hdl: typeof clients.$inferSelect;
  phaseProjectIds: string[];
  itemsByPrefix: Map<string, typeof weekItems.$inferSelect>;
}

async function preChecks(ctx: MigrationContext): Promise<ResolvedState> {
  ctx.log("--- Pre-checks ---");

  // Resolve HDL client by slug + strict ID assertion
  const hdlRows = await ctx.db.select().from(clients).where(eq(clients.slug, HDL_SLUG));
  const hdl = hdlRows[0];
  if (!hdl) throw new Error(`Pre-check failed: client '${HDL_SLUG}' not found.`);
  if (hdl.id !== HDL_CLIENT_ID) {
    throw new Error(
      `Pre-check failed: HDL client ID is ${hdl.id}, expected ${HDL_CLIENT_ID}. ID-based assertions would be stale. Abort.`
    );
  }

  // Assert no `HDL Website Build` parent already exists (case-insensitive exact)
  const existingParents = await ctx.db
    .select()
    .from(projects)
    .where(eq(projects.clientId, hdl.id));
  const existingParent = existingParents.find(
    (p) => p.name.trim().toLowerCase() === PARENT_PROJECT_NAME.toLowerCase()
  );
  if (existingParent) {
    throw new Error(
      `Pre-check failed: a '${PARENT_PROJECT_NAME}' project already exists for HDL (id=${existingParent.id}). Abort.`
    );
  }

  // Resolve 14 phase-project IDs by prefix. Map prefix → fullId for downstream
  // assertions.
  const phaseProjectIds: string[] = [];
  const phaseIdByPrefix = new Map<string, string>();
  for (const { prefix, name } of PHASE_PROJECT_PREFIXES) {
    const matches = await ctx.db
      .select()
      .from(projects)
      .where(and(eq(projects.clientId, hdl.id), like(projects.id, `${prefix}%`)));
    if (matches.length !== 1) {
      throw new Error(
        `Pre-check failed: expected exactly 1 project with id prefix '${prefix}' (${name}), got ${matches.length}.`
      );
    }
    phaseProjectIds.push(matches[0].id);
    phaseIdByPrefix.set(prefix, matches[0].id);
  }

  // Positively assert the linked-children pattern:
  //   - Exactly 5 of 14 phase-projects have linked children
  //   - Each of those 5 has exactly 1 linked child
  //   - That child's id-prefix matches the expected EXISTING_ITEM_PLANS prefix
  const allLinkedChildren = await ctx.db
    .select()
    .from(weekItems)
    .where(inArray(weekItems.projectId, phaseProjectIds));
  if (allLinkedChildren.length !== 5) {
    throw new Error(
      `Pre-check failed: expected exactly 5 week items linked to the 14 phase-projects, got ${allLinkedChildren.length}. Preflight drift — abort.`
    );
  }
  const childByParentId = new Map<string, typeof weekItems.$inferSelect>();
  for (const child of allLinkedChildren) {
    if (!child.projectId) continue; // unreachable; inArray above ensured non-null
    if (childByParentId.has(child.projectId)) {
      throw new Error(
        `Pre-check failed: phase-project ${child.projectId} has >1 linked child (expected 1).`
      );
    }
    childByParentId.set(child.projectId, child);
  }
  for (const phase of PHASE_PROJECT_PREFIXES) {
    const phaseId = phaseIdByPrefix.get(phase.prefix)!;
    const child = childByParentId.get(phaseId);
    if (phase.hasChild) {
      if (!child) {
        throw new Error(
          `Pre-check failed: phase-project '${phase.name}' (${phase.prefix}) expected a linked child, found none.`
        );
      }
      if (!child.id.startsWith(phase.childPrefix!)) {
        throw new Error(
          `Pre-check failed: phase-project '${phase.name}' child id is ${child.id}; expected to start with '${phase.childPrefix}'.`
        );
      }
    } else {
      if (child) {
        throw new Error(
          `Pre-check failed: phase-project '${phase.name}' (${phase.prefix}) expected NO linked children, found ${child.id}.`
        );
      }
    }
  }

  // Resolve 5 rewire week-item IDs by prefix, assert each's current parent
  // matches the expected phase-project.
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
    if (row.clientId !== hdl.id) {
      throw new Error(
        `Pre-check failed: week item ${plan.prefix} clientId=${row.clientId ?? "null"}; expected ${hdl.id} (HDL). Abort.`
      );
    }
    if (!row.projectId) {
      throw new Error(
        `Pre-check failed: week item ${plan.prefix} projectId is null; expected a parent with prefix '${plan.expectedParentPrefix}'. Abort.`
      );
    }
    if (!row.projectId.startsWith(plan.expectedParentPrefix)) {
      throw new Error(
        `Pre-check failed: week item ${plan.prefix} parent is ${row.projectId}; expected prefix '${plan.expectedParentPrefix}'. Abort.`
      );
    }
    if (row.weekOf !== plan.expectedWeekOf) {
      throw new Error(
        `Pre-check failed: week item ${plan.prefix} weekOf is '${row.weekOf}'; expected '${plan.expectedWeekOf}'. Abort.`
      );
    }
    if (row.title !== plan.expectedCurrentTitle) {
      throw new Error(
        `Pre-check failed: week item ${plan.prefix} title is '${row.title}'; expected '${plan.expectedCurrentTitle}'. Abort.`
      );
    }
    itemsByPrefix.set(plan.prefix, row);
  }

  ctx.log(
    `Pre-checks passed. HDL id=${hdl.id}, 14 phase-projects resolved (5 with linked children, 9 without), 5 rewire week items resolved.`
  );

  return { hdl, phaseProjectIds, itemsByPrefix };
}

// ── Snapshot ─────────────────────────────────────────────

async function writeSnapshot(ctx: MigrationContext, r: ResolvedState): Promise<void> {
  const capturedAt = new Date().toISOString();
  const phaseProjectRows = await ctx.db
    .select()
    .from(projects)
    .where(inArray(projects.id, r.phaseProjectIds));

  const itemsToRewire = Array.from(r.itemsByPrefix.values());

  const snapshot = {
    capturedAt,
    mode: ctx.dryRun ? "dry-run" : "apply",
    client: r.hdl,
    projectsToDelete: phaseProjectRows,
    weekItemsToRewire: itemsToRewire,
    newParentPlanned: {
      name: PARENT_PROJECT_NAME,
      status: PARENT_STATUS,
      category: PARENT_CATEGORY,
      owner: PARENT_OWNER,
      resources: PARENT_RESOURCES,
      notes: PARENT_NOTES,
      dueDate: null,
      clientId: r.hdl.id,
    },
    rewirePlan: EXISTING_ITEM_PLANS,
    newWeekItemsPlanned: NEW_ITEM_PLANS,
    clientTeamPlanned: HDL_TEAM_NEW,
  };

  const suffix = ctx.dryRun ? "-dryrun" : "";
  const outPath = resolvePath(
    process.cwd(),
    `docs/tmp/hdl-pre-apply-snapshot${suffix}.json`
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
  // Track current weekOf + title (mutate as we write). Title is the fuzzy-
  // lookup key in `updateWeekItemField`, so it's written LAST. weekOf also
  // participates in the lookup key; when weekOf changes, write it BEFORE
  // title but AFTER all other fields so the title lookup uses the new weekOf.
  let currentWeekOf = row.weekOf ?? plan.expectedWeekOf;
  let currentTitle = row.title;
  const currentStatus = row.status;
  const currentResources = row.resources;

  const fields = plan.fields;

  // Bonterra pattern: only write fields whose new value differs from current.
  // Null handling for status/resources uses raw UPDATE + hand-written audit.

  // status
  if (fields.status !== undefined) {
    if (fields.status === null) {
      if (currentStatus === null) {
        ctx.log(`Week item ${plan.prefix}: status already null, skipping`);
      } else {
        ctx.log(
          `Week item ${plan.prefix}: status "${currentStatus}" → null (raw UPDATE, unexpected pre-state)`
        );
        if (!ctx.dryRun) {
          await rawNullUpdate(
            ctx,
            row.id,
            row.clientId,
            "status",
            currentStatus,
            currentTitle
          );
        }
      }
    } else if (fields.status !== currentStatus) {
      await writeField(ctx, plan.prefix, currentWeekOf, currentTitle, "status", fields.status);
    } else {
      ctx.log(`Week item ${plan.prefix}: status already "${fields.status}", skipping`);
    }
  }

  // category
  if (fields.category !== undefined && fields.category !== row.category) {
    await writeField(ctx, plan.prefix, currentWeekOf, currentTitle, "category", fields.category);
  }

  // resources (null-capable)
  if (fields.resources !== undefined) {
    if (fields.resources === null) {
      if (currentResources === null) {
        ctx.log(`Week item ${plan.prefix}: resources already null, skipping`);
      } else {
        ctx.log(
          `Week item ${plan.prefix}: resources "${currentResources}" → null (raw UPDATE)`
        );
        if (!ctx.dryRun) {
          await rawNullUpdate(
            ctx,
            row.id,
            row.clientId,
            "resources",
            currentResources,
            currentTitle
          );
        }
      }
    } else if (fields.resources !== currentResources) {
      await writeField(
        ctx,
        plan.prefix,
        currentWeekOf,
        currentTitle,
        "resources",
        fields.resources
      );
    } else {
      ctx.log(`Week item ${plan.prefix}: resources already "${fields.resources}", skipping`);
    }
  }

  // notes
  if (fields.notes !== undefined && fields.notes !== row.notes) {
    await writeField(ctx, plan.prefix, currentWeekOf, currentTitle, "notes", fields.notes);
  }

  // date
  if (fields.date !== undefined && fields.date !== row.date) {
    await writeField(ctx, plan.prefix, currentWeekOf, currentTitle, "date", fields.date);
  }

  // dayOfWeek
  if (fields.dayOfWeek !== undefined && fields.dayOfWeek !== row.dayOfWeek) {
    await writeField(
      ctx,
      plan.prefix,
      currentWeekOf,
      currentTitle,
      "dayOfWeek",
      fields.dayOfWeek
    );
  }

  // weekOf — writes BEFORE title so the title lookup uses the new weekOf
  if (fields.weekOf !== undefined && fields.weekOf !== currentWeekOf) {
    await writeField(ctx, plan.prefix, currentWeekOf, currentTitle, "weekOf", fields.weekOf);
    currentWeekOf = fields.weekOf;
  }

  // title — LAST
  if (fields.title !== undefined && fields.title !== currentTitle) {
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

/**
 * Raw UPDATE fallback for writing a field to NULL. `updateWeekItemField` takes
 * `newValue: string` and can't express NULL. Writes the column directly on the
 * week_items table, then inserts a hand-written audit record tagged with the
 * migration's batchId (auto-set by the harness via setBatchId).
 */
async function rawNullUpdate(
  ctx: MigrationContext,
  weekItemId: string,
  clientId: string | null,
  field: "status" | "resources",
  previousValue: string,
  currentTitle: string
): Promise<void> {
  if (field === "status") {
    await ctx.db
      .update(weekItems)
      .set({ status: null, updatedAt: new Date() })
      .where(eq(weekItems.id, weekItemId));
  } else {
    await ctx.db
      .update(weekItems)
      .set({ resources: null, updatedAt: new Date() })
      .where(eq(weekItems.id, weekItemId));
  }

  const idemKey = generateIdempotencyKey(
    "week-field-change",
    weekItemId,
    field,
    "(null)",
    UPDATED_BY
  );
  await insertAuditRecord({
    idempotencyKey: idemKey,
    clientId,
    updatedBy: UPDATED_BY,
    updateType: "week-field-change",
    previousValue,
    newValue: "(null)",
    summary: `Week item '${currentTitle}': ${field} changed from "${previousValue}" to null`,
    metadata: JSON.stringify({ field }),
  });
}

// ── Verification ─────────────────────────────────────────

async function verify(
  ctx: MigrationContext,
  hdlId: string,
  newParentId: string
): Promise<void> {
  ctx.log("--- Verification ---");

  // 1. Strict orphan invariant: no non-completed HDL orphans.
  const strictOrphans = await ctx.db
    .select({ c: count() })
    .from(weekItems)
    .where(
      and(
        isNull(weekItems.projectId),
        eq(weekItems.clientId, hdlId),
        ne(weekItems.status, "completed")
      )
    );
  const strictOrphanCount = strictOrphans[0]?.c ?? 0;
  ctx.log(
    `Strict HDL orphans (projectId IS NULL AND status != 'completed'): ${strictOrphanCount} (expected 0)`
  );
  if (strictOrphanCount !== 0) {
    throw new Error(
      `VERIFICATION FAILED: expected 0 strict orphans for HDL, got ${strictOrphanCount}.`
    );
  }

  // 2. Loose orphan invariant: expect 0 (no children left dangling).
  const looseOrphans = await ctx.db
    .select({ c: count() })
    .from(weekItems)
    .where(and(isNull(weekItems.projectId), eq(weekItems.clientId, hdlId)));
  const looseOrphanCount = looseOrphans[0]?.c ?? 0;
  ctx.log(`Loose HDL orphans (projectId IS NULL): ${looseOrphanCount} (expected 0)`);
  if (looseOrphanCount !== 0) {
    throw new Error(
      `VERIFICATION FAILED: expected 0 loose orphans for HDL, got ${looseOrphanCount}.`
    );
  }

  // 3. Each of the 14 deleted project IDs → 0 rows.
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
    throw new Error(
      `VERIFICATION FAILED: parent name is "${parent.name}", expected "${PARENT_PROJECT_NAME}".`
    );
  if (parent.status !== PARENT_STATUS)
    throw new Error(
      `VERIFICATION FAILED: parent status is "${parent.status}", expected "${PARENT_STATUS}".`
    );
  if (parent.category !== PARENT_CATEGORY)
    throw new Error(
      `VERIFICATION FAILED: parent category is "${parent.category}", expected "${PARENT_CATEGORY}".`
    );
  if (parent.owner !== PARENT_OWNER)
    throw new Error(
      `VERIFICATION FAILED: parent owner is "${parent.owner}", expected "${PARENT_OWNER}".`
    );
  if (parent.resources !== PARENT_RESOURCES)
    throw new Error(
      `VERIFICATION FAILED: parent resources is "${parent.resources}", expected "${PARENT_RESOURCES}".`
    );
  if (parent.dueDate !== null)
    throw new Error(
      `VERIFICATION FAILED: parent dueDate is "${parent.dueDate}", expected null.`
    );

  // 5. Client team field matches.
  const hdlRows = await ctx.db.select().from(clients).where(eq(clients.id, hdlId));
  const hdlRow = hdlRows[0];
  if (hdlRow.team !== HDL_TEAM_NEW) {
    throw new Error(
      `VERIFICATION FAILED: HDL team is "${hdlRow.team}", expected "${HDL_TEAM_NEW}".`
    );
  }

  // 6. Week items linked to new parent: expect 14 (5 rewires + 9 new).
  const linkedItems = await ctx.db
    .select()
    .from(weekItems)
    .where(eq(weekItems.projectId, newParentId));
  ctx.log(`Week items linked to new parent: ${linkedItems.length} (expected 14)`);
  if (linkedItems.length !== 14) {
    throw new Error(
      `VERIFICATION FAILED: expected 14 week items under new parent, got ${linkedItems.length}.`
    );
  }

  // 7. Total HDL project count: expect 1.
  const hdlProjects = await ctx.db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.clientId, hdlId));
  if (hdlProjects.length !== 1) {
    throw new Error(
      `VERIFICATION FAILED: expected 1 HDL project, got ${hdlProjects.length}.`
    );
  }

  // 8. Each of the 5 rewires: verify projectId + post-state fields.
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
    if (plan.fields.title !== undefined && row.title !== plan.fields.title)
      throw new Error(
        `VERIFICATION FAILED: rewire ${plan.prefix} title is "${row.title}", expected "${plan.fields.title}".`
      );
    if (plan.fields.status !== undefined && row.status !== plan.fields.status)
      throw new Error(
        `VERIFICATION FAILED: rewire ${plan.prefix} status is ${row.status === null ? "null" : `"${row.status}"`}, expected ${plan.fields.status === null ? "null" : `"${plan.fields.status}"`}.`
      );
    if (plan.fields.resources !== undefined && row.resources !== plan.fields.resources)
      throw new Error(
        `VERIFICATION FAILED: rewire ${plan.prefix} resources is ${row.resources === null ? "null" : `"${row.resources}"`}, expected ${plan.fields.resources === null ? "null" : `"${plan.fields.resources}"`}.`
      );
    if (plan.fields.date !== undefined && row.date !== plan.fields.date)
      throw new Error(
        `VERIFICATION FAILED: rewire ${plan.prefix} date is "${row.date}", expected "${plan.fields.date}".`
      );
    if (plan.fields.weekOf !== undefined && row.weekOf !== plan.fields.weekOf)
      throw new Error(
        `VERIFICATION FAILED: rewire ${plan.prefix} weekOf is "${row.weekOf}", expected "${plan.fields.weekOf}".`
      );
    if (plan.fields.dayOfWeek !== undefined && row.dayOfWeek !== plan.fields.dayOfWeek)
      throw new Error(
        `VERIFICATION FAILED: rewire ${plan.prefix} dayOfWeek is "${row.dayOfWeek}", expected "${plan.fields.dayOfWeek}".`
      );
  }

  ctx.log("Verification passed.");
}
