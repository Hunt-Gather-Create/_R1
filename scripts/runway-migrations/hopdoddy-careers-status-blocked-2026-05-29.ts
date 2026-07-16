/**
 * Hopdoddy — Careers Page: Refresh WI status: scheduled → blocked
 *
 * WHY
 * The Hopdoddy Status Doc lists "Careers Page: Refresh" as Pending Info
 * (waiting on Hopdoddy's brief + evergreen blog). Prod has it `scheduled`.
 * The morning state report flagged this 2026-05-28 as a known
 * status-alignment gap; this migration closes it.
 *
 * FIX
 * Single field change on one WI:
 *   weekItems.status WHERE id = 'fce05af3...': 'scheduled' → 'blocked'
 *
 * SAFETY
 * - validateWeekItemStatus accepts 'blocked' (operations-writes-week.ts:465).
 * - WI status has no project-cascade behavior (CASCADE_STATUSES applies to
 *   L1→L2 project status, not WI→project).
 * - No dates touched, so no recompute fires.
 * - Audit row written via the helper's standard path.
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve as resolvePath, dirname } from "node:path";
import { eq } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { clients, projects, weekItems } from "@/lib/db/runway-schema";
import { updateWeekItemField } from "@/lib/runway/operations-writes-week";

const HOPDODDY_SLUG = "hopdoddy";
const UPDATED_BY = "hopdoddy-careers-status-blocked-2026-05-29";

const CAREERS_WI_ID = "fce05af3b34248afa0a5ecb62";
const CAREERS_WI_TITLE = "Careers Page: Refresh";
const CAREERS_WI_WEEK_OF = "2026-07-13";
const CAREERS_NEW_STATUS = "blocked";
const CAREERS_EXPECTED_OLD_STATUS = "scheduled";

const PRE_SNAPSHOT_PATH =
  "docs/tmp/hopdoddy-careers-status-blocked-pre-2026-05-29.json";
const POST_SNAPSHOT_PATH =
  "docs/tmp/hopdoddy-careers-status-blocked-post-2026-05-29.json";

export const description =
  "Hopdoddy — Careers Page: Refresh WI status: scheduled → blocked (matches Status Doc Pending Info)";

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("--- Step 1: Pre-check ---");
  await preChecks(ctx);

  if (!ctx.dryRun) {
    await snapshot(ctx, PRE_SNAPSHOT_PATH);
    ctx.log(`  Pre-snapshot written: ${PRE_SNAPSHOT_PATH}`);
  } else {
    ctx.log("  [DRY] would write pre-snapshot");
  }

  ctx.log("--- Step 2: Status update ---");
  ctx.log(
    `  WI ${CAREERS_WI_ID.slice(0, 8)} "${CAREERS_WI_TITLE}" status: ${CAREERS_EXPECTED_OLD_STATUS} → ${CAREERS_NEW_STATUS}`
  );
  if (!ctx.dryRun) {
    const res = await updateWeekItemField({
      weekOf: CAREERS_WI_WEEK_OF,
      weekItemTitle: CAREERS_WI_TITLE,
      field: "status",
      newValue: CAREERS_NEW_STATUS,
      updatedBy: UPDATED_BY,
      source: "migration",
    });
    if (!res.ok) {
      throw new Error(`Careers status update failed: ${res.error}`);
    }
  }

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

async function preChecks(ctx: MigrationContext): Promise<void> {
  const [client] = await ctx.db
    .select()
    .from(clients)
    .where(eq(clients.slug, HOPDODDY_SLUG));
  if (!client) throw new Error(`Hopdoddy client not found.`);

  const [wi] = await ctx.db
    .select()
    .from(weekItems)
    .where(eq(weekItems.id, CAREERS_WI_ID));
  if (!wi)
    throw new Error(
      `Careers Page: Refresh WI (id=${CAREERS_WI_ID}) not found.`
    );
  if (wi.title !== CAREERS_WI_TITLE) {
    throw new Error(
      `Careers WI title drift: expected '${CAREERS_WI_TITLE}', got '${wi.title}'.`
    );
  }
  if (wi.weekOf !== CAREERS_WI_WEEK_OF) {
    throw new Error(
      `Careers WI weekOf drift: expected '${CAREERS_WI_WEEK_OF}', got '${wi.weekOf}'.`
    );
  }
  if (wi.status !== CAREERS_EXPECTED_OLD_STATUS) {
    throw new Error(
      `Careers WI status drift: expected '${CAREERS_EXPECTED_OLD_STATUS}', got '${wi.status}'.`
    );
  }
  if (wi.clientId !== client.id) {
    throw new Error(
      `Careers WI clientId drift: expected '${client.id}', got '${wi.clientId}'.`
    );
  }
  ctx.log(
    `  Careers WI ${CAREERS_WI_ID.slice(0, 8)}: title='${wi.title}', weekOf=${wi.weekOf}, status=${wi.status}, dates=${wi.startDate}→${wi.endDate}`
  );
}

async function verify(ctx: MigrationContext): Promise<void> {
  const [wi] = await ctx.db
    .select()
    .from(weekItems)
    .where(eq(weekItems.id, CAREERS_WI_ID));
  if (!wi) throw new Error(`Post-state: Careers WI disappeared.`);
  if (wi.status !== CAREERS_NEW_STATUS) {
    throw new Error(
      `Post-state: status='${wi.status}', expected '${CAREERS_NEW_STATUS}'.`
    );
  }
  if (wi.startDate !== "2026-06-15" || wi.endDate !== "2026-07-15") {
    throw new Error(
      `Post-state: dates drifted: ${wi.startDate}→${wi.endDate} (expected 2026-06-15→2026-07-15).`
    );
  }
  if (wi.title !== CAREERS_WI_TITLE) {
    throw new Error(`Post-state: title drift: '${wi.title}'.`);
  }
  ctx.log(`  Verified: status=blocked, dates intact, title unchanged`);
}

async function snapshot(
  ctx: MigrationContext,
  relativePath: string
): Promise<void> {
  const [client] = await ctx.db
    .select()
    .from(clients)
    .where(eq(clients.slug, HOPDODDY_SLUG));
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
    note: relativePath.includes("pre") ? "pre-status-flip" : "post-status-flip",
    client,
    projects: allProjects,
    weekItems: allWis,
  };
  const fullPath = resolvePath(process.cwd(), relativePath);
  if (!existsSync(dirname(fullPath)))
    mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, JSON.stringify(payload, null, 2));
}
