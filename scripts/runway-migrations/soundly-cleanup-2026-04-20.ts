/**
 * Migration: Soundly Data Cleanup — 2026-04-20
 *
 * Fourth client cleanup using the shared-project model (after Bonterra
 * 2026-04-19, Convergix 2026-04-20, TAP 2026-04-20).
 *
 * Variant B — no phase-project deletes, no new parents. The 3 existing
 * L1s are kept as separate engagement tracks; the 3 orphan week items
 * rewire to the correct L1s; 1 minimum L2 stub is created under the
 * lone childless L1 (Payment Gateway Page); client team/owner/resources
 * normalized to role-prefix format.
 *
 * Ops:
 *   - 0 L1 deletes
 *   - 0 L1 creates
 *   - 3 L1 existing field updates (owner → Jill on all; resources role-tagged;
 *     AARP status not-started → in-production + notes rewrite)
 *   - 3 L2 orphan rewires (fields + linkWeekItemToProject); 2 of 3 flip
 *     status=null → completed (AARP kickoffs, historical retention)
 *   - 1 L2 create (Payment Gateway Page — In Dev, 2026-04-23 thu)
 *   - 1 client team field update
 *
 * Operation order (pinned, Variant B):
 *   pre-checks → narrow pre-write snapshot → 3 L1 updates → 3 L2 rewires
 *   (fields then link) → 1 L2 create → client team update → verification.
 */
import { writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { and, eq, isNull, like, ne } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { clients, projects, weekItems } from "@/lib/db/runway-schema";
import {
  createWeekItem,
  linkWeekItemToProject,
  updateClientField,
  updateProjectField,
  updateProjectStatus,
  updateWeekItemField,
} from "@/lib/runway/operations";

// ── Constants ────────────────────────────────────────────

const SOUNDLY_SLUG = "soundly";
const SOUNDLY_ID = "c68d8a44464245dd9c3075f26";
const UPDATED_BY = "migration";
const SOUNDLY_TEAM_NEW = "AM: Jill, Dev: Leslie, Dev: Josefina, PM: Jason";

// Section C — L1 existing updates (3 projects)
interface ProjectUpdateSpec {
  readonly prefix: string;
  readonly label: string;
  readonly fields: {
    readonly status?: string;
    readonly category?: string;
    readonly owner?: string;
    readonly resources?: string;
    readonly waitingOn?: string;
    readonly notes?: string;
  };
}
const PROJECT_UPDATE_SPECS: readonly ProjectUpdateSpec[] = [
  {
    prefix: "cf4d6575",
    label: "iFrame Provider Search",
    fields: {
      owner: "Jill",
      resources: "Dev: Leslie",
    },
  },
  {
    prefix: "8279d9eb",
    label: "Payment Gateway Page",
    fields: {
      owner: "Jill",
      resources: "Dev: Leslie",
    },
  },
  {
    prefix: "54d65143",
    label: "AARP Member Login + Landing Page",
    fields: {
      status: "in-production",
      resources: "Dev: Josefina",
      notes:
        "SOW signed and kicked off, in dev currently. Launch target 7/15 (confirm this week). HIGH PRIORITY: contractor bandwidth.",
    },
  },
] as const;

// Section D — L2 orphan rewires (3 items). Each maps to a target L1 prefix
// and a bundle of field updates. Field order on application mirrors
// Bonterra/Convergix: status → date → dayOfWeek → resources → owner → notes
// → weekOf → title. For Soundly, only subsets apply; see each spec.
interface WeekItemRewireSpec {
  readonly prefix: string;
  readonly expectedCurrentTitle: string;
  readonly expectedCurrentWeekOf: string;
  readonly targetParentPrefix: string;
  readonly fields: {
    readonly status?: string;
    readonly date?: string;
    readonly dayOfWeek?: string;
    readonly weekOf?: string;
    readonly owner?: string;
    readonly resources?: string;
    readonly notes?: string;
    readonly title?: string;
  };
}
const WEEK_ITEM_REWIRE_SPECS: readonly WeekItemRewireSpec[] = [
  {
    prefix: "9c3fc2bb",
    expectedCurrentTitle: "Soundly iFrame launch (evening)",
    expectedCurrentWeekOf: "2026-04-20",
    targetParentPrefix: "cf4d6575", // iFrame Provider Search
    fields: {
      resources: "Dev: Leslie",
      notes:
        "Waiting on client for feedback. Goes Live 4/22 (Risk: On UHG timeline)",
      title: "iFrame launch (evening)",
    },
  },
  {
    prefix: "a2cf483f",
    expectedCurrentTitle: "AARP API meeting",
    expectedCurrentWeekOf: "2026-04-06",
    targetParentPrefix: "54d65143", // AARP Member Login + Landing Page
    fields: {
      status: "completed",
      resources: "Dev: Josefina",
      notes: "AARP API meeting. Historical kickoff — SOW now signed.",
    },
  },
  {
    prefix: "a8580994",
    expectedCurrentTitle: "AARP Creative KO",
    expectedCurrentWeekOf: "2026-04-06",
    targetParentPrefix: "54d65143", // AARP Member Login + Landing Page
    fields: {
      status: "completed",
      resources: "CD: Lane",
      notes: "Creative kickoff. Historical — SOW now signed.",
    },
  },
] as const;

// Section E — L2 create (1 stub under Payment Gateway Page)
interface CreateWeekItemSpec {
  readonly parentPrefix: string; // existing L1 prefix
  readonly title: string;
  readonly date: string;
  readonly dayOfWeek: string;
  readonly weekOf: string;
  readonly category: string;
  readonly status?: string;
  readonly owner: string;
  readonly resources: string;
  readonly notes: string;
}
const CREATE_WEEK_ITEM_SPECS: readonly CreateWeekItemSpec[] = [
  {
    parentPrefix: "8279d9eb", // Payment Gateway Page
    title: "Payment Gateway Page — In Dev",
    date: "2026-04-23",
    dayOfWeek: "thursday",
    weekOf: "2026-04-20",
    category: "delivery",
    status: "in-progress",
    owner: "Jill",
    resources: "Dev: Leslie",
    notes: "Under signed $30K SOW, through May 2026.",
  },
] as const;

// ── Exports ──────────────────────────────────────────────

export const description =
  "Soundly cleanup 2026-04-20: update 3 L1s (owner/resources/status/notes), rewire 3 L2 orphans (2 flip to completed), create 1 L2 stub, update client team field.";

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("=== Soundly Cleanup 2026-04-20 ===");

  // Step 1 — Pre-checks
  const resolved = await preChecks(ctx);

  // Step 2 — Narrow pre-apply snapshot (written immediately before first write)
  await writeSnapshot(ctx, resolved);

  if (ctx.dryRun) {
    ctx.log("Dry-run: no writes will be performed. Operation plan follows.");
  }

  // ── Phase 1 — SKIP (no deletes) ──
  ctx.log("--- Phase 1: skip (no L1 deletes) ---");

  // ── Phase 2 — SKIP (no new parents) ──
  ctx.log("--- Phase 2: skip (no new L1 parents) ---");

  // ── Phase 3 — Update 3 existing L1s ──
  ctx.log("--- Phase 3: update 3 existing L1 projects ---");
  for (const spec of PROJECT_UPDATE_SPECS) {
    const project = resolved.projectsByPrefix.get(spec.prefix);
    if (!project) throw new Error(`Missing resolved project for prefix ${spec.prefix}`);
    await applyProjectFieldUpdates(ctx, spec, project);
  }

  // ── Phase 4 — Rewire 3 L2 week items (fields + link) ──
  ctx.log("--- Phase 4: rewire 3 L2 orphans ---");
  for (const spec of WEEK_ITEM_REWIRE_SPECS) {
    const row = resolved.rewireItemsByPrefix.get(spec.prefix);
    if (!row) throw new Error(`Missing resolved week item for prefix ${spec.prefix}`);
    await applyWeekItemFieldUpdates(ctx, spec, row);

    const targetProject = resolved.projectsByPrefix.get(spec.targetParentPrefix);
    if (!targetProject) {
      throw new Error(
        `Rewire target parent prefix '${spec.targetParentPrefix}' not resolved`
      );
    }
    ctx.log(`Link week item ${spec.prefix} → project ${targetProject.name} (${targetProject.id})`);
    if (!ctx.dryRun) {
      const result = await linkWeekItemToProject({
        weekItemId: row.id,
        projectId: targetProject.id,
        updatedBy: UPDATED_BY,
      });
      if (!result.ok) throw new Error(`Link ${spec.prefix} failed: ${result.error}`);
    }
  }

  // ── Phase 5 — Create 1 L2 stub ──
  ctx.log("--- Phase 5: create 1 L2 stub ---");
  for (const spec of CREATE_WEEK_ITEM_SPECS) {
    const parent = resolved.projectsByPrefix.get(spec.parentPrefix);
    if (!parent) {
      throw new Error(
        `Create week item '${spec.title}': parent prefix '${spec.parentPrefix}' not resolved`
      );
    }
    ctx.log(
      `Create week item: "${spec.title}" (${spec.date} ${spec.dayOfWeek}, weekOf=${spec.weekOf}, ${spec.category}${spec.status ? `/${spec.status}` : ""}, owner=${spec.owner}, resources=${spec.resources}) → project "${parent.name}"`
    );
    if (!ctx.dryRun) {
      const result = await createWeekItem({
        clientSlug: SOUNDLY_SLUG,
        projectName: parent.name,
        date: spec.date,
        dayOfWeek: spec.dayOfWeek,
        weekOf: spec.weekOf,
        title: spec.title,
        category: spec.category,
        status: spec.status,
        owner: spec.owner,
        resources: spec.resources,
        notes: spec.notes,
        updatedBy: UPDATED_BY,
      });
      if (!result.ok) throw new Error(`Create '${spec.title}' failed: ${result.error}`);
    }
  }

  // ── Phase 6 — Update client team field ──
  ctx.log(`--- Phase 6: update Soundly team → "${SOUNDLY_TEAM_NEW}" ---`);
  if (!ctx.dryRun) {
    const result = await updateClientField({
      clientSlug: SOUNDLY_SLUG,
      field: "team",
      newValue: SOUNDLY_TEAM_NEW,
      updatedBy: UPDATED_BY,
    });
    if (!result.ok) throw new Error(`Update client team failed: ${result.error}`);
  }

  // ── Phase 7 — Verification ──
  if (!ctx.dryRun) {
    await verify(ctx, resolved);
  }

  ctx.log("=== Soundly Cleanup complete ===");
}

// ── Pre-checks ───────────────────────────────────────────

interface ResolvedState {
  readonly soundly: typeof clients.$inferSelect;
  /** All resolved L1 projects keyed by 8-char prefix (3 total — all updates, also rewire targets and create parents). */
  readonly projectsByPrefix: Map<string, typeof projects.$inferSelect>;
  /** Week items to rewire in Phase 4. */
  readonly rewireItemsByPrefix: Map<string, typeof weekItems.$inferSelect>;
}

async function preChecks(ctx: MigrationContext): Promise<ResolvedState> {
  ctx.log("--- Pre-checks ---");

  // Resolve Soundly client
  const soundlyRows = await ctx.db
    .select()
    .from(clients)
    .where(eq(clients.slug, SOUNDLY_SLUG));
  const soundly = soundlyRows[0];
  if (!soundly) {
    throw new Error(`Pre-check failed: client '${SOUNDLY_SLUG}' not found.`);
  }
  if (soundly.id !== SOUNDLY_ID) {
    throw new Error(
      `Pre-check failed: Soundly ID mismatch (got ${soundly.id}, expected ${SOUNDLY_ID}).`
    );
  }

  // Resolve all L1 project prefixes (updates + rewire targets + create parents —
  // all subsets are the same 3 projects here).
  const projectsByPrefix = new Map<string, typeof projects.$inferSelect>();
  const allProjectPrefixes = new Set<string>();
  for (const spec of PROJECT_UPDATE_SPECS) allProjectPrefixes.add(spec.prefix);
  for (const spec of WEEK_ITEM_REWIRE_SPECS) allProjectPrefixes.add(spec.targetParentPrefix);
  for (const spec of CREATE_WEEK_ITEM_SPECS) allProjectPrefixes.add(spec.parentPrefix);

  for (const prefix of allProjectPrefixes) {
    const matches = await ctx.db
      .select()
      .from(projects)
      .where(and(eq(projects.clientId, soundly.id), like(projects.id, `${prefix}%`)));
    if (matches.length !== 1) {
      throw new Error(
        `Pre-check failed: project prefix '${prefix}' resolved to ${matches.length} rows (expected 1).`
      );
    }
    projectsByPrefix.set(prefix, matches[0]);
  }

  // Resolve all rewire week-item prefixes; assert orphan (projectId IS NULL)
  // and current title matches spec (defensive against silent drift).
  const rewireItemsByPrefix = new Map<string, typeof weekItems.$inferSelect>();

  for (const spec of WEEK_ITEM_REWIRE_SPECS) {
    const matches = await ctx.db
      .select()
      .from(weekItems)
      .where(and(eq(weekItems.clientId, soundly.id), like(weekItems.id, `${spec.prefix}%`)));
    if (matches.length !== 1) {
      throw new Error(
        `Pre-check failed: week-item prefix '${spec.prefix}' resolved to ${matches.length} rows (expected 1).`
      );
    }
    const row = matches[0];
    if (row.projectId !== null) {
      throw new Error(
        `Pre-check failed: rewire item ${spec.prefix} expected orphan (projectId null) but has projectId=${row.projectId}. Drift — abort.`
      );
    }
    if (row.title !== spec.expectedCurrentTitle) {
      throw new Error(
        `Pre-check failed: rewire item ${spec.prefix} current title is "${row.title}", expected "${spec.expectedCurrentTitle}".`
      );
    }
    if (row.weekOf !== spec.expectedCurrentWeekOf) {
      throw new Error(
        `Pre-check failed: rewire item ${spec.prefix} current weekOf is "${row.weekOf}", expected "${spec.expectedCurrentWeekOf}".`
      );
    }
    rewireItemsByPrefix.set(spec.prefix, row);
  }

  ctx.log(
    `Pre-checks passed. soundly=${soundly.id}, ${projectsByPrefix.size} projects resolved, ${rewireItemsByPrefix.size} rewire items.`
  );

  return {
    soundly,
    projectsByPrefix,
    rewireItemsByPrefix,
  };
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
    client: r.soundly,
    projectsToUpdate: PROJECT_UPDATE_SPECS.map((s) => r.projectsByPrefix.get(s.prefix)).filter(
      Boolean
    ),
    weekItemsToRewire: Array.from(r.rewireItemsByPrefix.values()),
    newWeekItemsPlanned: CREATE_WEEK_ITEM_SPECS.map((s) => ({
      title: s.title,
      date: s.date,
      dayOfWeek: s.dayOfWeek,
      weekOf: s.weekOf,
      category: s.category,
      status: s.status ?? null,
      owner: s.owner,
      resources: s.resources,
      notes: s.notes,
      parentPrefix: s.parentPrefix,
      parentName: r.projectsByPrefix.get(s.parentPrefix)?.name ?? null,
    })),
    clientTeamPlanned: SOUNDLY_TEAM_NEW,
  };

  const suffix = ctx.dryRun ? "-dryrun" : "";
  const outPath = resolvePath(
    process.cwd(),
    `docs/tmp/soundly-pre-apply-snapshot${suffix}.json`
  );
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2), "utf8");
  ctx.log(`Wrote pre-apply snapshot → ${outPath}`);
}

// ── Project field updates (Phase 3) ────────────────────

async function applyProjectFieldUpdates(
  ctx: MigrationContext,
  spec: ProjectUpdateSpec,
  project: typeof projects.$inferSelect
): Promise<void> {
  const f = spec.fields;

  // status via updateProjectStatus (cascade-aware). Target values for this
  // migration are never in CASCADE_STATUSES (only "in-production" is set), so
  // no cascade fires; safe either way.
  if (f.status !== undefined && f.status !== project.status) {
    ctx.log(
      `Project ${spec.prefix} (${project.name}): status "${project.status}" → "${f.status}"`
    );
    if (!ctx.dryRun) {
      const result = await updateProjectStatus({
        clientSlug: SOUNDLY_SLUG,
        projectName: project.name,
        newStatus: f.status,
        updatedBy: UPDATED_BY,
      });
      if (!result.ok) {
        throw new Error(`Update status ${project.name} failed: ${result.error}`);
      }
    }
  }
  if (f.category !== undefined && f.category !== project.category) {
    await writeProjectField(ctx, project.name, "category", f.category);
  }
  if (f.owner !== undefined && f.owner !== project.owner) {
    await writeProjectField(ctx, project.name, "owner", f.owner);
  }
  if (f.resources !== undefined && f.resources !== project.resources) {
    await writeProjectField(ctx, project.name, "resources", f.resources);
  }
  if (f.waitingOn !== undefined && f.waitingOn !== project.waitingOn) {
    await writeProjectField(ctx, project.name, "waitingOn", f.waitingOn);
  }
  if (f.notes !== undefined && f.notes !== project.notes) {
    await writeProjectField(ctx, project.name, "notes", f.notes);
  }
}

async function writeProjectField(
  ctx: MigrationContext,
  projectName: string,
  field: string,
  newValue: string
): Promise<void> {
  ctx.log(`Project '${projectName}' ${field} → "${newValue}"`);
  if (ctx.dryRun) return;
  const result = await updateProjectField({
    clientSlug: SOUNDLY_SLUG,
    projectName,
    field,
    newValue,
    updatedBy: UPDATED_BY,
  });
  if (!result.ok) {
    throw new Error(`Update ${projectName}.${field} failed: ${result.error}`);
  }
}

// ── Week-item field updates (Phase 4) ───────────────────

async function applyWeekItemFieldUpdates(
  ctx: MigrationContext,
  spec: WeekItemRewireSpec,
  row: typeof weekItems.$inferSelect
): Promise<void> {
  // Mirror Bonterra/Convergix: track currentWeekOf/currentTitle as the fuzzy
  // lookup key for updateWeekItemField. Mutation order matters because the
  // lookup key is (weekOf, title) — mutate title LAST, weekOf BEFORE title.
  let currentWeekOf = row.weekOf;
  let currentTitle = row.title;
  const fields = spec.fields;

  // status → date → dayOfWeek → resources → owner → notes → weekOf → title
  if (fields.status !== undefined) {
    await writeWeekItemField(ctx, spec.prefix, currentWeekOf, currentTitle, "status", fields.status);
  }
  if (fields.date !== undefined) {
    await writeWeekItemField(ctx, spec.prefix, currentWeekOf, currentTitle, "date", fields.date);
  }
  if (fields.dayOfWeek !== undefined) {
    await writeWeekItemField(
      ctx,
      spec.prefix,
      currentWeekOf,
      currentTitle,
      "dayOfWeek",
      fields.dayOfWeek
    );
  }
  if (fields.resources !== undefined) {
    await writeWeekItemField(
      ctx,
      spec.prefix,
      currentWeekOf,
      currentTitle,
      "resources",
      fields.resources
    );
  }
  if (fields.owner !== undefined) {
    await writeWeekItemField(ctx, spec.prefix, currentWeekOf, currentTitle, "owner", fields.owner);
  }
  if (fields.notes !== undefined) {
    await writeWeekItemField(ctx, spec.prefix, currentWeekOf, currentTitle, "notes", fields.notes);
  }

  // weekOf BEFORE title (lookup key uses weekOf)
  if (fields.weekOf !== undefined && fields.weekOf !== currentWeekOf) {
    await writeWeekItemField(
      ctx,
      spec.prefix,
      currentWeekOf,
      currentTitle,
      "weekOf",
      fields.weekOf
    );
    currentWeekOf = fields.weekOf;
  }

  if (fields.title !== undefined && fields.title !== currentTitle) {
    await writeWeekItemField(ctx, spec.prefix, currentWeekOf, currentTitle, "title", fields.title);
    currentTitle = fields.title;
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

// ── Verification ─────────────────────────────────────────

async function verify(ctx: MigrationContext, r: ResolvedState): Promise<void> {
  ctx.log("--- Verification ---");

  // 1. Strict orphan invariant: projectId IS NULL AND status != 'completed'
  //    AND clientId = Soundly → 0.
  const strictOrphans = await ctx.db
    .select({ id: weekItems.id, title: weekItems.title, status: weekItems.status })
    .from(weekItems)
    .where(
      and(
        eq(weekItems.clientId, r.soundly.id),
        isNull(weekItems.projectId),
        ne(weekItems.status, "completed")
      )
    );
  ctx.log(
    `Strict orphans (projectId null, status != completed): ${strictOrphans.length} (expected 0)`
  );
  if (strictOrphans.length !== 0) {
    throw new Error(
      `VERIFICATION FAILED: expected 0 non-completed orphans, got ${strictOrphans.length}: ${strictOrphans
        .map((o) => `${o.id.slice(0, 8)} (${o.title}, status=${o.status})`)
        .join("; ")}.`
    );
  }

  // 2. Loose orphan count (informational + strict assertion: all 3 orphans rewired).
  const looseOrphans = await ctx.db
    .select({ id: weekItems.id })
    .from(weekItems)
    .where(and(eq(weekItems.clientId, r.soundly.id), isNull(weekItems.projectId)));
  if (looseOrphans.length !== 0) {
    throw new Error(
      `VERIFICATION FAILED: expected 0 loose orphans, got ${looseOrphans.length}. All 3 orphans should be rewired.`
    );
  }
  ctx.log(`Loose orphans: 0 (expected 0 — all 3 rewired).`);

  // 3. Per-L1 linked-item count invariants.
  const expectedLinkedCounts: Record<string, number> = {
    cf4d6575: 1, // iFrame Provider Search (rewired 9c3fc2bb)
    "8279d9eb": 1, // Payment Gateway Page (new stub)
    "54d65143": 2, // AARP (rewired a2cf483f + a8580994)
  };
  for (const [prefix, expected] of Object.entries(expectedLinkedCounts)) {
    const project = r.projectsByPrefix.get(prefix);
    if (!project) throw new Error(`VERIFICATION FAILED: project ${prefix} missing from map.`);
    const items = await ctx.db
      .select({ id: weekItems.id })
      .from(weekItems)
      .where(eq(weekItems.projectId, project.id));
    if (items.length !== expected) {
      throw new Error(
        `VERIFICATION FAILED: project ${prefix} (${project.name}) expected ${expected} linked week items, got ${items.length}.`
      );
    }
  }
  ctx.log(`Per-L1 linked counts verified.`);

  // 4. L1 field assertions (owner, resources, status).
  const expectedL1Fields: Record<string, { owner: string; resources: string; status: string }> = {
    cf4d6575: { owner: "Jill", resources: "Dev: Leslie", status: "in-production" },
    "8279d9eb": { owner: "Jill", resources: "Dev: Leslie", status: "in-production" },
    "54d65143": { owner: "Jill", resources: "Dev: Josefina", status: "in-production" },
  };
  for (const [prefix, expected] of Object.entries(expectedL1Fields)) {
    const rows = await ctx.db
      .select()
      .from(projects)
      .where(and(eq(projects.clientId, r.soundly.id), like(projects.id, `${prefix}%`)));
    if (rows.length !== 1) {
      throw new Error(`VERIFICATION FAILED: L1 ${prefix} resolved to ${rows.length} rows.`);
    }
    const p = rows[0];
    if (p.owner !== expected.owner) {
      throw new Error(
        `VERIFICATION FAILED: L1 ${prefix} owner="${p.owner}", expected "${expected.owner}".`
      );
    }
    if (p.resources !== expected.resources) {
      throw new Error(
        `VERIFICATION FAILED: L1 ${prefix} resources="${p.resources}", expected "${expected.resources}".`
      );
    }
    if (p.status !== expected.status) {
      throw new Error(
        `VERIFICATION FAILED: L1 ${prefix} status="${p.status}", expected "${expected.status}".`
      );
    }
  }
  // AARP notes must contain "SOW signed and kicked off"
  const aarpRows = await ctx.db
    .select()
    .from(projects)
    .where(and(eq(projects.clientId, r.soundly.id), like(projects.id, `54d65143%`)));
  const aarpNotes = aarpRows[0]?.notes ?? "";
  if (!aarpNotes.includes("SOW signed and kicked off")) {
    throw new Error(
      `VERIFICATION FAILED: AARP L1 notes missing expected substring. Got: "${aarpNotes}".`
    );
  }
  ctx.log(`L1 field assertions verified.`);

  // 5. Rewire assertions.
  for (const spec of WEEK_ITEM_REWIRE_SPECS) {
    const targetProject = r.projectsByPrefix.get(spec.targetParentPrefix);
    if (!targetProject) {
      throw new Error(
        `VERIFICATION FAILED: rewire target ${spec.targetParentPrefix} missing from map.`
      );
    }
    const rows = await ctx.db
      .select()
      .from(weekItems)
      .where(and(eq(weekItems.clientId, r.soundly.id), like(weekItems.id, `${spec.prefix}%`)));
    if (rows.length !== 1) {
      throw new Error(`VERIFICATION FAILED: rewire ${spec.prefix} resolved to ${rows.length} rows.`);
    }
    const item = rows[0];
    if (item.projectId !== targetProject.id) {
      throw new Error(
        `VERIFICATION FAILED: rewire ${spec.prefix} projectId="${item.projectId}", expected "${targetProject.id}".`
      );
    }
    if (spec.fields.status !== undefined && item.status !== spec.fields.status) {
      throw new Error(
        `VERIFICATION FAILED: rewire ${spec.prefix} status="${item.status}", expected "${spec.fields.status}".`
      );
    }
    if (spec.fields.resources !== undefined && item.resources !== spec.fields.resources) {
      throw new Error(
        `VERIFICATION FAILED: rewire ${spec.prefix} resources="${item.resources}", expected "${spec.fields.resources}".`
      );
    }
    if (spec.fields.title !== undefined && item.title !== spec.fields.title) {
      throw new Error(
        `VERIFICATION FAILED: rewire ${spec.prefix} title="${item.title}", expected "${spec.fields.title}".`
      );
    }
    if (spec.fields.notes !== undefined && item.notes !== spec.fields.notes) {
      throw new Error(
        `VERIFICATION FAILED: rewire ${spec.prefix} notes="${item.notes}", expected "${spec.fields.notes}".`
      );
    }
  }
  ctx.log(`All ${WEEK_ITEM_REWIRE_SPECS.length} rewires verified.`);

  // 6. New week-item assertion.
  for (const spec of CREATE_WEEK_ITEM_SPECS) {
    const parent = r.projectsByPrefix.get(spec.parentPrefix);
    if (!parent) throw new Error(`VERIFICATION FAILED: parent ${spec.parentPrefix} missing.`);
    const rows = await ctx.db
      .select()
      .from(weekItems)
      .where(
        and(
          eq(weekItems.clientId, r.soundly.id),
          eq(weekItems.projectId, parent.id),
          eq(weekItems.title, spec.title)
        )
      );
    if (rows.length !== 1) {
      throw new Error(
        `VERIFICATION FAILED: new week item "${spec.title}" under ${parent.name} resolved to ${rows.length} rows.`
      );
    }
    const item = rows[0];
    if (item.weekOf !== spec.weekOf) {
      throw new Error(
        `VERIFICATION FAILED: new week item "${spec.title}" weekOf="${item.weekOf}", expected "${spec.weekOf}".`
      );
    }
    if (spec.status !== undefined && item.status !== spec.status) {
      throw new Error(
        `VERIFICATION FAILED: new week item "${spec.title}" status="${item.status}", expected "${spec.status}".`
      );
    }
  }
  ctx.log(`New week item verified.`);

  // 7. Client team field.
  const clientRows = await ctx.db.select().from(clients).where(eq(clients.id, r.soundly.id));
  const client = clientRows[0];
  if (client.team !== SOUNDLY_TEAM_NEW) {
    throw new Error(
      `VERIFICATION FAILED: Soundly team="${client.team}", expected "${SOUNDLY_TEAM_NEW}".`
    );
  }
  ctx.log(`Client team field verified.`);

  // 8. Project count invariant: preflight=3, unchanged → 3.
  const allProjects = await ctx.db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.clientId, r.soundly.id));
  if (allProjects.length !== 3) {
    throw new Error(
      `VERIFICATION FAILED: expected 3 projects (preflight unchanged), got ${allProjects.length}.`
    );
  }
  ctx.log(`Total projects: ${allProjects.length} (expected 3).`);

  // 9. Week-item count invariant: preflight=3, +1 new → 4.
  const allItems = await ctx.db
    .select({ id: weekItems.id })
    .from(weekItems)
    .where(eq(weekItems.clientId, r.soundly.id));
  const expectedItemCount = 3 + CREATE_WEEK_ITEM_SPECS.length;
  if (allItems.length !== expectedItemCount) {
    throw new Error(
      `VERIFICATION FAILED: expected ${expectedItemCount} week items (3 preflight + ${CREATE_WEEK_ITEM_SPECS.length} new), got ${allItems.length}.`
    );
  }
  ctx.log(`Total week items: ${allItems.length} (expected ${expectedItemCount}).`);

  ctx.log("Verification passed.");
}
