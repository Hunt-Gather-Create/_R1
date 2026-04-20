/**
 * Migration: LPPC v4 Realign — 2026-04-21
 *
 * Wave 1 Batch B (PR #86).
 *
 * Applies the v4 convention realign to LPPC:
 *   1. engagement_type = "project" on all 7 L1s (LPPC has no retainers).
 *   2. Expand resources on the 2 active L1s (Interactive Map, Website Revamp)
 *      to the full engaged team per "engaged-roles-per-L1" interpretation.
 *      Dormant / completed L1s are left with null resources (historical team
 *      not reliably known; see post-run note + halt report if needed).
 *   3. Recompute L1 start_date/end_date from children so v4 derivation is
 *      re-asserted on every LPPC L1 (even though no L2s were touched).
 *
 * Pattern:
 * - `resources` goes through `updateProjectField` (in PROJECT_FIELDS whitelist,
 *   gets idempotency + audit record for free).
 * - `engagement_type` is not in PROJECT_FIELDS, so it is written via raw
 *   `ctx.db.update()` + manual `insertAuditRecord()` — matching the pattern
 *   used by Bonterra / Convergix Batch A v4 migrations on this same field.
 * - `recomputeProjectDates` is imported directly from operations-writes-week
 *   (not re-exported through the `operations` barrel). It writes project
 *   start/end and emits no audit rows on its own — the intent here is to
 *   re-assert derivation, not to log a "date change" update.
 *
 * Reverse: `lppc-v4-realign-2026-04-21-REVERT.ts` reads
 * `docs/tmp/lppc-v4-pre-snapshot-2026-04-21.json` and restores every touched
 * field to its pre-state value.
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve as resolvePath, dirname } from "node:path";
import { eq } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { clients, projects, weekItems } from "@/lib/db/runway-schema";
import {
  generateIdempotencyKey,
  insertAuditRecord,
  updateProjectField,
} from "@/lib/runway/operations";
import { recomputeProjectDates } from "@/lib/runway/operations-writes-week";

// ── Constants ────────────────────────────────────────────

const LPPC_SLUG = "lppc";
const UPDATED_BY = "migration";

/**
 * Planned per-L1 field updates.
 *
 * `resources: null` means "do not touch resources on this L1" (dormant L1,
 * historical roster not reliably known).
 * `resources: string` means "set resources to this value".
 * `engagementType: "project"` applies to every L1 (LPPC has no retainers).
 */
interface ProjectPlan {
  nameContains: string; // fuzzy match anchor
  expectedName: string; // exact name we expect to find (pre-check assertion)
  engagementType: "project" | "retainer" | "break-fix";
  resourcesChange: { from: string | null; to: string } | null; // null = skip
}

const PROJECT_PLANS: ProjectPlan[] = [
  {
    nameContains: "Interactive Map",
    expectedName: "Interactive Map",
    engagementType: "project",
    resourcesChange: {
      from: "CD: Lane, Dev: Leslie",
      to: "CD: Lane, CW: Kathy, Dev: Leslie, PM: Jason",
    },
  },
  {
    nameContains: "Year End Report",
    expectedName: "2025 Year End Report",
    engagementType: "project",
    resourcesChange: null,
  },
  {
    nameContains: "Spring CEO",
    expectedName: "Spring CEO Meeting Invite",
    engagementType: "project",
    resourcesChange: null,
  },
  {
    nameContains: "Blog Posts",
    expectedName: "Website Blog Posts",
    engagementType: "project",
    resourcesChange: null,
  },
  {
    nameContains: "Training Video",
    expectedName: "MyLPPC Training Video",
    engagementType: "project",
    resourcesChange: null,
  },
  {
    nameContains: "Mailchimp Invites",
    expectedName: "Mailchimp Invites (Spring + Fall)",
    engagementType: "project",
    resourcesChange: null,
  },
  {
    nameContains: "Website Revamp",
    expectedName: "Website Revamp",
    engagementType: "project",
    resourcesChange: {
      from: "CD: Lane, Dev: Leslie",
      to: "CD: Lane, CW: Kathy, Dev: Leslie, PM: Jason",
    },
  },
];

// ── Exports ──────────────────────────────────────────────

export const description =
  "LPPC v4 realign (2026-04-21): engagement_type='project' on all 7 L1s; expand resources on 2 active L1s; recompute L1 start/end dates from children.";

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("=== LPPC v4 Realign (2026-04-21) ===");

  // Step 1 — Pre-checks + resolve IDs
  const resolved = await preChecks(ctx);

  // Step 2 — Pre-apply snapshot (even in dry-run, for diff comparison)
  await writePreApplySnapshot(ctx, resolved);

  if (ctx.dryRun) {
    ctx.log("Dry-run: no writes will be performed. Operation plan follows.");
  }

  // Step 3 — Per-L1 updates: engagement_type (raw), then resources (if any)
  for (const plan of PROJECT_PLANS) {
    const project = resolved.projectsByName.get(plan.expectedName);
    if (!project) throw new Error(`Resolved project missing for '${plan.expectedName}'.`);

    // 3a — engagement_type via raw update + audit (not in PROJECT_FIELDS whitelist)
    await applyEngagementType(ctx, resolved.lppc.id, project, plan.engagementType);

    // 3b — resources via updateProjectField (in whitelist; handles audit itself)
    if (plan.resourcesChange) {
      await applyResourcesChange(ctx, project.name, plan.resourcesChange);
    }
  }

  // Step 4 — Recompute L1 start/end dates from children (v4 derivation)
  //
  // No L2 writes happened in this migration, so derivation shouldn't shift
  // anything — this is a safety call per TP locked decision so every LPPC L1
  // lands in a known-derived state post-migration. In dry-run, we skip
  // (recomputeProjectDates writes directly and has no dry-run mode).
  if (!ctx.dryRun) {
    ctx.log("--- Recomputing L1 start/end dates from children (v4 derivation) ---");
    for (const plan of PROJECT_PLANS) {
      const project = resolved.projectsByName.get(plan.expectedName);
      if (!project) continue;
      const result = await recomputeProjectDates(project.id);
      ctx.log(
        `  ${plan.expectedName}: derived start=${result?.startDate ?? "null"}, end=${result?.endDate ?? "null"}`
      );
    }
  } else {
    ctx.log("Dry-run: skipping recomputeProjectDates (runs in apply mode only).");
  }

  // Step 5 — Verification (apply-only)
  if (!ctx.dryRun) {
    await verify(ctx, resolved.lppc.id);
  }

  ctx.log("=== LPPC v4 Realign complete ===");
}

// ── Pre-checks ───────────────────────────────────────────

interface ResolvedState {
  lppc: typeof clients.$inferSelect;
  projectsByName: Map<string, typeof projects.$inferSelect>;
}

async function preChecks(ctx: MigrationContext): Promise<ResolvedState> {
  ctx.log("--- Pre-checks ---");

  // Resolve LPPC client
  const lppcRows = await ctx.db.select().from(clients).where(eq(clients.slug, LPPC_SLUG));
  const lppc = lppcRows[0];
  if (!lppc) throw new Error(`Pre-check failed: client '${LPPC_SLUG}' not found.`);
  ctx.log(`LPPC client id=${lppc.id}`);

  // Pull all LPPC projects, index by name
  const lppcProjects = await ctx.db
    .select()
    .from(projects)
    .where(eq(projects.clientId, lppc.id));

  const byName = new Map<string, typeof projects.$inferSelect>();
  for (const p of lppcProjects) byName.set(p.name, p);

  // Assert every planned project is present with expected name and that the
  // pre-state resources value matches what the plan expects to transition
  // from. Resources mismatch = halt (either someone already touched this or
  // the snapshot we planned against is stale).
  for (const plan of PROJECT_PLANS) {
    const project = byName.get(plan.expectedName);
    if (!project) {
      throw new Error(
        `Pre-check failed: expected LPPC project '${plan.expectedName}' not found.`
      );
    }

    if (plan.resourcesChange) {
      if (project.resources !== plan.resourcesChange.from) {
        throw new Error(
          `Pre-check failed: project '${plan.expectedName}' resources expected "${plan.resourcesChange.from}", got "${project.resources}". Halt.`
        );
      }
    }

    // engagement_type should currently be null on every L1 (v4 new column, not
    // yet populated for LPPC).
    if (project.engagementType !== null) {
      throw new Error(
        `Pre-check failed: project '${plan.expectedName}' engagementType expected null, got "${project.engagementType}". Halt.`
      );
    }
  }

  if (lppcProjects.length !== PROJECT_PLANS.length) {
    throw new Error(
      `Pre-check failed: expected ${PROJECT_PLANS.length} LPPC projects, found ${lppcProjects.length}. Halt.`
    );
  }

  ctx.log(
    `Pre-checks passed. ${lppcProjects.length} L1 projects resolved, all with engagement_type=null, resources pre-state matches plan.`
  );

  return { lppc, projectsByName: byName };
}

// ── Snapshot ─────────────────────────────────────────────

async function writePreApplySnapshot(
  ctx: MigrationContext,
  r: ResolvedState
): Promise<void> {
  const capturedAt = new Date().toISOString();
  const lppcItems = await ctx.db
    .select()
    .from(weekItems)
    .where(eq(weekItems.clientId, r.lppc.id));

  const snapshot = {
    capturedAt,
    mode: ctx.dryRun ? "dry-run" : "apply",
    description:
      "LPPC v4 realign pre-apply snapshot (written by lppc-v4-realign-2026-04-21 script).",
    client: r.lppc,
    projects: Array.from(r.projectsByName.values()),
    weekItems: lppcItems,
    plans: PROJECT_PLANS,
  };

  const suffix = ctx.dryRun ? "-dryrun" : "";
  const outPath = resolvePath(
    process.cwd(),
    `docs/tmp/lppc-v4-pre-apply-snapshot${suffix}.json`
  );
  const dir = dirname(outPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2), "utf8");
  ctx.log(`Wrote pre-apply snapshot → ${outPath}`);
}

// ── Field apply: engagement_type (raw + audit) ───────────

async function applyEngagementType(
  ctx: MigrationContext,
  clientId: string,
  project: typeof projects.$inferSelect,
  newValue: "project" | "retainer" | "break-fix"
): Promise<void> {
  const previousValue = project.engagementType;
  if (previousValue === newValue) {
    ctx.log(`Project '${project.name}': engagement_type already "${newValue}", skipping.`);
    return;
  }

  ctx.log(
    `Project '${project.name}': engagement_type "${previousValue ?? "null"}" → "${newValue}" (raw UPDATE — field not in PROJECT_FIELDS whitelist)`
  );
  if (ctx.dryRun) return;

  const idemKey = generateIdempotencyKey(
    "field-change",
    project.id,
    "engagementType",
    newValue,
    UPDATED_BY
  );

  await ctx.db
    .update(projects)
    .set({ engagementType: newValue, updatedAt: new Date() })
    .where(eq(projects.id, project.id));

  await insertAuditRecord({
    idempotencyKey: idemKey,
    projectId: project.id,
    clientId,
    updatedBy: UPDATED_BY,
    updateType: "field-change",
    previousValue: previousValue ?? null,
    newValue,
    summary: `LPPC / ${project.name}: engagement_type set to "${newValue}" (v4 new column)`,
    metadata: JSON.stringify({ field: "engagementType" }),
  });
}

// ── Field apply: resources (through whitelist helper) ────

async function applyResourcesChange(
  ctx: MigrationContext,
  projectName: string,
  change: { from: string | null; to: string }
): Promise<void> {
  ctx.log(
    `Project '${projectName}': resources "${change.from ?? "null"}" → "${change.to}"`
  );
  if (ctx.dryRun) return;

  const result = await updateProjectField({
    clientSlug: LPPC_SLUG,
    projectName,
    field: "resources",
    newValue: change.to,
    updatedBy: UPDATED_BY,
  });
  if (!result.ok) {
    throw new Error(`updateProjectField(resources) for '${projectName}' failed: ${result.error}`);
  }
}

// ── Verification ─────────────────────────────────────────

async function verify(ctx: MigrationContext, lppcId: string): Promise<void> {
  ctx.log("--- Verification ---");

  const lppcProjects = await ctx.db
    .select()
    .from(projects)
    .where(eq(projects.clientId, lppcId));

  if (lppcProjects.length !== PROJECT_PLANS.length) {
    throw new Error(
      `VERIFICATION FAILED: expected ${PROJECT_PLANS.length} LPPC projects, got ${lppcProjects.length}.`
    );
  }

  for (const p of lppcProjects) {
    if (p.engagementType !== "project") {
      throw new Error(
        `VERIFICATION FAILED: project '${p.name}' engagement_type="${p.engagementType}", expected "project".`
      );
    }
  }

  const byName = new Map(lppcProjects.map((p) => [p.name, p]));
  for (const plan of PROJECT_PLANS) {
    if (!plan.resourcesChange) continue;
    const p = byName.get(plan.expectedName);
    if (!p) throw new Error(`VERIFICATION FAILED: project '${plan.expectedName}' vanished.`);
    if (p.resources !== plan.resourcesChange.to) {
      throw new Error(
        `VERIFICATION FAILED: project '${plan.expectedName}' resources="${p.resources}", expected "${plan.resourcesChange.to}".`
      );
    }
  }

  ctx.log(
    `Verification passed. ${lppcProjects.length} L1s have engagement_type="project"; 2 active L1s have expanded resources.`
  );
}
