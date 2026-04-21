/**
 * Migration: TAP v4 Realign — 2026-04-21
 *
 * Aligns TAP (single-L1 client) to v4 convention per
 * `docs/tmp/runway-v4-convention.md` and the "### TAP — v4 realign" section
 * of `docs/tmp/migration-specs/overnight-clients-v4-realign.md`.
 *
 * Changes:
 *   1. client.team:  "Owner: Jason, Dev: Tim"  →  "PM: Jason, Dev: Tim"
 *      (`Owner:` is not a valid v4 role prefix; other clients use `PM:` for Jason)
 *
 *   2. L1 "TAP ERP Rebuild":
 *        name          "TAP ERP Rebuild"  →  "ERP Rebuild"   (drop client prefix)
 *        resources     "Dev: Tim"         →  "PM: Jason, Dev: Tim"
 *                                             (engaged roles = L1 owner role + L2 union of roles)
 *        engagement_type   null           →  "project"       (NEW v4 column; raw UPDATE +
 *                                             explicit audit row — not in PROJECT_FIELDS)
 *
 *   3. Every L2 on the L1:
 *        title      drop category word, prepend project name per v4 `[Project] — [Milestone]`
 *          "Development (8 modules)"        →  "ERP Rebuild — Development"
 *          "Data Migration — Kickoff"       →  "ERP Rebuild — Data Migration"
 *          "Testing & QA — Kickoff"         →  "ERP Rebuild — Testing & QA"
 *          "Deployment & Go-Live — Kickoff" →  "ERP Rebuild — Deployment & Go-Live"
 *          "Training & Handoff — Kickoff"   →  "ERP Rebuild — Training & Handoff"
 *        blocked_by   populated for sequential phases (Access 97 → PostgreSQL chain in notes)
 *          Development          → null        (active, no upstream)
 *          Data Migration       → [Development.id]
 *          Testing & QA         → [Data Migration.id]
 *          Deployment & Go-Live → [Testing.id]
 *          Training & Handoff   → [Deployment.id]
 *
 * Fields intentionally NOT touched (already v4-correct per pre-snapshot):
 *   client.contract_status ("signed"), client.contract_term, client.contacts
 *   L1.status (in-production), L1.category (active), L1.owner (Jason)
 *   L1.startDate / endDate (already derived correctly 2026-04-20 / 2026-10-26)
 *   L2.status values (in-progress for active phase; "blocked" on gated ones — v4-valid)
 *   L2.owner (Jason, inherited from L1), L2.category ("kickoff" for phase starts)
 *   L2.startDate (already backfilled)
 *
 * Operation order (pinned):
 *   pre-checks → snapshot → client.team → L1 name/resources/engagement_type →
 *   L2 titles → L2 blocked_by → verify.
 *
 * Reverse script: `tap-v4-realign-2026-04-21-REVERT.ts` reads the pre-snapshot
 * file and restores every modified field to its pre-value.
 */
import { writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { and, eq, like } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { clients, projects, weekItems } from "@/lib/db/runway-schema";
import {
  generateIdempotencyKey,
  getBatchId,
  insertAuditRecord,
  updateClientField,
  updateProjectField,
  updateWeekItemField,
} from "@/lib/runway/operations";

// ── Constants ────────────────────────────────────────────

const TAP_SLUG = "tap";
const UPDATED_BY = "migration";

const L1_CURRENT_NAME = "TAP ERP Rebuild";
const L1_NEW_NAME = "ERP Rebuild";
const L1_NEW_RESOURCES = "PM: Jason, Dev: Tim";
const L1_NEW_ENGAGEMENT_TYPE = "project";

const CLIENT_TEAM_CURRENT = "Owner: Jason, Dev: Tim";
const CLIENT_TEAM_NEW = "PM: Jason, Dev: Tim";

type L2Plan = {
  /** 8-char ID prefix from the pre-snapshot (stable across environments). */
  prefix: string;
  expectedCurrentTitle: string;
  expectedWeekOf: string;
  newTitle: string;
  /**
   * Prefix of the upstream L2 this item is blocked by. Resolved to full ID
   * during the migration; `null` means no upstream blocker.
   */
  blockedByPrefix: string | null;
};

const L2_PLANS: L2Plan[] = [
  {
    prefix: "95f9ce76",
    expectedCurrentTitle: "Development (8 modules)",
    expectedWeekOf: "2026-04-20",
    newTitle: "ERP Rebuild — Development",
    blockedByPrefix: null,
  },
  {
    prefix: "bd6521b3",
    expectedCurrentTitle: "Data Migration — Kickoff",
    expectedWeekOf: "2026-08-17",
    newTitle: "ERP Rebuild — Data Migration",
    blockedByPrefix: "95f9ce76",
  },
  {
    prefix: "46d5cedb",
    expectedCurrentTitle: "Testing & QA — Kickoff",
    expectedWeekOf: "2026-08-31",
    newTitle: "ERP Rebuild — Testing & QA",
    blockedByPrefix: "bd6521b3",
  },
  {
    prefix: "2776d883",
    expectedCurrentTitle: "Deployment & Go-Live — Kickoff",
    expectedWeekOf: "2026-10-12",
    newTitle: "ERP Rebuild — Deployment & Go-Live",
    blockedByPrefix: "46d5cedb",
  },
  {
    prefix: "38ae73c9",
    expectedCurrentTitle: "Training & Handoff — Kickoff",
    expectedWeekOf: "2026-10-26",
    newTitle: "ERP Rebuild — Training & Handoff",
    blockedByPrefix: "2776d883",
  },
];

// ── Exports ──────────────────────────────────────────────

export const description =
  "TAP v4 realign 2026-04-21: engagement_type=project, role-prefix team/resources, drop client-name title prefix, populate sequential blocked_by.";

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("=== TAP v4 Realign 2026-04-21 ===");

  // Step 1 — Pre-checks + resolve IDs
  const resolved = await preChecks(ctx);

  // Step 2 — Write snapshot (dry-run writes side-file so prod snapshot stays pristine)
  writeSnapshot(ctx, resolved);

  if (ctx.dryRun) {
    ctx.log("Dry-run: no writes will be performed. Operation plan follows.");
  }

  // Step 3 — Client.team
  ctx.log(`Client tap: team "${resolved.client.team}" → "${CLIENT_TEAM_NEW}"`);
  if (!ctx.dryRun) {
    const result = await updateClientField({
      clientSlug: TAP_SLUG,
      field: "team",
      newValue: CLIENT_TEAM_NEW,
      updatedBy: UPDATED_BY,
    });
    if (!result.ok) throw new Error(`Update client.team failed: ${result.error}`);
  }

  // Step 4 — L1 fields
  await applyL1Updates(ctx, resolved);

  // Step 5 — L2 title updates (stable lookup by current weekOf + title, so do BEFORE blocked_by writes)
  for (const plan of L2_PLANS) {
    await applyL2TitleUpdate(ctx, plan);
  }

  // Step 6 — L2 blocked_by (now using new titles — lookup key uses plan.newTitle)
  for (const plan of L2_PLANS) {
    await applyL2BlockedByUpdate(ctx, plan, resolved.l2IdsByPrefix);
  }

  // Step 7 — Verify
  if (!ctx.dryRun) {
    await verify(ctx, resolved);
  }

  ctx.log("=== TAP v4 Realign complete ===");
}

// ── Pre-checks ───────────────────────────────────────────

interface ResolvedState {
  client: typeof clients.$inferSelect;
  l1: typeof projects.$inferSelect;
  l2ByPrefix: Map<string, typeof weekItems.$inferSelect>;
  l2IdsByPrefix: Map<string, string>;
}

async function preChecks(ctx: MigrationContext): Promise<ResolvedState> {
  ctx.log("--- Pre-checks ---");

  // Resolve TAP client
  const clientRows = await ctx.db.select().from(clients).where(eq(clients.slug, TAP_SLUG));
  const client = clientRows[0];
  if (!client) throw new Error(`Pre-check failed: client '${TAP_SLUG}' not found.`);
  if (client.team !== CLIENT_TEAM_CURRENT) {
    throw new Error(
      `Pre-check failed: client.team is "${client.team}", expected "${CLIENT_TEAM_CURRENT}". Pre-state drift — abort.`
    );
  }

  // Resolve sole TAP L1 (must be exactly one; this migration is scoped to single L1)
  const l1s = await ctx.db
    .select()
    .from(projects)
    .where(eq(projects.clientId, client.id));
  if (l1s.length !== 1) {
    throw new Error(
      `Pre-check failed: expected exactly 1 TAP L1, got ${l1s.length}. Abort (scope mismatch).`
    );
  }
  const l1 = l1s[0];
  if (l1.name !== L1_CURRENT_NAME) {
    throw new Error(
      `Pre-check failed: L1 name is "${l1.name}", expected "${L1_CURRENT_NAME}". Abort.`
    );
  }
  if (l1.engagementType !== null) {
    throw new Error(
      `Pre-check failed: L1.engagement_type is "${l1.engagementType}", expected null. Abort (already migrated?).`
    );
  }

  // Resolve 5 L2s by ID prefix — assert exact pre-state
  const l2ByPrefix = new Map<string, typeof weekItems.$inferSelect>();
  const l2IdsByPrefix = new Map<string, string>();
  for (const plan of L2_PLANS) {
    const matches = await ctx.db
      .select()
      .from(weekItems)
      .where(and(eq(weekItems.clientId, client.id), like(weekItems.id, `${plan.prefix}%`)));
    if (matches.length !== 1) {
      throw new Error(
        `Pre-check failed: expected exactly 1 TAP L2 with id prefix '${plan.prefix}' (${plan.expectedCurrentTitle}), got ${matches.length}.`
      );
    }
    const row = matches[0];
    if (row.title !== plan.expectedCurrentTitle) {
      throw new Error(
        `Pre-check failed: L2 ${plan.prefix} title is "${row.title}", expected "${plan.expectedCurrentTitle}". Abort.`
      );
    }
    if (row.weekOf !== plan.expectedWeekOf) {
      throw new Error(
        `Pre-check failed: L2 ${plan.prefix} weekOf is "${row.weekOf}", expected "${plan.expectedWeekOf}". Abort.`
      );
    }
    if (row.projectId !== l1.id) {
      throw new Error(
        `Pre-check failed: L2 ${plan.prefix} projectId is "${row.projectId}", expected "${l1.id}" (TAP L1). Abort.`
      );
    }
    if (row.blockedBy !== null) {
      throw new Error(
        `Pre-check failed: L2 ${plan.prefix} blocked_by is "${row.blockedBy}", expected null. Abort (already migrated?).`
      );
    }
    l2ByPrefix.set(plan.prefix, row);
    l2IdsByPrefix.set(plan.prefix, row.id);
  }

  ctx.log(
    `Pre-checks passed. tap id=${client.id}, 1 L1 resolved, 5 L2s resolved (all pre-state matches).`
  );

  return { client, l1, l2ByPrefix, l2IdsByPrefix };
}

// ── Snapshot ─────────────────────────────────────────────

function writeSnapshot(ctx: MigrationContext, r: ResolvedState): void {
  const capturedAt = new Date().toISOString();
  const snapshot = {
    capturedAt,
    mode: ctx.dryRun ? "dry-run" : "apply",
    batchId: getBatchId(),
    client: r.client,
    projects: [r.l1],
    weekItems: Array.from(r.l2ByPrefix.values()),
  };

  const suffix = ctx.dryRun ? "-dryrun" : "-preapply";
  const outPath = resolvePath(
    process.cwd(),
    `docs/tmp/tap-v4-pre-snapshot-2026-04-21${suffix}.json`
  );
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2), "utf8");
  ctx.log(`Wrote snapshot → ${outPath}`);
}

// ── L1 updates ───────────────────────────────────────────

async function applyL1Updates(ctx: MigrationContext, r: ResolvedState): Promise<void> {
  // name (via updateProjectField — "name" is in PROJECT_FIELDS whitelist)
  ctx.log(`L1 ${r.l1.id}: name "${r.l1.name}" → "${L1_NEW_NAME}"`);
  if (!ctx.dryRun) {
    const result = await updateProjectField({
      clientSlug: TAP_SLUG,
      projectName: r.l1.name,
      field: "name",
      newValue: L1_NEW_NAME,
      updatedBy: UPDATED_BY,
    });
    if (!result.ok) throw new Error(`Update L1.name failed: ${result.error}`);
  }

  // resources (via updateProjectField — "resources" is in PROJECT_FIELDS whitelist).
  // NOTE: lookup now uses the NEW name (previous step renamed the row).
  ctx.log(`L1 ${r.l1.id}: resources "${r.l1.resources}" → "${L1_NEW_RESOURCES}"`);
  if (!ctx.dryRun) {
    const result = await updateProjectField({
      clientSlug: TAP_SLUG,
      projectName: L1_NEW_NAME,
      field: "resources",
      newValue: L1_NEW_RESOURCES,
      updatedBy: UPDATED_BY,
    });
    if (!result.ok) throw new Error(`Update L1.resources failed: ${result.error}`);
  }

  // engagement_type — NOT in PROJECT_FIELDS whitelist. Raw UPDATE + explicit audit row.
  ctx.log(
    `L1 ${r.l1.id}: engagement_type "${r.l1.engagementType}" → "${L1_NEW_ENGAGEMENT_TYPE}" (raw UPDATE + audit)`
  );
  if (!ctx.dryRun) {
    await ctx.db
      .update(projects)
      .set({ engagementType: L1_NEW_ENGAGEMENT_TYPE, updatedAt: new Date() })
      .where(eq(projects.id, r.l1.id));

    const idemKey = generateIdempotencyKey(
      "project-field-change",
      r.l1.id,
      "engagementType",
      L1_NEW_ENGAGEMENT_TYPE,
      UPDATED_BY
    );
    await insertAuditRecord({
      idempotencyKey: idemKey,
      projectId: r.l1.id,
      clientId: r.l1.clientId,
      updatedBy: UPDATED_BY,
      updateType: "project-field-change",
      previousValue: r.l1.engagementType,
      newValue: L1_NEW_ENGAGEMENT_TYPE,
      summary: `Project '${L1_NEW_NAME}': engagement_type set to "${L1_NEW_ENGAGEMENT_TYPE}"`,
      metadata: JSON.stringify({ field: "engagementType" }),
    });
  }
}

// ── L2 updates ───────────────────────────────────────────

async function applyL2TitleUpdate(ctx: MigrationContext, plan: L2Plan): Promise<void> {
  ctx.log(
    `L2 ${plan.prefix}: title "${plan.expectedCurrentTitle}" → "${plan.newTitle}"`
  );
  if (ctx.dryRun) return;
  const result = await updateWeekItemField({
    weekOf: plan.expectedWeekOf,
    weekItemTitle: plan.expectedCurrentTitle,
    field: "title",
    newValue: plan.newTitle,
    updatedBy: UPDATED_BY,
  });
  if (!result.ok) {
    throw new Error(`Update L2 ${plan.prefix} title failed: ${result.error}`);
  }
}

async function applyL2BlockedByUpdate(
  ctx: MigrationContext,
  plan: L2Plan,
  l2IdsByPrefix: Map<string, string>
): Promise<void> {
  if (plan.blockedByPrefix === null) {
    ctx.log(`L2 ${plan.prefix}: blocked_by stays null (no upstream)`);
    return;
  }
  const upstreamId = l2IdsByPrefix.get(plan.blockedByPrefix);
  if (!upstreamId) {
    throw new Error(
      `L2 ${plan.prefix}: cannot resolve upstream prefix '${plan.blockedByPrefix}' — map miss.`
    );
  }
  const blockedByJson = JSON.stringify([upstreamId]);
  ctx.log(`L2 ${plan.prefix} (${plan.newTitle}): blocked_by → ${blockedByJson}`);
  if (ctx.dryRun) return;

  const result = await updateWeekItemField({
    weekOf: plan.expectedWeekOf,
    weekItemTitle: plan.newTitle, // renamed in previous step
    field: "blockedBy",
    newValue: blockedByJson,
    updatedBy: UPDATED_BY,
  });
  if (!result.ok) {
    throw new Error(`Update L2 ${plan.prefix} blocked_by failed: ${result.error}`);
  }
}

// ── Verification ─────────────────────────────────────────

async function verify(ctx: MigrationContext, r: ResolvedState): Promise<void> {
  ctx.log("--- Verification ---");

  // Client team
  const clientRows = await ctx.db.select().from(clients).where(eq(clients.id, r.client.id));
  const client = clientRows[0];
  if (client.team !== CLIENT_TEAM_NEW) {
    throw new Error(
      `VERIFICATION FAILED: client.team is "${client.team}", expected "${CLIENT_TEAM_NEW}".`
    );
  }

  // L1 fields
  const l1Rows = await ctx.db.select().from(projects).where(eq(projects.id, r.l1.id));
  const l1 = l1Rows[0];
  if (l1.name !== L1_NEW_NAME) {
    throw new Error(`VERIFICATION FAILED: L1.name is "${l1.name}", expected "${L1_NEW_NAME}".`);
  }
  if (l1.resources !== L1_NEW_RESOURCES) {
    throw new Error(
      `VERIFICATION FAILED: L1.resources is "${l1.resources}", expected "${L1_NEW_RESOURCES}".`
    );
  }
  if (l1.engagementType !== L1_NEW_ENGAGEMENT_TYPE) {
    throw new Error(
      `VERIFICATION FAILED: L1.engagement_type is "${l1.engagementType}", expected "${L1_NEW_ENGAGEMENT_TYPE}".`
    );
  }

  // L2 fields
  for (const plan of L2_PLANS) {
    const rows = await ctx.db.select().from(weekItems).where(like(weekItems.id, `${plan.prefix}%`));
    if (rows.length !== 1) {
      throw new Error(`VERIFICATION FAILED: L2 ${plan.prefix} row count ${rows.length}, expected 1.`);
    }
    const row = rows[0];
    if (row.title !== plan.newTitle) {
      throw new Error(
        `VERIFICATION FAILED: L2 ${plan.prefix} title is "${row.title}", expected "${plan.newTitle}".`
      );
    }
    const expectedBlockedBy = plan.blockedByPrefix
      ? JSON.stringify([r.l2IdsByPrefix.get(plan.blockedByPrefix)])
      : null;
    if (row.blockedBy !== expectedBlockedBy) {
      throw new Error(
        `VERIFICATION FAILED: L2 ${plan.prefix} blocked_by is "${row.blockedBy}", expected "${expectedBlockedBy}".`
      );
    }
  }

  ctx.log("Verification passed.");
}
