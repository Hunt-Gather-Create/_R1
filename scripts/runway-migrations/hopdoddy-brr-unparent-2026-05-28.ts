/**
 * Hopdoddy — Unparent "Brand Refresh Revisions" L2 → top-level L1
 *
 * ───────────────────────────────────────────────────────────
 * WHY
 *
 * Runway's Gantt classifies a project as a "wrapper" when ALL of:
 *   parentProjectId === null
 *   engagementType === "retainer"
 *   childProjects.length > 0
 *
 * When classified as wrapper, the project's direct work items become
 * invisible "orphans" — only its L2 sub-projects render as Gantt rows.
 *
 * Hopdoddy's "Digital Retainer (195 hrs)" (bc55c0b7) has exactly ONE L2
 * sub-project: "Brand Refresh Revisions" (678b8f1e, completed). That
 * single L2 trips the wrapper classification and erases the retainer's
 * 19 direct work items from the Gantt, including the 7 new June/July
 * items created in last night's hopdoddy-status-doc-align-2026-05-28.
 *
 * Audit across all 14 clients confirms Hopdoddy is the ONLY client with
 * a retainer carrying both L2 children AND direct WIs — every other
 * retainer is either no-L2-children (renders fine) or no-direct-WIs
 * (nothing to lose).
 *
 * ───────────────────────────────────────────────────────────
 * FIX
 *
 * Single field change on one project row:
 *   projects.parentProjectId WHERE id = '678b8f1e...': bc55c0b7... → null
 *
 * Result: Brand Refresh Revisions becomes a top-level completed L1 sibling
 * of Digital Retainer. Digital Retainer reverts to kind='l1' (no L2
 * children). All 19 direct retainer WIs render.
 *
 * ───────────────────────────────────────────────────────────
 * SAFETY
 *
 * - validateParentProjectIdAssignment short-circuits on newParentId=null,
 *   so no cross-client / cycle / non-retainer parent rejections to worry
 *   about (operations-utils.ts:1386).
 * - updateProjectField does NOT trigger date recompute on parent change
 *   (no recomputeProjectDatesWith calls in the parentProjectId branch).
 * - Brand Refresh Revisions own dates (2026-05-11 → 2026-05-21) are
 *   preserved by the helper.
 * - Digital Retainer's existing date envelope (2026-01-01 → 2026-12-31)
 *   is not touched.
 * - Audit row written via the helper's standard path with updatedBy below.
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve as resolvePath, dirname } from "node:path";
import { eq } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { clients, projects, weekItems } from "@/lib/db/runway-schema";
import { updateProjectField } from "@/lib/runway/operations-writes-project";

// ── Constants ────────────────────────────────────────────

const HOPDODDY_SLUG = "hopdoddy";
const UPDATED_BY = "hopdoddy-brr-unparent-2026-05-28";

const L1_RETAINER_ID = "bc55c0b734df418cb308e79d3";
const L1_RETAINER_NAME = "Digital Retainer (195 hrs)";

const L2_BRR_ID = "678b8f1e880940a0aafb44386";
const L2_BRR_NAME = "Brand Refresh Revisions";

const PRE_SNAPSHOT_PATH = "docs/tmp/hopdoddy-brr-unparent-pre-2026-05-28.json";
const POST_SNAPSHOT_PATH = "docs/tmp/hopdoddy-brr-unparent-post-2026-05-28.json";

// ── Migration ────────────────────────────────────────────

export const description =
  "Hopdoddy — Unparent Brand Refresh Revisions L2 → top-level L1 to unblock retainer-direct WI rendering";

export async function up(ctx: MigrationContext): Promise<void> {
  // Step 1 — Pre-check current state
  ctx.log("--- Step 1: Pre-check ---");
  const r = await preChecks(ctx);

  // Step 2 — Snapshot pre-state
  if (!ctx.dryRun) {
    await snapshot(ctx, PRE_SNAPSHOT_PATH);
    ctx.log(`  Pre-snapshot written: ${PRE_SNAPSHOT_PATH}`);
  } else {
    ctx.log("  [DRY] would write pre-snapshot");
  }

  // Step 3 — Single-field update: parentProjectId → null
  ctx.log("--- Step 2: Unparent Brand Refresh Revisions ---");
  ctx.log(
    `  Project ${L2_BRR_ID.slice(0, 8)} "${L2_BRR_NAME}" parentProjectId: ${r.currentParentId ?? "(null)"} → (null)`,
  );
  if (!ctx.dryRun) {
    const res = await updateProjectField({
      clientSlug: HOPDODDY_SLUG,
      projectName: L2_BRR_NAME,
      field: "parentProjectId",
      newValue: "", // empty string → null per operations-writes-project.ts:197-208
      updatedBy: UPDATED_BY,
    });
    if (!res.ok) {
      throw new Error(`parentProjectId update failed: ${res.error}`);
    }
  }

  // Step 4 — Verify
  ctx.log("--- Step 3: Verify ---");
  if (!ctx.dryRun) {
    await verify(ctx);
    await snapshot(ctx, POST_SNAPSHOT_PATH);
    ctx.log(`  Post-snapshot written: ${POST_SNAPSHOT_PATH}`);
  } else {
    ctx.log("  [DRY] would verify + write post-snapshot");
  }

  ctx.log("--- Done ---");
}

// ── Helpers ──────────────────────────────────────────────

interface PreCheckResult {
  currentParentId: string | null;
}

async function preChecks(ctx: MigrationContext): Promise<PreCheckResult> {
  const [client] = await ctx.db.select().from(clients).where(eq(clients.slug, HOPDODDY_SLUG));
  if (!client) throw new Error(`Hopdoddy client not found.`);

  const [brr] = await ctx.db.select().from(projects).where(eq(projects.id, L2_BRR_ID));
  if (!brr) throw new Error(`Brand Refresh Revisions (id=${L2_BRR_ID}) not found.`);
  if (brr.name !== L2_BRR_NAME) {
    throw new Error(
      `Brand Refresh Revisions name drift: expected '${L2_BRR_NAME}', got '${brr.name}'.`,
    );
  }
  if (brr.clientId !== client.id) {
    throw new Error(
      `Brand Refresh Revisions clientId drift: expected '${client.id}', got '${brr.clientId}'.`,
    );
  }
  if (brr.parentProjectId !== L1_RETAINER_ID) {
    throw new Error(
      `Brand Refresh Revisions parentProjectId drift: expected '${L1_RETAINER_ID}' (Digital Retainer), got '${brr.parentProjectId ?? "(null)"}'.`,
    );
  }

  const [retainer] = await ctx.db.select().from(projects).where(eq(projects.id, L1_RETAINER_ID));
  if (!retainer) throw new Error(`Digital Retainer (id=${L1_RETAINER_ID}) not found.`);
  if (retainer.engagementType !== "retainer") {
    throw new Error(
      `Digital Retainer engagementType drift: expected 'retainer', got '${retainer.engagementType}'.`,
    );
  }

  const allHopdoddyProjects = await ctx.db
    .select()
    .from(projects)
    .where(eq(projects.clientId, client.id));
  const currentL2sUnderRetainer = allHopdoddyProjects.filter(
    (p) => p.parentProjectId === L1_RETAINER_ID,
  );

  ctx.log(`  Hopdoddy client: ${client.id}`);
  ctx.log(
    `  Digital Retainer ${L1_RETAINER_ID.slice(0, 8)}: engagementType=retainer, current L2 children=${currentL2sUnderRetainer.length}`,
  );
  ctx.log(
    `  Brand Refresh Revisions ${L2_BRR_ID.slice(0, 8)}: parentProjectId=${brr.parentProjectId ?? "(null)"}, status=${brr.status}, dates=${brr.startDate}→${brr.endDate}`,
  );

  if (currentL2sUnderRetainer.length !== 1) {
    throw new Error(
      `Expected exactly 1 L2 under Digital Retainer (Brand Refresh Revisions). Found ${currentL2sUnderRetainer.length}: ${currentL2sUnderRetainer.map((p) => `${p.id.slice(0, 8)} '${p.name}'`).join(", ")}. Manual review required.`,
    );
  }

  return { currentParentId: brr.parentProjectId };
}

async function verify(ctx: MigrationContext): Promise<void> {
  const [brr] = await ctx.db.select().from(projects).where(eq(projects.id, L2_BRR_ID));
  if (!brr) throw new Error(`Post-state: Brand Refresh Revisions disappeared.`);
  if (brr.parentProjectId !== null) {
    throw new Error(
      `Post-state: parentProjectId='${brr.parentProjectId}', expected null.`,
    );
  }
  if (brr.name !== L2_BRR_NAME) {
    throw new Error(`Post-state: name drift: '${brr.name}' vs '${L2_BRR_NAME}'.`);
  }
  if (brr.startDate !== "2026-05-11" || brr.endDate !== "2026-05-21") {
    throw new Error(
      `Post-state: Brand Refresh Revisions dates drifted: ${brr.startDate}→${brr.endDate} (expected 2026-05-11→2026-05-21).`,
    );
  }

  // Confirm Digital Retainer now has zero L2 children → will classify as l1.
  const [client] = await ctx.db.select().from(clients).where(eq(clients.slug, HOPDODDY_SLUG));
  const allHopdoddyProjects = await ctx.db
    .select()
    .from(projects)
    .where(eq(projects.clientId, client.id));
  const l2sUnderRetainer = allHopdoddyProjects.filter(
    (p) => p.parentProjectId === L1_RETAINER_ID,
  );
  if (l2sUnderRetainer.length !== 0) {
    throw new Error(
      `Post-state: Digital Retainer still has ${l2sUnderRetainer.length} L2 child(ren). Wrapper classification not cleared.`,
    );
  }

  // Confirm retainer's direct WIs are still attached to the retainer.
  const directWis = await ctx.db
    .select()
    .from(weekItems)
    .where(eq(weekItems.projectId, L1_RETAINER_ID));
  ctx.log(`  Verified: Digital Retainer L2 children=0, direct WIs=${directWis.length}`);
  ctx.log(`  Verified: Brand Refresh Revisions parentProjectId=null, dates intact`);
}

async function snapshot(ctx: MigrationContext, relativePath: string): Promise<void> {
  const [client] = await ctx.db.select().from(clients).where(eq(clients.slug, HOPDODDY_SLUG));
  const allProjects = await ctx.db
    .select()
    .from(projects)
    .where(eq(projects.clientId, client.id));
  const allWis = await ctx.db
    .select()
    .from(weekItems)
    .where(eq(weekItems.clientId, client.id));

  const payload = {
    pulledAt: new Date().toISOString(),
    note: relativePath.includes("pre") ? "pre-unparent" : "post-unparent",
    client,
    projects: allProjects,
    weekItems: allWis,
  };
  const fullPath = resolvePath(process.cwd(), relativePath);
  if (!existsSync(dirname(fullPath))) mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, JSON.stringify(payload, null, 2));
}
