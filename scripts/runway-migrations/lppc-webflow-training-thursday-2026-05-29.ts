/**
 * LPPC — Move "Webflow Training: Bill" Fri 6/5 → Thu 6/4
 *
 * Operator update (2026-05-29): training session officially confirmed for
 * next Thursday with Bill, not Friday.
 *
 * Direction: BACKWARD (6/5 → 6/4). Per feedback_l2_date_write_ordering:
 * write startDate FIRST so cross-field validator (sd ≤ ed) stays satisfied
 * at intermediate state.
 *
 *   Old: sd=6/5, ed=6/5
 *   Step 1: sd=6/4, ed=6/5 (6/4 ≤ 6/5 ✓)
 *   Step 2: sd=6/4, ed=6/4 (6/4 ≤ 6/4 ✓)
 *
 * Also updates dayOfWeek friday → thursday. weekOf unchanged (2026-06-01).
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve as resolvePath, dirname } from "node:path";
import { eq } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { clients, projects, weekItems } from "@/lib/db/runway-schema";
import { updateWeekItemField } from "@/lib/runway/operations-writes-week";

const LPPC_SLUG = "lppc";
const UPDATED_BY = "lppc-webflow-training-thursday-2026-05-29";

const WI_TITLE = "Webflow Training: Bill";
const WI_WEEK_OF = "2026-06-01";
const OLD_START = "2026-06-05";
const OLD_END = "2026-06-05";
const OLD_DOW = "friday";
const NEW_START = "2026-06-04";
const NEW_END = "2026-06-04";
const NEW_DOW = "thursday";

const PRE_SNAPSHOT_PATH =
  "docs/tmp/lppc-webflow-training-thursday-pre-2026-05-29.json";
const POST_SNAPSHOT_PATH =
  "docs/tmp/lppc-webflow-training-thursday-post-2026-05-29.json";

export const description =
  "LPPC — Move Webflow Training: Bill from Friday 6/5 to Thursday 6/4";

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("--- Step 1: Pre-check ---");
  await preChecks(ctx);

  if (!ctx.dryRun) {
    await snapshot(ctx, PRE_SNAPSHOT_PATH);
    ctx.log(`  Pre-snapshot written: ${PRE_SNAPSHOT_PATH}`);
  } else {
    ctx.log("  [DRY] would write pre-snapshot");
  }

  // Step 2a — startDate FIRST (backward move)
  ctx.log(
    `--- Step 2a: startDate ${OLD_START} → ${NEW_START} (FIRST — backward) ---`
  );
  if (!ctx.dryRun) {
    const r = await updateWeekItemField({
      weekOf: WI_WEEK_OF,
      weekItemTitle: WI_TITLE,
      field: "startDate",
      newValue: NEW_START,
      updatedBy: UPDATED_BY,
      source: "migration",
    });
    if (!r.ok) throw new Error(`startDate update failed: ${r.error}`);
  }

  // Step 2b — endDate
  ctx.log(`--- Step 2b: endDate ${OLD_END} → ${NEW_END} ---`);
  if (!ctx.dryRun) {
    const r = await updateWeekItemField({
      weekOf: WI_WEEK_OF,
      weekItemTitle: WI_TITLE,
      field: "endDate",
      newValue: NEW_END,
      updatedBy: UPDATED_BY,
      source: "migration",
    });
    if (!r.ok) throw new Error(`endDate update failed: ${r.error}`);
  }

  // Step 2c — dayOfWeek
  ctx.log(`--- Step 2c: dayOfWeek ${OLD_DOW} → ${NEW_DOW} ---`);
  if (!ctx.dryRun) {
    const r = await updateWeekItemField({
      weekOf: WI_WEEK_OF,
      weekItemTitle: WI_TITLE,
      field: "dayOfWeek",
      newValue: NEW_DOW,
      updatedBy: UPDATED_BY,
      source: "migration",
    });
    if (!r.ok) throw new Error(`dayOfWeek update failed: ${r.error}`);
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
    .where(eq(clients.slug, LPPC_SLUG));
  if (!client) throw new Error(`LPPC client not found.`);

  const [wi] = await ctx.db
    .select()
    .from(weekItems)
    .where(eq(weekItems.title, WI_TITLE));
  if (!wi) throw new Error(`WI "${WI_TITLE}" not found.`);
  if (wi.clientId !== client.id) throw new Error(`WI clientId drift.`);
  if (wi.weekOf !== WI_WEEK_OF)
    throw new Error(`WI weekOf drift: '${wi.weekOf}'.`);
  if (wi.startDate !== OLD_START)
    throw new Error(`WI startDate drift: '${wi.startDate}'.`);
  if (wi.endDate !== OLD_END)
    throw new Error(`WI endDate drift: '${wi.endDate}'.`);
  if (wi.dayOfWeek !== OLD_DOW)
    throw new Error(`WI dayOfWeek drift: '${wi.dayOfWeek}'.`);

  ctx.log(
    `  WI ${wi.id.slice(0, 8)}: dates=${wi.startDate}→${wi.endDate}, dow=${wi.dayOfWeek}, weekOf=${wi.weekOf}`
  );
}

async function verify(ctx: MigrationContext): Promise<void> {
  const [wi] = await ctx.db
    .select()
    .from(weekItems)
    .where(eq(weekItems.title, WI_TITLE));
  if (!wi) throw new Error(`Post: WI disappeared.`);
  if (wi.startDate !== NEW_START)
    throw new Error(`Post: startDate '${wi.startDate}'.`);
  if (wi.endDate !== NEW_END) throw new Error(`Post: endDate '${wi.endDate}'.`);
  if (wi.dayOfWeek !== NEW_DOW)
    throw new Error(`Post: dayOfWeek '${wi.dayOfWeek}'.`);
  if (wi.weekOf !== WI_WEEK_OF)
    throw new Error(`Post: weekOf drift '${wi.weekOf}'.`);
  ctx.log(
    `  Verified: dates ${NEW_START}→${NEW_END}, dow ${NEW_DOW}, weekOf intact`
  );
}

async function snapshot(
  ctx: MigrationContext,
  relativePath: string
): Promise<void> {
  const [client] = await ctx.db
    .select()
    .from(clients)
    .where(eq(clients.slug, LPPC_SLUG));
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
    note: relativePath.includes("pre")
      ? "pre-thursday-move"
      : "post-thursday-move",
    client,
    projects: allProjects,
    weekItems: allWis,
  };
  const fullPath = resolvePath(process.cwd(), relativePath);
  if (!existsSync(dirname(fullPath)))
    mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, JSON.stringify(payload, null, 2));
}
