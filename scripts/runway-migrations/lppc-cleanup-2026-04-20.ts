/**
 * Migration: LPPC Data Cleanup — 2026-04-20
 *
 * Sixth client cleanup using the shared-project model (after Bonterra, Convergix,
 * TAP, Soundly, HDL).
 *
 * Shape: Variant A (phase-projects exist → delete FIRST to avoid fuzzy-match
 * collision between 4 `Website Refresh — …` rows and new `Website Revamp` parent).
 *
 * Ops:
 *   - 4 L1 deletes (Website Refresh phase-rows: Homepage + Private Use,
 *     Permitting Reform, FEMA, Launch) — preflight confirms 0 children each
 *   - 1 L1 create (new parent: Website Revamp) — capture ID via fuzzy re-query
 *   - 6 L1 existing updates (Interactive Map, Year End Report→rename,
 *     Spring CEO Meeting Invite, Additional Website Posts→rename, MyLPPC
 *     Training Video, Mailchimp Invites). 2 renames: ba2fb938 → "2025 Year
 *     End Report"; 35a75784 → "Website Blog Posts"
 *   - 3 L2 orphan rewires (all currently projectId=null). Includes SPLIT
 *     handling for 671f2c69 "LPPC Map + Website Launch" — the orphan rewires
 *     to Interactive Map as "Interactive Map Launch" (4/27); the Website-side
 *     launch (5/11) is created as a new item in Phase 5 under Website Revamp
 *   - 10 L2 creates (7 under Website Revamp, 1 under Interactive Map,
 *     1 under Website Blog Posts, 1 under MyLPPC Training Video)
 *   - 1 client team field update ("Copy:" → "CW:")
 *
 * Operation order (pinned, Variant A):
 *   pre-checks → narrow pre-apply snapshot → 4 L1 deletes → 1 L1 create
 *   (capture new ID) → 6 L1 existing updates (write-only-if-different) →
 *   3 L2 rewires (fields then link) → 10 L2 creates → client team update
 *   → verification.
 *
 * Write-only-if-different: mirrors Bonterra/Convergix — owner/name/etc. skipped
 * when current value already equals target. Cleaner audit trail than TAP's
 * always-write pattern.
 *
 * Null-write handling: `resources → null` specified for `ba2fb938` and
 * `61cb4158`. Both already null per preflight → skip-and-log. If preflight
 * drifted and current value is non-null, fall back to raw UPDATE + hand-written
 * audit record.
 */
import { writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { and, eq, isNull, like, ne } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { clients, projects, weekItems, updates } from "@/lib/db/runway-schema";
import {
  addProject,
  createWeekItem,
  deleteProject,
  findProjectByFuzzyName,
  generateId,
  generateIdempotencyKey,
  getBatchId,
  linkWeekItemToProject,
  updateClientField,
  updateProjectField,
  updateProjectStatus,
  updateWeekItemField,
} from "@/lib/runway/operations";

// ── Constants ────────────────────────────────────────────

const LPPC_SLUG = "lppc";
const LPPC_ID = "d27916a0809747f99fe9a8157";
const UPDATED_BY = "migration";
const LPPC_TEAM_NEW = "CD: Lane, CW: Kathy, Dev: Leslie, PM: Jason";
const NEW_PARENT_NAME = "Website Revamp";

// Section A — L1 deletes (4 Website Refresh phase-rows, all with 0 children per preflight)
interface DeleteSpec {
  readonly prefix: string;
  readonly name: string;
}
const DELETE_SPECS: readonly DeleteSpec[] = [
  { prefix: "de70ced3", name: "Website Refresh — Homepage + Private Use" },
  { prefix: "b957e8f9", name: "Website Refresh — Permitting Reform" },
  { prefix: "ef8e33db", name: "Website Refresh — FEMA" },
  { prefix: "554ef7e7", name: "Website Refresh — Launch" },
] as const;

// Section B — L1 create (1 new consolidated parent)
interface CreateSpec {
  readonly name: string;
  readonly status: string;
  readonly category: string;
  readonly owner: string;
  readonly resources?: string;
  readonly waitingOn?: string;
  readonly notes: string;
}
const CREATE_SPECS: readonly CreateSpec[] = [
  {
    name: NEW_PARENT_NAME,
    status: "in-production",
    category: "active",
    owner: "Kathy",
    resources: "CD: Lane, Dev: Leslie",
    notes:
      "Full website revamp for LPPC. R1 presented 4/3, R2 client-approved 4/14, R3 Review due Mon 4/20 (Leadership, Public Power, Advocacy — Lane behind per 4/19 transcript check). Dev KO 4/20, Pencils Down 4/23, Staging 5/4, Launch 5/11. Stakeholders: Bill/Matt. Scope includes Permitting Reform + FEMA content tracks. Client-approved R2 4/14.",
  },
] as const;

// Section C — L1 existing updates (6 projects)
// `targetName` is the post-update name (used by subsequent writes after rename).
// `nullableFields` lists fields whose intended target value is null — for those
// we skip-or-null-fallback rather than calling updateProjectField (which can't
// express NULL).
interface ProjectUpdateSpec {
  readonly prefix: string;
  readonly currentName: string;
  readonly targetName: string; // == currentName when no rename
  readonly fields: {
    readonly status?: string;
    readonly category?: string;
    readonly owner?: string;
    readonly resources?: string;
    readonly waitingOn?: string;
    readonly notes?: string;
  };
  readonly nullableFields?: readonly ("resources" | "waitingOn")[];
}
const PROJECT_UPDATE_SPECS: readonly ProjectUpdateSpec[] = [
  {
    prefix: "d7d7cc2f",
    currentName: "Interactive Map",
    targetName: "Interactive Map",
    fields: {
      owner: "Kathy",
      resources: "CD: Lane, Dev: Leslie",
      notes:
        "LPPC Interactive Map landing page. R2 feedback implemented. Staging link due 4/17 (slipped), LPPC Feedback 4/21, QA 4/21-4/23, **Launch 4/27**. Stakeholders: Bill/Matt.",
    },
  },
  {
    prefix: "ba2fb938",
    currentName: "Year End Report",
    targetName: "2025 Year End Report", // TP decision Q1: rename
    fields: {
      owner: "Kathy",
      notes: "Final asset delivered 2/23. Charged for printing.",
    },
    nullableFields: ["resources"],
  },
  {
    prefix: "61cb4158",
    currentName: "Spring CEO Meeting Invite",
    targetName: "Spring CEO Meeting Invite",
    fields: {
      owner: "Kathy",
      notes: "Email design + MailChimp build. Sent.",
    },
    nullableFields: ["resources"],
  },
  {
    prefix: "35a75784",
    currentName: "Additional Website Posts",
    targetName: "Website Blog Posts", // explicit rename
    fields: {
      owner: "Kathy",
      notes:
        "Pending additional website content from LPPC. Hours redirected from YER. No timeline. Stakeholders: Bill/Kate.",
    },
  },
  {
    prefix: "09ce8dd9",
    currentName: "MyLPPC Training Video",
    targetName: "MyLPPC Training Video",
    fields: {
      owner: "Kathy",
      notes: "Blocked on PDF guide update from LPPC.",
    },
  },
  {
    prefix: "dfbf69a7",
    currentName: "Mailchimp Invites (Spring + Fall)",
    targetName: "Mailchimp Invites (Spring + Fall)",
    fields: {
      owner: "Kathy",
      notes: "Spring invite was completed separately. Fall pending.",
    },
  },
] as const;

// Section D — L2 orphan rewires (3 items). Each rewires to either the new
// Website Revamp parent (sentinel "__NEW_PARENT__") or an existing L1 prefix.
const NEW_PARENT_SENTINEL = "__NEW_PARENT__";

interface WeekItemRewireSpec {
  readonly prefix: string;
  readonly expectedCurrentTitle: string;
  readonly expectedCurrentWeekOf: string;
  /** Either NEW_PARENT_SENTINEL or an 8-char prefix of an existing L1 project. */
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
    prefix: "b14e428b",
    expectedCurrentTitle: "LPPC copy expected (Permitting + FEMA)",
    expectedCurrentWeekOf: "2026-04-06",
    targetParentPrefix: NEW_PARENT_SENTINEL,
    fields: {
      status: "completed",
      resources: "CD: Lane, Dev: Leslie",
      notes:
        "Client copy for Permitting + FEMA content tracks received. Design + dev unblocked.",
      title: "Copy Delivered (Permitting + FEMA)",
    },
  },
  {
    prefix: "6cdf2724",
    expectedCurrentTitle: "LPPC Map R2",
    expectedCurrentWeekOf: "2026-04-13",
    targetParentPrefix: "d7d7cc2f", // Interactive Map
    fields: {
      status: "completed",
      resources: "CD: Lane, Dev: Leslie",
      notes: "R2 presented 4/14. Minor feedback implemented.",
      title: "Interactive Map R2 Review",
    },
  },
  {
    prefix: "671f2c69",
    expectedCurrentTitle: "LPPC Map + Website Launch",
    expectedCurrentWeekOf: "2026-05-04",
    targetParentPrefix: "d7d7cc2f", // Interactive Map (Map-side of the split)
    fields: {
      status: "blocked",
      date: "2026-04-27",
      // dayOfWeek stays "monday" (4/27 is Monday) — skip write (write-only-if-different)
      weekOf: "2026-04-27",
      resources: "Dev: Leslie",
      notes:
        "Per hot sheet schedule: QA 4/21-4/23, launch 4/27. Map launches ahead of website (5/11).",
      title: "Interactive Map Launch",
    },
  },
] as const;

// Section E — L2 creates (10 items). Parent reference is either by
// { kind: "new", name } (resolves to newParentId captured in Phase 2) or
// { kind: "existing", prefix } (resolves via PROJECT_UPDATE_SPECS targetName).
interface CreateWeekItemSpec {
  readonly parentRef:
    | { readonly kind: "existing"; readonly prefix: string }
    | { readonly kind: "new"; readonly name: string };
  readonly title: string;
  readonly date: string;
  readonly dayOfWeek: string;
  readonly weekOf: string; // computed Monday-of-week
  readonly category: string;
  readonly status?: string;
  readonly owner: string;
  readonly resources?: string; // null expressed as undefined (createWeekItem handles undefined → null)
  readonly notes: string;
}
const CREATE_WEEK_ITEM_SPECS: readonly CreateWeekItemSpec[] = [
  // 7 under new Website Revamp parent
  {
    parentRef: { kind: "new", name: NEW_PARENT_NAME },
    title: "R3 Design Review",
    date: "2026-04-20",
    dayOfWeek: "monday",
    weekOf: "2026-04-20",
    category: "review",
    status: "in-progress",
    owner: "Kathy",
    resources: "CD: Lane",
    notes:
      "3 pages: Leadership, Public Power, Advocacy. Lane behind per Kathy 4/19 Figma check — risk to schedule.",
  },
  {
    parentRef: { kind: "new", name: NEW_PARENT_NAME },
    title: "Development Kickoff",
    date: "2026-04-20",
    dayOfWeek: "monday",
    weekOf: "2026-04-20",
    category: "kickoff",
    status: "in-progress",
    owner: "Kathy",
    resources: "Dev: Leslie",
    notes: "Dev kickoff per hot sheet schedule.",
  },
  {
    parentRef: { kind: "new", name: NEW_PARENT_NAME },
    title: "Pencils Down + Images Due",
    date: "2026-04-23",
    dayOfWeek: "thursday",
    weekOf: "2026-04-20",
    category: "deadline",
    status: "blocked",
    owner: "Kathy",
    resources: "CD: Lane",
    notes: "Per hot sheet schedule.",
  },
  {
    parentRef: { kind: "new", name: NEW_PARENT_NAME },
    title: "Staging Links Due",
    date: "2026-05-04",
    dayOfWeek: "monday",
    weekOf: "2026-05-04",
    category: "deadline",
    status: "blocked",
    owner: "Kathy",
    resources: "Dev: Leslie",
    notes: "Per hot sheet schedule.",
  },
  {
    parentRef: { kind: "new", name: NEW_PARENT_NAME },
    title: "LPPC Staging Feedback Due",
    date: "2026-05-06",
    dayOfWeek: "wednesday",
    weekOf: "2026-05-04",
    category: "approval",
    status: "blocked",
    owner: "Kathy",
    // resources: null
    notes: "Per hot sheet schedule.",
  },
  {
    parentRef: { kind: "new", name: NEW_PARENT_NAME },
    title: "QA Phase",
    date: "2026-05-07",
    dayOfWeek: "thursday",
    weekOf: "2026-05-04",
    category: "review",
    status: "blocked",
    owner: "Kathy",
    resources: "Dev: Leslie",
    notes: "Thu-Fri 5/7-5/8 QA.",
  },
  {
    parentRef: { kind: "new", name: NEW_PARENT_NAME },
    title: "Website Launch",
    date: "2026-05-11",
    dayOfWeek: "monday",
    weekOf: "2026-05-11",
    category: "launch",
    status: "blocked",
    owner: "Kathy",
    resources: "Dev: Leslie",
    notes: "Website revamp launch.",
  },
  // 1 under d7d7cc2f Interactive Map
  {
    parentRef: { kind: "existing", prefix: "d7d7cc2f" },
    title: "Map Client Clarity Ping",
    date: "2026-04-21",
    dayOfWeek: "tuesday",
    weekOf: "2026-04-20",
    category: "approval",
    status: "blocked",
    owner: "Kathy",
    resources: "CW: Kathy",
    notes:
      "Kathy had questions on one area of map, needs clarity from client per 4/19 transcript. LPPC Feedback Due 4/21 per hot sheet.",
  },
  // 1 under 35a75784 Website Blog Posts (post-rename)
  {
    parentRef: { kind: "existing", prefix: "35a75784" },
    title: "Website Blog Posts — Awaiting LPPC Content",
    date: "2026-04-30",
    dayOfWeek: "thursday",
    weekOf: "2026-04-27",
    category: "kickoff",
    status: "blocked",
    owner: "Kathy",
    // resources: null
    notes: "Pending additional website content from LPPC. No timeline.",
  },
  // 1 under 09ce8dd9 MyLPPC Training Video
  {
    parentRef: { kind: "existing", prefix: "09ce8dd9" },
    title: "MyLPPC Training Video — Awaiting PDF Guide",
    date: "2026-04-30",
    dayOfWeek: "thursday",
    weekOf: "2026-04-27",
    category: "kickoff",
    status: "blocked",
    owner: "Kathy",
    resources: "Dev: Leslie",
    notes: "Blocked on PDF guide update from LPPC.",
  },
] as const;

// ── Exports ──────────────────────────────────────────────

export const description =
  "LPPC cleanup 2026-04-20: delete 4 Website Refresh phase-rows, create Website Revamp parent, update 6 existing L1s (2 renames), rewire 3 orphans (split Map+Website Launch), create 10 new L2s, update client team (Copy → CW).";

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("=== LPPC Cleanup 2026-04-20 ===");

  // Step 1 — Pre-checks
  const resolved = await preChecks(ctx);

  // Step 2 — Narrow pre-apply snapshot (written immediately before first write)
  await writeSnapshot(ctx, resolved);

  if (ctx.dryRun) {
    ctx.log("Dry-run: no writes will be performed. Operation plan follows.");
  }

  // ── Phase 1 — Delete 4 L1 Website Refresh phase-rows ──
  ctx.log("--- Phase 1: delete 4 L1 Website Refresh phase-projects ---");
  for (const spec of DELETE_SPECS) {
    ctx.log(`Delete project: LPPC / ${spec.name} (prefix=${spec.prefix})`);
    if (!ctx.dryRun) {
      const result = await deleteProject({
        clientSlug: LPPC_SLUG,
        projectName: spec.name,
        updatedBy: UPDATED_BY,
      });
      if (!result.ok) throw new Error(`Delete ${spec.name} failed: ${result.error}`);
    }
  }

  // ── Phase 2 — Create 1 new parent; capture ID ──
  ctx.log("--- Phase 2: create new L1 parent 'Website Revamp' ---");
  const newParentIdByName = new Map<string, string>();
  for (const spec of CREATE_SPECS) {
    ctx.log(
      `Create project: LPPC / ${spec.name} (status=${spec.status}, category=${spec.category}, owner=${spec.owner}, resources=${spec.resources ?? "null"})`
    );
    if (!ctx.dryRun) {
      const result = await addProject({
        clientSlug: LPPC_SLUG,
        name: spec.name,
        status: spec.status,
        category: spec.category,
        owner: spec.owner,
        resources: spec.resources,
        waitingOn: spec.waitingOn,
        notes: spec.notes,
        updatedBy: UPDATED_BY,
      });
      if (!result.ok) throw new Error(`Create ${spec.name} failed: ${result.error}`);
      const created = await findProjectByFuzzyName(LPPC_ID, spec.name);
      if (!created) throw new Error(`New parent '${spec.name}' not found after create.`);
      newParentIdByName.set(spec.name, created.id);
      ctx.log(`  → new parent id: ${created.id}`);
    }
  }

  // Sanity check: each new parent resolves unambiguously via fuzzy match
  if (!ctx.dryRun) {
    for (const spec of CREATE_SPECS) {
      if (!newParentIdByName.has(spec.name)) {
        throw new Error(`Pre-Phase-3 sanity check: '${spec.name}' not captured.`);
      }
    }
  }

  // ── Phase 3 — Update 6 existing L1 projects (write-only-if-different) ──
  ctx.log("--- Phase 3: update 6 existing L1 projects ---");
  for (const spec of PROJECT_UPDATE_SPECS) {
    const project = resolved.projectUpdatesByPrefix.get(spec.prefix);
    if (!project) throw new Error(`Missing resolved project for prefix ${spec.prefix}`);
    await applyProjectFieldUpdates(ctx, spec, project);
  }

  // ── Phase 4 — Rewire 3 L2 orphans (fields then link) ──
  ctx.log("--- Phase 4: rewire 3 L2 orphan week items ---");
  for (const spec of WEEK_ITEM_REWIRE_SPECS) {
    const row = resolved.rewireItemsByPrefix.get(spec.prefix);
    if (!row) throw new Error(`Missing resolved week item for prefix ${spec.prefix}`);
    await applyWeekItemFieldUpdates(ctx, spec, row);

    // Resolve target parent ID
    let targetProjectId: string;
    let targetProjectName: string;
    if (spec.targetParentPrefix === NEW_PARENT_SENTINEL) {
      const id = newParentIdByName.get(NEW_PARENT_NAME);
      if (ctx.dryRun) {
        targetProjectId = "(pending — new parent will be created on apply)";
        targetProjectName = NEW_PARENT_NAME;
      } else {
        if (!id) throw new Error("New parent ID not captured for rewire target");
        targetProjectId = id;
        targetProjectName = NEW_PARENT_NAME;
      }
    } else {
      const targetProject = resolved.projectsByPrefix.get(spec.targetParentPrefix);
      if (!targetProject) {
        throw new Error(
          `Rewire target parent prefix '${spec.targetParentPrefix}' not resolved`
        );
      }
      targetProjectId = targetProject.id;
      targetProjectName = targetProject.name;
    }
    ctx.log(`Link week item ${spec.prefix} → project ${targetProjectName} (${targetProjectId})`);
    if (!ctx.dryRun) {
      const result = await linkWeekItemToProject({
        weekItemId: row.id,
        projectId: targetProjectId,
        updatedBy: UPDATED_BY,
      });
      if (!result.ok) throw new Error(`Link ${spec.prefix} failed: ${result.error}`);
    }
  }

  // Sanity check: fuzzy-match for new parent + for Website Blog Posts (renamed)
  // resolve to captured ID / correct row before Phase 5 createWeekItem.
  if (!ctx.dryRun) {
    for (const spec of CREATE_SPECS) {
      const expected = newParentIdByName.get(spec.name);
      const resolvedParent = await findProjectByFuzzyName(LPPC_ID, spec.name);
      if (!resolvedParent || resolvedParent.id !== expected) {
        throw new Error(
          `Fuzzy-match sanity check failed: '${spec.name}' resolved to ${resolvedParent?.id ?? "(nothing)"}; expected ${expected}.`
        );
      }
    }
    // Also verify the renamed "Website Blog Posts" resolves to the 35a75784 row
    const blog = await findProjectByFuzzyName(LPPC_ID, "Website Blog Posts");
    const blogRow = resolved.projectsByPrefix.get("35a75784");
    if (!blog || !blogRow || blog.id !== blogRow.id) {
      throw new Error(
        `Fuzzy-match sanity check failed: 'Website Blog Posts' resolved to ${blog?.id ?? "(nothing)"}; expected ${blogRow?.id ?? "(nothing)"}.`
      );
    }
  }

  // ── Phase 5 — Create 10 new L2 week items ──
  ctx.log("--- Phase 5: create 10 new L2 week items ---");
  for (const spec of CREATE_WEEK_ITEM_SPECS) {
    let projectName: string;
    if (spec.parentRef.kind === "existing") {
      const parentPrefix = spec.parentRef.prefix;
      const parent = resolved.projectsByPrefix.get(parentPrefix);
      if (!parent) {
        throw new Error(
          `Create week item '${spec.title}': parent prefix '${parentPrefix}' not resolved`
        );
      }
      // For renamed projects (e.g. 35a75784 → "Website Blog Posts"), use the
      // NEW (post-rename) name so fuzzy-match resolves cleanly in Phase 5.
      const updateSpec = PROJECT_UPDATE_SPECS.find((u) => u.prefix === parentPrefix);
      projectName = updateSpec ? updateSpec.targetName : parent.name;
    } else {
      projectName = spec.parentRef.name;
    }
    ctx.log(
      `Create week item: "${spec.title}" (${spec.date} ${spec.dayOfWeek}, ${spec.category}${spec.status ? `/${spec.status}` : ""}, owner=${spec.owner}, resources=${spec.resources ?? "null"}) → project "${projectName}"`
    );
    if (!ctx.dryRun) {
      const result = await createWeekItem({
        clientSlug: LPPC_SLUG,
        projectName,
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
      if (!result.ok) throw new Error(`Create '${spec.title}' failed: ${result.error}`);
    }
  }

  // ── Phase 6 — Update client team field ──
  ctx.log(`--- Phase 6: update LPPC team → "${LPPC_TEAM_NEW}" ---`);
  if (!ctx.dryRun) {
    const result = await updateClientField({
      clientSlug: LPPC_SLUG,
      field: "team",
      newValue: LPPC_TEAM_NEW,
      updatedBy: UPDATED_BY,
    });
    if (!result.ok) throw new Error(`Update client team failed: ${result.error}`);
  }

  // ── Phase 7 — Verification ──
  if (!ctx.dryRun) {
    await verify(ctx, resolved, newParentIdByName);
  }

  ctx.log("=== LPPC Cleanup complete ===");
}

// ── Pre-checks ───────────────────────────────────────────

interface ResolvedState {
  readonly lppc: typeof clients.$inferSelect;
  /** All resolved projects keyed by 8-char prefix (delete + update lists combined). */
  readonly projectsByPrefix: Map<string, typeof projects.$inferSelect>;
  /** Subset: projects to be updated in Phase 3. */
  readonly projectUpdatesByPrefix: Map<string, typeof projects.$inferSelect>;
  /** Week items to rewire in Phase 4. */
  readonly rewireItemsByPrefix: Map<string, typeof weekItems.$inferSelect>;
}

async function preChecks(ctx: MigrationContext): Promise<ResolvedState> {
  ctx.log("--- Pre-checks ---");

  // Resolve LPPC client
  const lppcRows = await ctx.db
    .select()
    .from(clients)
    .where(eq(clients.slug, LPPC_SLUG));
  const lppc = lppcRows[0];
  if (!lppc) {
    throw new Error(`Pre-check failed: client '${LPPC_SLUG}' not found.`);
  }
  if (lppc.id !== LPPC_ID) {
    throw new Error(
      `Pre-check failed: LPPC ID mismatch (got ${lppc.id}, expected ${LPPC_ID}). Abort.`
    );
  }

  // Assert new parent name doesn't already exist for LPPC (case-insensitive)
  const allClientProjects = await ctx.db
    .select()
    .from(projects)
    .where(eq(projects.clientId, lppc.id));
  for (const spec of CREATE_SPECS) {
    const clash = allClientProjects.find(
      (p) => p.name.trim().toLowerCase() === spec.name.toLowerCase()
    );
    if (clash) {
      throw new Error(
        `Pre-check failed: project '${spec.name}' already exists for LPPC (id=${clash.id}). Abort.`
      );
    }
  }

  // Also assert post-rename targets don't clash. e.g. "Website Blog Posts"
  // must not already exist (we're renaming 35a75784 into that name).
  for (const spec of PROJECT_UPDATE_SPECS) {
    if (spec.targetName === spec.currentName) continue;
    const clash = allClientProjects.find(
      (p) =>
        p.name.trim().toLowerCase() === spec.targetName.toLowerCase() &&
        !p.id.startsWith(spec.prefix)
    );
    if (clash) {
      throw new Error(
        `Pre-check failed: rename target '${spec.targetName}' already exists for LPPC on a different row (id=${clash.id}). Abort.`
      );
    }
  }

  // Resolve all project prefixes (delete + update)
  const projectsByPrefix = new Map<string, typeof projects.$inferSelect>();
  const projectUpdatesByPrefix = new Map<string, typeof projects.$inferSelect>();

  const allProjectPrefixes = new Set<string>();
  for (const spec of DELETE_SPECS) allProjectPrefixes.add(spec.prefix);
  for (const spec of PROJECT_UPDATE_SPECS) allProjectPrefixes.add(spec.prefix);
  for (const spec of WEEK_ITEM_REWIRE_SPECS) {
    if (spec.targetParentPrefix !== NEW_PARENT_SENTINEL) {
      allProjectPrefixes.add(spec.targetParentPrefix);
    }
  }
  for (const spec of CREATE_WEEK_ITEM_SPECS) {
    if (spec.parentRef.kind === "existing") allProjectPrefixes.add(spec.parentRef.prefix);
  }

  for (const prefix of allProjectPrefixes) {
    const matches = await ctx.db
      .select()
      .from(projects)
      .where(and(eq(projects.clientId, lppc.id), like(projects.id, `${prefix}%`)));
    if (matches.length !== 1) {
      throw new Error(
        `Pre-check failed: project prefix '${prefix}' resolved to ${matches.length} rows (expected 1).`
      );
    }
    projectsByPrefix.set(prefix, matches[0]);
  }

  // Populate updates subset
  for (const spec of PROJECT_UPDATE_SPECS) {
    const row = projectsByPrefix.get(spec.prefix);
    if (!row) throw new Error(`Internal: project ${spec.prefix} missing from map`);
    // Sanity: current name matches expectation
    if (row.name !== spec.currentName) {
      throw new Error(
        `Pre-check failed: project ${spec.prefix} current name is "${row.name}", expected "${spec.currentName}".`
      );
    }
    projectUpdatesByPrefix.set(spec.prefix, row);
  }

  // Assert each of the 4 deletes has ZERO linked week items (preflight said 0 linked client-wide).
  for (const spec of DELETE_SPECS) {
    const project = projectsByPrefix.get(spec.prefix);
    if (!project) throw new Error(`Internal: delete project ${spec.prefix} missing from map`);
    const children = await ctx.db
      .select({ id: weekItems.id })
      .from(weekItems)
      .where(eq(weekItems.projectId, project.id));
    if (children.length !== 0) {
      throw new Error(
        `Pre-check failed: delete target ${spec.prefix} (${spec.name}) expected 0 children but has ${children.length}. Abort.`
      );
    }
  }

  // Resolve 3 rewire week-item prefixes; assert currently orphaned + correct client + title match
  const rewireItemsByPrefix = new Map<string, typeof weekItems.$inferSelect>();
  for (const spec of WEEK_ITEM_REWIRE_SPECS) {
    const matches = await ctx.db
      .select()
      .from(weekItems)
      .where(
        and(eq(weekItems.clientId, lppc.id), like(weekItems.id, `${spec.prefix}%`))
      );
    if (matches.length !== 1) {
      throw new Error(
        `Pre-check failed: week-item prefix '${spec.prefix}' resolved to ${matches.length} rows (expected 1).`
      );
    }
    const row = matches[0];
    if (row.projectId !== null) {
      throw new Error(
        `Pre-check failed: week item ${spec.prefix} already has projectId=${row.projectId}; expected null (orphan). Abort.`
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
    `Pre-checks passed. lppc=${lppc.id}, ${projectsByPrefix.size} projects resolved, ${rewireItemsByPrefix.size} rewire items.`
  );

  return {
    lppc,
    projectsByPrefix,
    projectUpdatesByPrefix,
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
    batchId: getBatchId(),
    client: r.lppc,
    projectsToDelete: Array.from(
      DELETE_SPECS.map((s) => r.projectsByPrefix.get(s.prefix))
    ).filter(Boolean),
    projectsToUpdate: Array.from(r.projectUpdatesByPrefix.values()),
    weekItemsToRewire: Array.from(r.rewireItemsByPrefix.values()),
    newParentsPlanned: CREATE_SPECS.map((s) => ({
      name: s.name,
      status: s.status,
      category: s.category,
      owner: s.owner,
      resources: s.resources ?? null,
      waitingOn: s.waitingOn ?? null,
      notes: s.notes,
      clientId: r.lppc.id,
    })),
    newWeekItemsPlanned: CREATE_WEEK_ITEM_SPECS.map((s) => ({
      parentRef: s.parentRef,
      title: s.title,
      date: s.date,
      dayOfWeek: s.dayOfWeek,
      weekOf: s.weekOf,
      category: s.category,
      status: s.status ?? null,
      owner: s.owner,
      resources: s.resources ?? null,
      notes: s.notes,
    })),
    clientTeamPlanned: LPPC_TEAM_NEW,
  };

  const suffix = ctx.dryRun ? "-dryrun" : "";
  const outPath = resolvePath(
    process.cwd(),
    `docs/tmp/lppc-pre-apply-snapshot${suffix}.json`
  );
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2), "utf8");
  ctx.log(`Wrote pre-apply snapshot → ${outPath}`);
}

// ── Project field updates (Phase 3) — write-only-if-different ────

async function applyProjectFieldUpdates(
  ctx: MigrationContext,
  spec: ProjectUpdateSpec,
  project: typeof projects.$inferSelect
): Promise<void> {
  const f = spec.fields;

  // status via updateProjectStatus (cascade-aware)
  if (f.status !== undefined && f.status !== project.status) {
    ctx.log(
      `Project ${spec.prefix} (${project.name}): status "${project.status}" → "${f.status}"`
    );
    if (!ctx.dryRun) {
      const result = await updateProjectStatus({
        clientSlug: LPPC_SLUG,
        projectName: project.name,
        newStatus: f.status,
        updatedBy: UPDATED_BY,
      });
      if (!result.ok) {
        throw new Error(`Update status ${project.name} failed: ${result.error}`);
      }
    }
  }
  // category
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

  // Null-field handling: for fields listed in `nullableFields`, target is null.
  // If current is already null → skip-and-log. If current is non-null → raw
  // UPDATE + hand-written audit record.
  if (spec.nullableFields) {
    for (const nf of spec.nullableFields) {
      const current = nf === "resources" ? project.resources : project.waitingOn;
      if (current === null || current === "") {
        ctx.log(
          `Project ${spec.prefix} (${project.name}): ${nf} already null, skipping`
        );
      } else {
        ctx.log(
          `Project ${spec.prefix} (${project.name}): ${nf} "${current}" → null (raw UPDATE fallback)`
        );
        if (!ctx.dryRun) {
          await writeProjectFieldToNull(ctx, project, nf);
        }
      }
    }
  }

  // Name change (rename) last — fuzzy-lookup key depends on name
  if (spec.targetName !== project.name) {
    // Use current name to resolve; updateProjectField calls resolveProjectOrFail internally.
    await writeProjectField(ctx, project.name, "name", spec.targetName);
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
    clientSlug: LPPC_SLUG,
    projectName,
    field,
    newValue,
    updatedBy: UPDATED_BY,
  });
  if (!result.ok) {
    throw new Error(`Update ${projectName}.${field} failed: ${result.error}`);
  }
}

/**
 * Raw UPDATE fallback for writing a project field to NULL. updateProjectField
 * can't express NULL (newValue: string). Mirrors the audit-record shape the
 * helper would emit, tagged with the current batch ID.
 */
async function writeProjectFieldToNull(
  ctx: MigrationContext,
  project: typeof projects.$inferSelect,
  field: "resources" | "waitingOn"
): Promise<void> {
  const previousValue = field === "resources" ? project.resources : project.waitingOn;
  const idemKey = generateIdempotencyKey(
    "field-change",
    project.id,
    field,
    "(null)",
    UPDATED_BY
  );

  await ctx.db
    .update(projects)
    .set({ [field]: null, updatedAt: new Date() })
    .where(eq(projects.id, project.id));

  await ctx.db.insert(updates).values({
    id: generateId(),
    idempotencyKey: idemKey,
    projectId: project.id,
    clientId: project.clientId,
    updatedBy: UPDATED_BY,
    updateType: "field-change",
    previousValue: previousValue ?? null,
    newValue: null,
    summary: `LPPC / ${project.name}: ${field} changed from "${previousValue}" to NULL`,
    metadata: JSON.stringify({ field }),
    batchId: getBatchId() ?? null,
  });
}

// ── Week-item field updates (Phase 4) ───────────────────

async function applyWeekItemFieldUpdates(
  ctx: MigrationContext,
  spec: WeekItemRewireSpec,
  row: typeof weekItems.$inferSelect
): Promise<void> {
  let currentWeekOf = row.weekOf;
  let currentTitle = row.title;
  const fields = spec.fields;

  // Write order: status → date → dayOfWeek → resources → owner → notes → weekOf → title
  // Title LAST because lookup key is (weekOf, title). weekOf BEFORE title when both change.
  if (fields.status !== undefined && fields.status !== row.status) {
    await writeWeekItemField(ctx, spec.prefix, currentWeekOf, currentTitle, "status", fields.status);
  }
  if (fields.date !== undefined && fields.date !== row.date) {
    await writeWeekItemField(ctx, spec.prefix, currentWeekOf, currentTitle, "date", fields.date);
  }
  if (fields.dayOfWeek !== undefined && fields.dayOfWeek !== row.dayOfWeek) {
    await writeWeekItemField(
      ctx,
      spec.prefix,
      currentWeekOf,
      currentTitle,
      "dayOfWeek",
      fields.dayOfWeek
    );
  }
  if (fields.resources !== undefined && fields.resources !== row.resources) {
    await writeWeekItemField(
      ctx,
      spec.prefix,
      currentWeekOf,
      currentTitle,
      "resources",
      fields.resources
    );
  }
  if (fields.owner !== undefined && fields.owner !== row.owner) {
    await writeWeekItemField(ctx, spec.prefix, currentWeekOf, currentTitle, "owner", fields.owner);
  }
  if (fields.notes !== undefined && fields.notes !== row.notes) {
    await writeWeekItemField(ctx, spec.prefix, currentWeekOf, currentTitle, "notes", fields.notes);
  }

  // weekOf before title — lookup key depends on weekOf
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

  // Title LAST
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

async function verify(
  ctx: MigrationContext,
  r: ResolvedState,
  newParentIdByName: Map<string, string>
): Promise<void> {
  ctx.log("--- Verification ---");

  // 1. Strict orphan invariant
  const strictOrphans = await ctx.db
    .select({ id: weekItems.id, title: weekItems.title, status: weekItems.status })
    .from(weekItems)
    .where(
      and(
        eq(weekItems.clientId, r.lppc.id),
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

  // Informational + assert: loose orphan count. All 3 starting orphans are
  // being rewired (not marked-completed-only), so loose should also be 0.
  const looseOrphans = await ctx.db
    .select({ id: weekItems.id })
    .from(weekItems)
    .where(and(eq(weekItems.clientId, r.lppc.id), isNull(weekItems.projectId)));
  ctx.log(`Loose orphans (projectId null, any status): ${looseOrphans.length} (expected 0)`);
  if (looseOrphans.length !== 0) {
    throw new Error(
      `VERIFICATION FAILED: expected 0 loose orphans, got ${looseOrphans.length}.`
    );
  }

  // 2. Each of 4 deleted prefixes → 0 rows
  for (const spec of DELETE_SPECS) {
    const rows = await ctx.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.clientId, r.lppc.id), like(projects.id, `${spec.prefix}%`)));
    if (rows.length !== 0) {
      throw new Error(`VERIFICATION FAILED: deleted project ${spec.prefix} (${spec.name}) still exists.`);
    }
  }
  ctx.log(`All ${DELETE_SPECS.length} deleted projects confirmed gone.`);

  // 3. New parent exists with expected fields
  for (const spec of CREATE_SPECS) {
    const id = newParentIdByName.get(spec.name);
    if (!id) throw new Error(`VERIFICATION FAILED: new parent '${spec.name}' id missing from map.`);
    const rows = await ctx.db.select().from(projects).where(eq(projects.id, id));
    const project = rows[0];
    if (!project) throw new Error(`VERIFICATION FAILED: new parent '${spec.name}' (${id}) not found.`);
    if (project.name !== spec.name) {
      throw new Error(
        `VERIFICATION FAILED: new parent name "${project.name}", expected "${spec.name}".`
      );
    }
    if (project.status !== spec.status) {
      throw new Error(
        `VERIFICATION FAILED: new parent '${spec.name}' status is "${project.status}", expected "${spec.status}".`
      );
    }
    if (project.category !== spec.category) {
      throw new Error(
        `VERIFICATION FAILED: new parent '${spec.name}' category is "${project.category}", expected "${spec.category}".`
      );
    }
    if (project.owner !== spec.owner) {
      throw new Error(
        `VERIFICATION FAILED: new parent '${spec.name}' owner is "${project.owner}", expected "${spec.owner}".`
      );
    }
    if ((project.resources ?? null) !== (spec.resources ?? null)) {
      throw new Error(
        `VERIFICATION FAILED: new parent '${spec.name}' resources is "${project.resources}", expected "${spec.resources ?? null}".`
      );
    }
  }
  ctx.log(`All ${CREATE_SPECS.length} new parents verified.`);

  // 4. Client team field
  const clientRows = await ctx.db.select().from(clients).where(eq(clients.id, r.lppc.id));
  const client = clientRows[0];
  if (client.team !== LPPC_TEAM_NEW) {
    throw new Error(
      `VERIFICATION FAILED: LPPC team is "${client.team}", expected "${LPPC_TEAM_NEW}".`
    );
  }
  ctx.log(`Client team field verified.`);

  // 5. Existing-update projects: assert targetName + any explicitly-set field
  for (const spec of PROJECT_UPDATE_SPECS) {
    const rows = await ctx.db
      .select()
      .from(projects)
      .where(and(eq(projects.clientId, r.lppc.id), like(projects.id, `${spec.prefix}%`)));
    if (rows.length !== 1) {
      throw new Error(`VERIFICATION FAILED: existing ${spec.prefix} resolved to ${rows.length} rows.`);
    }
    const project = rows[0];
    if (project.name !== spec.targetName) {
      throw new Error(
        `VERIFICATION FAILED: existing ${spec.prefix} name is "${project.name}", expected "${spec.targetName}".`
      );
    }
    const f = spec.fields;
    if (f.owner !== undefined && project.owner !== f.owner) {
      throw new Error(
        `VERIFICATION FAILED: ${spec.prefix} owner is "${project.owner}", expected "${f.owner}".`
      );
    }
    if (f.resources !== undefined && project.resources !== f.resources) {
      throw new Error(
        `VERIFICATION FAILED: ${spec.prefix} resources is "${project.resources}", expected "${f.resources}".`
      );
    }
    if (f.notes !== undefined && project.notes !== f.notes) {
      throw new Error(
        `VERIFICATION FAILED: ${spec.prefix} notes mismatch.`
      );
    }
    if (spec.nullableFields) {
      for (const nf of spec.nullableFields) {
        const value = nf === "resources" ? project.resources : project.waitingOn;
        if (value !== null && value !== "") {
          throw new Error(
            `VERIFICATION FAILED: ${spec.prefix} ${nf} is "${value}", expected NULL.`
          );
        }
      }
    }
  }
  ctx.log(`All ${PROJECT_UPDATE_SPECS.length} existing-update projects verified.`);

  // 6. Rewires → projectId matches target; title/status/resources match spec
  const newParentId = newParentIdByName.get(NEW_PARENT_NAME);
  for (const spec of WEEK_ITEM_REWIRE_SPECS) {
    let expectedProjectId: string;
    if (spec.targetParentPrefix === NEW_PARENT_SENTINEL) {
      if (!newParentId) throw new Error(`VERIFICATION FAILED: newParentId unresolved.`);
      expectedProjectId = newParentId;
    } else {
      const target = r.projectsByPrefix.get(spec.targetParentPrefix);
      if (!target) {
        throw new Error(`VERIFICATION FAILED: rewire target ${spec.targetParentPrefix} missing.`);
      }
      expectedProjectId = target.id;
    }
    const rows = await ctx.db
      .select()
      .from(weekItems)
      .where(like(weekItems.id, `${spec.prefix}%`));
    if (rows.length !== 1) {
      throw new Error(`VERIFICATION FAILED: rewire ${spec.prefix} resolved to ${rows.length} rows.`);
    }
    const item = rows[0];
    if (item.projectId !== expectedProjectId) {
      throw new Error(
        `VERIFICATION FAILED: rewire ${spec.prefix} projectId is ${item.projectId}, expected ${expectedProjectId}.`
      );
    }
    if (spec.fields.title !== undefined && item.title !== spec.fields.title) {
      throw new Error(
        `VERIFICATION FAILED: rewire ${spec.prefix} title is "${item.title}", expected "${spec.fields.title}".`
      );
    }
    if (spec.fields.status !== undefined && item.status !== spec.fields.status) {
      throw new Error(
        `VERIFICATION FAILED: rewire ${spec.prefix} status is "${item.status}", expected "${spec.fields.status}".`
      );
    }
    if (spec.fields.resources !== undefined && item.resources !== spec.fields.resources) {
      throw new Error(
        `VERIFICATION FAILED: rewire ${spec.prefix} resources is "${item.resources}", expected "${spec.fields.resources}".`
      );
    }
  }
  ctx.log(`All ${WEEK_ITEM_REWIRE_SPECS.length} rewires verified.`);

  // 7. Total week-item count = 13 (3 rewires + 10 creates)
  const allItems = await ctx.db
    .select({ id: weekItems.id })
    .from(weekItems)
    .where(eq(weekItems.clientId, r.lppc.id));
  const expectedItemCount =
    WEEK_ITEM_REWIRE_SPECS.length + CREATE_WEEK_ITEM_SPECS.length;
  if (allItems.length !== expectedItemCount) {
    throw new Error(
      `VERIFICATION FAILED: expected ${expectedItemCount} week items (${WEEK_ITEM_REWIRE_SPECS.length} rewires + ${CREATE_WEEK_ITEM_SPECS.length} new), got ${allItems.length}.`
    );
  }
  ctx.log(`Total week items: ${allItems.length} (expected ${expectedItemCount}).`);

  // 8. Total project count: 10 − 4 + 1 = 7
  const allProjects = await ctx.db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.clientId, r.lppc.id));
  const expectedProjectCount = 10 - DELETE_SPECS.length + CREATE_SPECS.length;
  if (allProjects.length !== expectedProjectCount) {
    throw new Error(
      `VERIFICATION FAILED: expected ${expectedProjectCount} projects (10 preflight - ${DELETE_SPECS.length} deletes + ${CREATE_SPECS.length} creates), got ${allProjects.length}.`
    );
  }
  ctx.log(`Total projects: ${allProjects.length} (expected ${expectedProjectCount}).`);

  ctx.log("Verification passed.");
}
