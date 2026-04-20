/**
 * Migration: Convergix v4 Realign — 2026-04-21
 *
 * Applies the v4 convention (see docs/tmp/runway-v4-convention.md and
 * docs/tmp/migration-specs/overnight-clients-v4-realign.md — "Convergix —
 * full v4 realign") to the 15 Convergix L1s in prod.
 *
 * Changes (see inline L1_OPS_PLAN for the exhaustive list):
 *   - Populate engagement_type='project' on every Convergix L1 (incl. completed).
 *   - Null the legacy `target` field on any L1 where it is currently set.
 *   - Expand L1 resources to the full team actually engaged on that L1
 *     (union of L2 role prefixes + owner's role).
 *   - Flip "Industry Vertical Campaigns" status awaiting-client → in-production
 *     because one of its L2s is currently in-progress (spec: status must match
 *     active L2 state); category is flipped to `active` to keep them paired.
 *
 * Non-goals / explicitly not touched here:
 *   - L2 week items: all L2 titles already follow v4 format (`[Project] — [milestone]`),
 *     owners all match parent L1 owner (Kathy), resources are already role-prefixed,
 *     and start_date/end_date were backfilled by schema-backfill-v4-2026-04-21.
 *   - Client.team: already in role-prefix format `CD: Lane, CW: Kathy, Dev: Leslie, PM: Jason`.
 *   - No L1 additions or deletions.
 *
 * All writes are wrapped with operations-writes-* helpers where the field is on
 * the helper whitelist (resources, target, category, status). Fields not on the
 * whitelist — engagement_type — are written via raw drizzle UPDATE plus a
 * manual audit record inserted via insertAuditRecord(), mirroring the pattern
 * already used in bonterra-cleanup-2026-04-19.ts for null-status writes.
 *
 * Pre-checks abort loudly if the pre-state snapshot doesn't match expectations.
 * Dry-run writes no data and prints the full plan; --apply performs the writes.
 *
 * Reverse script: convergix-v4-realign-2026-04-21-REVERT.ts reads the snapshot
 * artifact written by convergix-discovery.ts and restores prior values.
 */

import { eq } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { projects } from "@/lib/db/runway-schema";
import {
  findProjectByFuzzyName,
  generateIdempotencyKey,
  getClientOrFail,
  insertAuditRecord,
  updateProjectField,
  updateProjectStatus,
} from "@/lib/runway/operations";

// ── Constants ────────────────────────────────────────────

const CLIENT_SLUG = "convergix";
const UPDATED_BY = "migration";

// Target plans per L1. Each row lists the L1 id prefix (first 8 hex chars of
// the uuid-less id used in prod — these are stable within this snapshot) and
// the field changes to apply. Pre-state is also captured so pre-checks can
// halt if someone else edited the record between discovery and apply.

interface L1Plan {
  idPrefix: string;
  name: string;
  pre: {
    status: string | null;
    category: string | null;
    resources: string | null;
    engagementType: string | null;
    target: string | null;
  };
  target: {
    status?: string; // only set when changing
    category?: string; // only set when changing
    resources?: string | null; // null means "keep null"; string "" means "set to null"
    engagementType: string; // always set
    clearTarget: boolean; // if true, null `target`
  };
}

const L1_PLANS: L1Plan[] = [
  {
    idPrefix: "0c208308",
    name: "New Capacity (PPT, brochure, one-pager)",
    pre: {
      status: "awaiting-client",
      category: "awaiting-client",
      resources: "CD: Lane",
      engagementType: null,
      target: "Revisions Mon 4/7, deliver Tues 4/8",
    },
    target: {
      resources: "CW: Kathy, CD: Lane",
      engagementType: "project",
      clearTarget: true,
    },
  },
  {
    idPrefix: "3d5215f4",
    name: "Fanuc Award Article + LI Post",
    pre: {
      status: "not-started",
      category: "active",
      resources: "CW: Kathy, Dev: Leslie",
      engagementType: null,
      target: "Enters schedule w/o 4/20, event 4/28",
    },
    target: {
      // resources already correct
      engagementType: "project",
      clearTarget: true,
    },
  },
  {
    idPrefix: "135c5a61",
    name: "Events Page Updates (5 tradeshows)",
    pre: {
      status: "in-production",
      category: "active",
      resources: null,
      engagementType: null,
      target: "Kathy starts Mon 4/7, to Leslie by Wed 4/9",
    },
    target: {
      resources: "CW: Kathy, Dev: Leslie",
      engagementType: "project",
      clearTarget: true,
    },
  },
  {
    idPrefix: "394f9e5e",
    name: "Rockwell PartnerNetwork Article",
    pre: {
      status: "in-production",
      category: "active",
      resources: null,
      engagementType: null,
      target: null,
    },
    target: {
      resources: "CW: Kathy, Dev: Leslie",
      engagementType: "project",
      clearTarget: false,
    },
  },
  {
    idPrefix: "c0935359",
    name: "Texas Instruments Article",
    pre: {
      status: "in-production",
      category: "active",
      resources: null,
      engagementType: null,
      target: null,
    },
    target: {
      resources: "CW: Kathy, Dev: Leslie",
      engagementType: "project",
      clearTarget: false,
    },
  },
  {
    idPrefix: "f391dff5",
    name: "Social Content (12 posts/mo)",
    pre: {
      status: "in-production",
      category: "active",
      resources: "CD: Lane",
      engagementType: null,
      target: null,
    },
    target: {
      resources: "CW: Kathy, CD: Lane",
      engagementType: "project",
      clearTarget: false,
    },
  },
  {
    idPrefix: "51f39e5c",
    name: "Brand Guide v2 (secondary palette)",
    pre: {
      status: "blocked",
      category: "active",
      resources: "CD: Lane",
      engagementType: null,
      target: null,
    },
    target: {
      resources: "CW: Kathy, CD: Lane",
      engagementType: "project",
      clearTarget: false,
    },
  },
  {
    idPrefix: "68a4ee37",
    name: "Certifications Page",
    pre: {
      status: "awaiting-client",
      category: "awaiting-client",
      resources: null,
      engagementType: null,
      target: null,
    },
    target: {
      resources: "CW: Kathy",
      engagementType: "project",
      clearTarget: false,
    },
  },
  {
    idPrefix: "0e4214c6",
    name: "Industry Vertical Campaigns",
    pre: {
      status: "awaiting-client",
      category: "awaiting-client",
      resources: "CW: Kathy, CD: Lane",
      engagementType: null,
      target: null,
    },
    target: {
      // One L2 (CDS Creative Wrapper) is currently in-progress → flip L1 per v4 spec.
      status: "in-production",
      category: "active",
      resources: "CW: Kathy, CD: Lane, Dev: Leslie",
      engagementType: "project",
      clearTarget: false,
    },
  },
  {
    idPrefix: "4b5bf2f0",
    name: "Life Sciences Brochure",
    pre: {
      status: "completed",
      category: "completed",
      resources: null,
      engagementType: null,
      target: null,
    },
    target: {
      engagementType: "project",
      clearTarget: false,
    },
  },
  {
    idPrefix: "c568d7a6",
    name: "Social Media Templates",
    pre: {
      status: "completed",
      category: "completed",
      resources: null,
      engagementType: null,
      target: null,
    },
    target: {
      engagementType: "project",
      clearTarget: false,
    },
  },
  {
    idPrefix: "7c8478dc",
    name: "Organic Social Playbook",
    pre: {
      status: "completed",
      category: "completed",
      resources: null,
      engagementType: null,
      target: null,
    },
    target: {
      engagementType: "project",
      clearTarget: false,
    },
  },
  {
    idPrefix: "65b2cac1",
    name: "Corporate Collateral Updates",
    pre: {
      status: "awaiting-client",
      category: "awaiting-client",
      resources: "CD: Lane",
      engagementType: null,
      target: null,
    },
    target: {
      resources: "CW: Kathy, CD: Lane",
      engagementType: "project",
      clearTarget: false,
    },
  },
  {
    idPrefix: "0157c423",
    name: "Big Win Template",
    pre: {
      status: "in-production",
      category: "active",
      resources: "CD: Lane",
      engagementType: null,
      target: null,
    },
    target: {
      resources: "CW: Kathy, CD: Lane",
      engagementType: "project",
      clearTarget: false,
    },
  },
  {
    idPrefix: "1923fc1a",
    name: "Rockwell Automation Co-Marketing Efforts",
    pre: {
      status: "awaiting-client",
      category: "awaiting-client",
      resources: "CW: Kathy",
      engagementType: null,
      target: null,
    },
    target: {
      // resources already correct
      engagementType: "project",
      clearTarget: false,
    },
  },
];

// ── Exports ──────────────────────────────────────────────

export const description =
  "Convergix v4 realign (2026-04-21): set engagement_type=project on all L1s, null deprecated `target`, expand L1 resources to engaged team, flip Industry Vertical Campaigns to in-production.";

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("=== Convergix v4 Realign (2026-04-21) ===");

  // Step 1 — Pre-checks: verify every L1 still matches the expected pre-state.
  const lookup = await getClientOrFail(CLIENT_SLUG);
  if (!lookup.ok) throw new Error(`Pre-check failed: ${lookup.error}`);
  const { client } = lookup;
  ctx.log(`Convergix client id: ${client.id}`);

  const allProjects = await ctx.db.select().from(projects).where(eq(projects.clientId, client.id));
  const byPrefix = new Map<string, typeof projects.$inferSelect>();
  for (const p of allProjects) {
    byPrefix.set(p.id.slice(0, 8), p);
  }

  // Ensure the snapshot contains exactly these 15 L1s; abort if any are missing
  // or extra records appear we didn't plan for.
  if (allProjects.length !== L1_PLANS.length) {
    throw new Error(
      `Pre-check failed: expected ${L1_PLANS.length} Convergix L1s, found ${allProjects.length}. ` +
        `Aborting to avoid accidentally editing an unplanned record.`
    );
  }

  for (const plan of L1_PLANS) {
    const row = byPrefix.get(plan.idPrefix);
    if (!row) {
      throw new Error(
        `Pre-check failed: L1 with id prefix '${plan.idPrefix}' (${plan.name}) not found on Convergix.`
      );
    }
    if (row.name.trim() !== plan.name) {
      throw new Error(
        `Pre-check failed: L1 ${plan.idPrefix} name is "${row.name}", expected "${plan.name}".`
      );
    }
    const mismatches: string[] = [];
    if (row.status !== plan.pre.status) mismatches.push(`status:"${row.status}"≠"${plan.pre.status}"`);
    if (row.category !== plan.pre.category) mismatches.push(`category:"${row.category}"≠"${plan.pre.category}"`);
    if ((row.resources ?? null) !== plan.pre.resources) mismatches.push(`resources:"${row.resources}"≠"${plan.pre.resources}"`);
    if ((row.engagementType ?? null) !== plan.pre.engagementType)
      mismatches.push(`engagementType:"${row.engagementType}"≠"${plan.pre.engagementType}"`);
    if ((row.target ?? null) !== plan.pre.target) mismatches.push(`target:"${row.target}"≠"${plan.pre.target}"`);

    if (mismatches.length > 0) {
      throw new Error(
        `Pre-check failed: L1 ${plan.idPrefix} (${plan.name}) drift from expected pre-state: ${mismatches.join(", ")}`
      );
    }
  }
  ctx.log(`Pre-checks passed. ${L1_PLANS.length} L1s at expected pre-state.`);

  // Step 2 — Apply changes per L1 plan.
  let resourcesWrites = 0;
  let targetClears = 0;
  let statusFlips = 0;
  let categoryWrites = 0;
  let engagementWrites = 0;

  for (const plan of L1_PLANS) {
    const row = byPrefix.get(plan.idPrefix)!; // non-null: pre-checks passed
    ctx.log(`--- L1: ${plan.name} (${plan.idPrefix}) ---`);

    // 2a — resources
    if (plan.target.resources !== undefined && plan.target.resources !== plan.pre.resources) {
      const newResources = plan.target.resources;
      if (newResources === null || newResources === "") {
        // Null resources: not used in this migration but guarded for completeness.
        ctx.log(`  resources → null (raw UPDATE)`);
        if (!ctx.dryRun) {
          await ctx.db
            .update(projects)
            .set({ resources: null, updatedAt: new Date() })
            .where(eq(projects.id, row.id));

          await insertAuditRecord({
            idempotencyKey: generateIdempotencyKey("field-change", row.id, "resources", "(null)", UPDATED_BY),
            projectId: row.id,
            clientId: client.id,
            updatedBy: UPDATED_BY,
            updateType: "field-change",
            previousValue: row.resources,
            newValue: null,
            summary: `${client.name} / ${plan.name}: resources changed from "${row.resources}" to null`,
            metadata: JSON.stringify({ field: "resources" }),
          });
        }
      } else {
        ctx.log(`  resources: "${plan.pre.resources}" → "${newResources}"`);
        if (!ctx.dryRun) {
          const result = await updateProjectField({
            clientSlug: CLIENT_SLUG,
            projectName: plan.name,
            field: "resources",
            newValue: newResources,
            updatedBy: UPDATED_BY,
          });
          if (!result.ok) throw new Error(`Update ${plan.idPrefix}.resources failed: ${result.error}`);
        }
      }
      resourcesWrites++;
    }

    // 2b — clear target
    if (plan.target.clearTarget && plan.pre.target !== null) {
      ctx.log(`  target: "${plan.pre.target}" → null (raw UPDATE — v4 deprecates target)`);
      if (!ctx.dryRun) {
        await ctx.db
          .update(projects)
          .set({ target: null, updatedAt: new Date() })
          .where(eq(projects.id, row.id));

        await insertAuditRecord({
          idempotencyKey: generateIdempotencyKey("field-change", row.id, "target", "(null)", UPDATED_BY),
          projectId: row.id,
          clientId: client.id,
          updatedBy: UPDATED_BY,
          updateType: "field-change",
          previousValue: plan.pre.target,
          newValue: null,
          summary: `${client.name} / ${plan.name}: target changed from "${plan.pre.target}" to null (v4 deprecation)`,
          metadata: JSON.stringify({ field: "target" }),
        });
      }
      targetClears++;
    }

    // 2c — status (only one L1 in this migration flips status)
    if (plan.target.status !== undefined && plan.target.status !== plan.pre.status) {
      ctx.log(`  status: "${plan.pre.status}" → "${plan.target.status}"`);
      if (!ctx.dryRun) {
        const result = await updateProjectStatus({
          clientSlug: CLIENT_SLUG,
          projectName: plan.name,
          newStatus: plan.target.status,
          updatedBy: UPDATED_BY,
          notes: "v4 realign: L2 in-progress drives L1 status flip",
        });
        if (!result.ok) throw new Error(`Status flip ${plan.idPrefix} failed: ${result.error}`);
      }
      statusFlips++;
    }

    // 2d — category
    if (plan.target.category !== undefined && plan.target.category !== plan.pre.category) {
      ctx.log(`  category: "${plan.pre.category}" → "${plan.target.category}"`);
      if (!ctx.dryRun) {
        const result = await updateProjectField({
          clientSlug: CLIENT_SLUG,
          projectName: plan.name,
          field: "category",
          newValue: plan.target.category,
          updatedBy: UPDATED_BY,
        });
        if (!result.ok) throw new Error(`Category flip ${plan.idPrefix} failed: ${result.error}`);
      }
      categoryWrites++;
    }

    // 2e — engagement_type (not on PROJECT_FIELDS whitelist — raw UPDATE + audit)
    if (plan.target.engagementType !== plan.pre.engagementType) {
      ctx.log(`  engagement_type: "${plan.pre.engagementType}" → "${plan.target.engagementType}"`);
      if (!ctx.dryRun) {
        await ctx.db
          .update(projects)
          .set({ engagementType: plan.target.engagementType, updatedAt: new Date() })
          .where(eq(projects.id, row.id));

        await insertAuditRecord({
          idempotencyKey: generateIdempotencyKey(
            "field-change",
            row.id,
            "engagementType",
            plan.target.engagementType,
            UPDATED_BY
          ),
          projectId: row.id,
          clientId: client.id,
          updatedBy: UPDATED_BY,
          updateType: "field-change",
          previousValue: plan.pre.engagementType,
          newValue: plan.target.engagementType,
          summary: `${client.name} / ${plan.name}: engagement_type set to "${plan.target.engagementType}" (v4 new column)`,
          metadata: JSON.stringify({ field: "engagementType" }),
        });
      }
      engagementWrites++;
    }
  }

  ctx.log("");
  ctx.log("--- Planned writes summary ---");
  ctx.log(`  resources writes:        ${resourcesWrites}`);
  ctx.log(`  target clears:           ${targetClears}`);
  ctx.log(`  status flips:            ${statusFlips}`);
  ctx.log(`  category writes:         ${categoryWrites}`);
  ctx.log(`  engagement_type writes:  ${engagementWrites}`);
  ctx.log(
    `  TOTAL record ops:        ${resourcesWrites + targetClears + statusFlips + categoryWrites + engagementWrites}`
  );

  if (!ctx.dryRun) {
    await verify(ctx);
  }

  ctx.log("=== Convergix v4 Realign complete ===");
}

// ── Verification (apply mode only) ──────────────────────

async function verify(ctx: MigrationContext): Promise<void> {
  ctx.log("--- Verification ---");

  const lookup = await getClientOrFail(CLIENT_SLUG);
  if (!lookup.ok) throw new Error(`Verify failed: ${lookup.error}`);
  const client = lookup.client;

  for (const plan of L1_PLANS) {
    const p = await findProjectByFuzzyName(client.id, plan.name);
    if (!p) throw new Error(`VERIFICATION FAILED: L1 '${plan.name}' not found after apply.`);

    if (p.engagementType !== plan.target.engagementType) {
      throw new Error(
        `VERIFICATION FAILED: ${plan.name} engagementType is "${p.engagementType}", expected "${plan.target.engagementType}".`
      );
    }
    if (plan.target.clearTarget && p.target !== null) {
      throw new Error(
        `VERIFICATION FAILED: ${plan.name} target is "${p.target}", expected null (v4 deprecation).`
      );
    }
    if (plan.target.resources !== undefined) {
      const expectedResources = plan.target.resources === "" ? null : plan.target.resources;
      if ((p.resources ?? null) !== expectedResources) {
        throw new Error(
          `VERIFICATION FAILED: ${plan.name} resources is "${p.resources}", expected "${expectedResources}".`
        );
      }
    }
    if (plan.target.status !== undefined && p.status !== plan.target.status) {
      throw new Error(
        `VERIFICATION FAILED: ${plan.name} status is "${p.status}", expected "${plan.target.status}".`
      );
    }
    if (plan.target.category !== undefined && p.category !== plan.target.category) {
      throw new Error(
        `VERIFICATION FAILED: ${plan.name} category is "${p.category}", expected "${plan.target.category}".`
      );
    }
  }

  ctx.log(`Verification passed for ${L1_PLANS.length} L1s.`);
}
