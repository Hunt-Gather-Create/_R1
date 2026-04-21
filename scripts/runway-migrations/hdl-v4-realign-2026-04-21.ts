/**
 * Migration: HDL v4 Realign — 2026-04-21
 *
 * PR #86 Wave 1 Batch B. Brings HDL's runway data to v4 convention.
 *
 * Scope (based on prod pre-scan 2026-04-20):
 *   - 1 L1 project: `HDL Website Build` (id prefix f9af3445)
 *   - 11 L2 week items (all linked; no orphans)
 *   - Client already carries v4-format team roster
 *
 * Operations (6 total):
 *   1. L1 rename: "HDL Website Build" → "Website Build" (drop client prefix per v4 title rule)
 *   2. L1 resources: "CD: Lane, Dev: Leslie" → "AM: Jill, CD: Lane, Dev: Leslie, PM: Jason"
 *      (engaged-roles-per-L1: full Civ roster for this engagement)
 *   3. L1 engagement_type: null → "project"  (raw update + audit — field not on PROJECT_FIELDS whitelist)
 *   4. L2 `Full Site Design Approval` (2c0f97a7): resources null → "HDL" (client-led approval)
 *   5. L2 `Ad Words` (b3eb2aea): resources null → "HDL" (client-led — Jamie Lincoln HDL side)
 *   6. L2 `Production Shoot` (5f1e1687): resources null → "HDL" (client-led shoot)
 *
 * Per spec (overnight-clients-v4-realign.md § "HDL — v4 realign + contract-expiry"):
 *   - contract_status='expired' on client is left as-is; Chunk 1 surfaces the
 *     expiry flag at read time.
 *   - engagement_type='project' on all HDL L1s (there is only one).
 *   - Full team roster on L1s.
 *
 * Pre-checks verify the prod pre-state matches the 2026-04-20 snapshot. Any
 * drift fails loudly. Writes a pre-apply snapshot before writes so the REVERT
 * script can restore exactly.
 *
 * Reverse script: hdl-v4-realign-2026-04-21-REVERT.ts
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve as resolvePath, dirname } from "node:path";
import { eq } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { clients, projects, weekItems } from "@/lib/db/runway-schema";
import {
  generateIdempotencyKey,
  getBatchId,
  insertAuditRecord,
  updateProjectField,
  updateWeekItemField,
} from "@/lib/runway/operations";

// ── Constants ────────────────────────────────────────────

const HDL_SLUG = "hdl";
const UPDATED_BY = "migration";

const L1_ID_PREFIX = "f9af3445";
const L1_OLD_NAME = "HDL Website Build";
const L1_NEW_NAME = "Website Build";
const L1_OLD_RESOURCES = "CD: Lane, Dev: Leslie";
const L1_NEW_RESOURCES = "AM: Jill, CD: Lane, Dev: Leslie, PM: Jason";
const L1_NEW_ENGAGEMENT_TYPE = "project";

/**
 * L2 resource fills. Each L2 here currently has resources=NULL and is a
 * client-led item (HDL performs the task). Per v4 convention, client-led
 * work uses the plain client name instead of a role-prefix.
 */
interface L2ResourceFill {
  idPrefix: string;
  expectedTitle: string;
  expectedWeekOf: string;
  newResources: string; // "HDL" for all three (client-led)
}

const L2_RESOURCE_FILLS: L2ResourceFill[] = [
  {
    idPrefix: "2c0f97a7",
    expectedTitle: "Full Site Design Approval",
    expectedWeekOf: "2026-04-27",
    newResources: "HDL",
  },
  {
    idPrefix: "b3eb2aea",
    expectedTitle: "Ad Words",
    expectedWeekOf: "2026-05-11",
    newResources: "HDL",
  },
  {
    idPrefix: "5f1e1687",
    expectedTitle: "Production Shoot",
    expectedWeekOf: "2026-06-15",
    newResources: "HDL",
  },
];

// ── Exports ──────────────────────────────────────────────

export const description =
  "HDL v4 realign 2026-04-21: rename L1 (drop HDL prefix), expand L1 resources to full engaged roster, set engagement_type=project, fill 3 client-led L2 resources.";

interface ResolvedState {
  client: typeof clients.$inferSelect;
  l1: typeof projects.$inferSelect;
  l2sByPrefix: Map<string, typeof weekItems.$inferSelect>;
}

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("=== HDL v4 Realign (2026-04-21) ===");

  // Step 1 — pre-checks + resolve current state from prod
  const resolved = await preChecks(ctx);

  // Step 2 — pre-apply snapshot (used by REVERT)
  writeSnapshot(ctx, resolved);

  if (ctx.dryRun) {
    ctx.log("Dry-run: no writes will be performed. Operation plan follows.");
  }

  // Step 3 — rename L1 (drop "HDL " prefix)
  ctx.log(`L1 ${L1_ID_PREFIX}: name "${L1_OLD_NAME}" → "${L1_NEW_NAME}"`);
  if (!ctx.dryRun) {
    const result = await updateProjectField({
      clientSlug: HDL_SLUG,
      projectName: L1_OLD_NAME,
      field: "name",
      newValue: L1_NEW_NAME,
      updatedBy: UPDATED_BY,
    });
    if (!result.ok) throw new Error(`Rename L1 failed: ${result.error}`);
  }

  // Step 4 — expand L1 resources to engaged-roles-per-L1 roster
  //         Must use the NEW name because rename already landed.
  ctx.log(`L1 ${L1_ID_PREFIX}: resources "${L1_OLD_RESOURCES}" → "${L1_NEW_RESOURCES}"`);
  if (!ctx.dryRun) {
    const result = await updateProjectField({
      clientSlug: HDL_SLUG,
      projectName: L1_NEW_NAME,
      field: "resources",
      newValue: L1_NEW_RESOURCES,
      updatedBy: UPDATED_BY,
    });
    if (!result.ok) throw new Error(`Update L1 resources failed: ${result.error}`);
  }

  // Step 5 — set engagement_type='project' on L1 (raw update, field not on
  //         PROJECT_FIELDS whitelist; insertAuditRecord keeps audit trail intact)
  ctx.log(`L1 ${L1_ID_PREFIX}: engagement_type null → "${L1_NEW_ENGAGEMENT_TYPE}"`);
  if (!ctx.dryRun) {
    await ctx.db
      .update(projects)
      .set({ engagementType: L1_NEW_ENGAGEMENT_TYPE, updatedAt: new Date() })
      .where(eq(projects.id, resolved.l1.id));

    const idemKey = generateIdempotencyKey(
      "field-change",
      resolved.l1.id,
      "engagement_type",
      L1_NEW_ENGAGEMENT_TYPE,
      UPDATED_BY
    );
    await insertAuditRecord({
      idempotencyKey: idemKey,
      projectId: resolved.l1.id,
      clientId: resolved.client.id,
      updatedBy: UPDATED_BY,
      updateType: "field-change",
      previousValue: "(null)",
      newValue: L1_NEW_ENGAGEMENT_TYPE,
      summary: `Project '${L1_NEW_NAME}': engagement_type changed from null to "${L1_NEW_ENGAGEMENT_TYPE}"`,
      metadata: JSON.stringify({ field: "engagement_type" }),
    });
  }

  // Step 6 — fill client-led L2 resources (3 items currently null)
  for (const fill of L2_RESOURCE_FILLS) {
    const row = resolved.l2sByPrefix.get(fill.idPrefix);
    if (!row) throw new Error(`Missing resolved L2 ${fill.idPrefix}`);
    ctx.log(
      `L2 ${fill.idPrefix} (${fill.expectedTitle}): resources null → "${fill.newResources}"`
    );
    if (!ctx.dryRun) {
      const result = await updateWeekItemField({
        weekOf: fill.expectedWeekOf,
        weekItemTitle: fill.expectedTitle,
        field: "resources",
        newValue: fill.newResources,
        updatedBy: UPDATED_BY,
      });
      if (!result.ok) {
        throw new Error(`Update L2 ${fill.idPrefix} resources failed: ${result.error}`);
      }
    }
  }

  // Step 7 — verification
  if (!ctx.dryRun) {
    await verify(ctx, resolved);
  }

  ctx.log("=== HDL v4 Realign complete ===");
}

// ── Pre-checks ───────────────────────────────────────────

async function preChecks(ctx: MigrationContext): Promise<ResolvedState> {
  ctx.log("--- Pre-checks ---");

  // Resolve client
  const clientRows = await ctx.db.select().from(clients).where(eq(clients.slug, HDL_SLUG));
  const client = clientRows[0];
  if (!client) throw new Error(`Pre-check failed: client '${HDL_SLUG}' not found.`);
  ctx.log(`Client: ${client.name} (${client.id})`);

  // Resolve all HDL projects; must be exactly 1
  const projectRows = await ctx.db
    .select()
    .from(projects)
    .where(eq(projects.clientId, client.id));
  if (projectRows.length !== 1) {
    throw new Error(
      `Pre-check failed: expected exactly 1 HDL project, got ${projectRows.length}.`
    );
  }
  const l1 = projectRows[0];

  if (!l1.id.startsWith(L1_ID_PREFIX)) {
    throw new Error(
      `Pre-check failed: HDL L1 id "${l1.id}" does not start with expected prefix "${L1_ID_PREFIX}". DB drift since snapshot.`
    );
  }
  if (l1.name !== L1_OLD_NAME) {
    throw new Error(
      `Pre-check failed: HDL L1 name is "${l1.name}", expected "${L1_OLD_NAME}". DB drift — abort.`
    );
  }
  if (l1.resources !== L1_OLD_RESOURCES) {
    throw new Error(
      `Pre-check failed: HDL L1 resources is "${l1.resources}", expected "${L1_OLD_RESOURCES}". DB drift — abort.`
    );
  }
  if (l1.engagementType !== null) {
    throw new Error(
      `Pre-check failed: HDL L1 engagement_type is "${l1.engagementType}", expected null. DB drift — abort.`
    );
  }
  ctx.log(`L1 resolved: ${l1.id} ("${l1.name}")`);

  // Resolve all HDL week items; must be exactly 11
  const l2Rows = await ctx.db
    .select()
    .from(weekItems)
    .where(eq(weekItems.clientId, client.id));
  if (l2Rows.length !== 11) {
    throw new Error(
      `Pre-check failed: expected exactly 11 HDL week items, got ${l2Rows.length}.`
    );
  }
  const l2sByPrefix = new Map<string, typeof weekItems.$inferSelect>();
  for (const row of l2Rows) {
    const prefix = row.id.slice(0, 8);
    l2sByPrefix.set(prefix, row);
  }

  // Validate the 3 L2s we plan to update: title, weekOf, and resources=null
  for (const fill of L2_RESOURCE_FILLS) {
    const row = l2sByPrefix.get(fill.idPrefix);
    if (!row) {
      throw new Error(
        `Pre-check failed: no HDL L2 with id prefix "${fill.idPrefix}" (expected "${fill.expectedTitle}").`
      );
    }
    if (row.title !== fill.expectedTitle) {
      throw new Error(
        `Pre-check failed: L2 ${fill.idPrefix} title is "${row.title}", expected "${fill.expectedTitle}". Abort.`
      );
    }
    if (row.weekOf !== fill.expectedWeekOf) {
      throw new Error(
        `Pre-check failed: L2 ${fill.idPrefix} weekOf is "${row.weekOf}", expected "${fill.expectedWeekOf}". Abort.`
      );
    }
    if (row.resources !== null) {
      throw new Error(
        `Pre-check failed: L2 ${fill.idPrefix} resources is "${row.resources}", expected null. Abort.`
      );
    }
  }

  ctx.log(
    `Pre-checks passed. Ready to apply 6 ops (L1 rename + L1 resources + L1 engagement_type + 3x L2 resources).`
  );

  return { client, l1, l2sByPrefix };
}

// ── Snapshot ─────────────────────────────────────────────

function writeSnapshot(ctx: MigrationContext, r: ResolvedState): void {
  const capturedAt = new Date().toISOString();
  const snapshot = {
    capturedAt,
    mode: ctx.dryRun ? "dry-run" : "apply",
    batchId: getBatchId(),
    client: r.client,
    l1BeforeUpdate: r.l1,
    l2sBeforeUpdate: L2_RESOURCE_FILLS.map((f) => r.l2sByPrefix.get(f.idPrefix)),
    plannedL1: {
      id: r.l1.id,
      name: L1_NEW_NAME,
      resources: L1_NEW_RESOURCES,
      engagementType: L1_NEW_ENGAGEMENT_TYPE,
    },
    plannedL2s: L2_RESOURCE_FILLS,
  };

  const suffix = ctx.dryRun ? "-dryrun" : "";
  const outPath = resolvePath(
    process.cwd(),
    `docs/tmp/hdl-v4-pre-apply-snapshot-2026-04-21${suffix}.json`
  );
  const dir = dirname(outPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2), "utf8");
  ctx.log(`Wrote pre-apply snapshot → ${outPath}`);
}

// ── Verification ─────────────────────────────────────────

async function verify(ctx: MigrationContext, r: ResolvedState): Promise<void> {
  ctx.log("--- Verification ---");

  const l1After = (
    await ctx.db.select().from(projects).where(eq(projects.id, r.l1.id))
  )[0];
  if (!l1After) throw new Error("VERIFICATION FAILED: L1 row not found.");
  if (l1After.name !== L1_NEW_NAME) {
    throw new Error(
      `VERIFICATION FAILED: L1 name is "${l1After.name}", expected "${L1_NEW_NAME}".`
    );
  }
  if (l1After.resources !== L1_NEW_RESOURCES) {
    throw new Error(
      `VERIFICATION FAILED: L1 resources is "${l1After.resources}", expected "${L1_NEW_RESOURCES}".`
    );
  }
  if (l1After.engagementType !== L1_NEW_ENGAGEMENT_TYPE) {
    throw new Error(
      `VERIFICATION FAILED: L1 engagement_type is "${l1After.engagementType}", expected "${L1_NEW_ENGAGEMENT_TYPE}".`
    );
  }

  for (const fill of L2_RESOURCE_FILLS) {
    const row = r.l2sByPrefix.get(fill.idPrefix)!;
    const after = (
      await ctx.db.select().from(weekItems).where(eq(weekItems.id, row.id))
    )[0];
    if (!after) {
      throw new Error(`VERIFICATION FAILED: L2 ${fill.idPrefix} row not found.`);
    }
    if (after.resources !== fill.newResources) {
      throw new Error(
        `VERIFICATION FAILED: L2 ${fill.idPrefix} resources is "${after.resources}", expected "${fill.newResources}".`
      );
    }
  }

  ctx.log("Verification passed.");
}
