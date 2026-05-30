/**
 * LPPC — Add "Webflow Training: Bill" WI under Website Revamp L1
 *
 * Operator decisions (2026-05-29):
 *   - Parent: Website Revamp L1 (no L2 wrapper needed; L1 has 0 L2 children)
 *   - Title: "Webflow Training: Bill"
 *   - Date: Friday 2026-06-05 single-day
 *   - Owner: Leslie / Resources: "Dev: Leslie, Client: Bill"
 *   - Status: scheduled
 *   - Notes: Walk Bill through Webflow basics for self-serve content edits.
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve as resolvePath, dirname } from "node:path";
import { eq } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { clients, projects, weekItems } from "@/lib/db/runway-schema";
import { createWeekItem } from "@/lib/runway/operations-writes-week";

const LPPC_SLUG = "lppc";
const UPDATED_BY = "lppc-webflow-training-bill-2026-05-29";

const L1_ID = "6422e5f4b0fa483ea88c7b94e";
const L1_NAME = "Website Revamp";

const NEW_WI = {
  title: "Webflow Training: Bill",
  startDate: "2026-06-05",
  endDate: "2026-06-05",
  weekOf: "2026-06-01",
  dayOfWeek: "friday",
  status: "scheduled",
  owner: "Leslie",
  resources: "Dev: Leslie, Client: Bill",
  notes: "Walk Bill through Webflow basics so LPPC can self-serve content edits post-launch.",
};

const PRE_SNAPSHOT_PATH = "docs/tmp/lppc-webflow-training-bill-pre-2026-05-29.json";
const POST_SNAPSHOT_PATH = "docs/tmp/lppc-webflow-training-bill-post-2026-05-29.json";

export const description =
  "LPPC — Add Webflow Training: Bill WI under Website Revamp (Friday 6/5)";

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("--- Step 1: Pre-check ---");
  await preChecks(ctx);

  if (!ctx.dryRun) {
    await snapshot(ctx, PRE_SNAPSHOT_PATH);
    ctx.log(`  Pre-snapshot written: ${PRE_SNAPSHOT_PATH}`);
  } else {
    ctx.log("  [DRY] would write pre-snapshot");
  }

  ctx.log("--- Step 2: Create WI ---");
  ctx.log(
    `  "${NEW_WI.title}" | ${NEW_WI.startDate} → ${NEW_WI.endDate} | ${NEW_WI.dayOfWeek} | weekOf ${NEW_WI.weekOf} | owner=${NEW_WI.owner} | res="${NEW_WI.resources}"`,
  );
  if (!ctx.dryRun) {
    const r = await createWeekItem({
      clientSlug: LPPC_SLUG,
      projectName: L1_NAME,
      weekOf: NEW_WI.weekOf,
      dayOfWeek: NEW_WI.dayOfWeek,
      title: NEW_WI.title,
      status: NEW_WI.status,
      owner: NEW_WI.owner,
      resources: NEW_WI.resources,
      notes: NEW_WI.notes,
      startDate: NEW_WI.startDate,
      endDate: NEW_WI.endDate,
      updatedBy: UPDATED_BY,
    });
    if (!r.ok) throw new Error(`createWeekItem failed: ${r.error}`);
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
  const [client] = await ctx.db.select().from(clients).where(eq(clients.slug, LPPC_SLUG));
  if (!client) throw new Error(`LPPC client not found.`);

  const [l1] = await ctx.db.select().from(projects).where(eq(projects.id, L1_ID));
  if (!l1) throw new Error(`Website Revamp L1 (id=${L1_ID}) not found.`);
  if (l1.name !== L1_NAME) throw new Error(`L1 name drift: '${l1.name}' vs '${L1_NAME}'.`);
  if (l1.clientId !== client.id) throw new Error(`L1 clientId drift.`);

  const [collision] = await ctx.db
    .select()
    .from(weekItems)
    .where(eq(weekItems.title, NEW_WI.title));
  if (collision) {
    throw new Error(
      `WI title "${NEW_WI.title}" already exists (id=${collision.id}). Pick a different title.`,
    );
  }

  ctx.log(`  LPPC client: ${client.id}`);
  ctx.log(`  Website Revamp L1 ${L1_ID.slice(0, 8)}: status=${l1.status}, dates=${l1.startDate}→${l1.endDate}`);
  ctx.log(`  No collision on "${NEW_WI.title}"`);
}

async function verify(ctx: MigrationContext): Promise<void> {
  const [newWi] = await ctx.db
    .select()
    .from(weekItems)
    .where(eq(weekItems.title, NEW_WI.title));
  if (!newWi) throw new Error(`Post: new WI "${NEW_WI.title}" not found.`);
  if (newWi.projectId !== L1_ID) throw new Error(`Post: projectId drift.`);
  if (newWi.startDate !== NEW_WI.startDate || newWi.endDate !== NEW_WI.endDate) {
    throw new Error(`Post: dates drift ${newWi.startDate}→${newWi.endDate}.`);
  }
  if (newWi.weekOf !== NEW_WI.weekOf || newWi.dayOfWeek !== NEW_WI.dayOfWeek) {
    throw new Error(`Post: weekOf/dow drift.`);
  }
  if (newWi.owner !== NEW_WI.owner) throw new Error(`Post: owner drift '${newWi.owner}'.`);
  if (newWi.resources !== NEW_WI.resources) {
    throw new Error(`Post: resources drift '${newWi.resources}'.`);
  }
  if (newWi.status !== NEW_WI.status) throw new Error(`Post: status drift.`);
  ctx.log(`  Verified: WI created under Website Revamp, all fields intact`);
}

async function snapshot(ctx: MigrationContext, relativePath: string): Promise<void> {
  const [client] = await ctx.db.select().from(clients).where(eq(clients.slug, LPPC_SLUG));
  const allProjects = await ctx.db.select().from(projects).where(eq(projects.clientId, client.id));
  const allWis = await ctx.db.select().from(weekItems).where(eq(weekItems.clientId, client.id));
  const payload = {
    pulledAt: new Date().toISOString(),
    note: relativePath.includes("pre") ? "pre-training-wi" : "post-training-wi",
    client,
    projects: allProjects,
    weekItems: allWis,
  };
  const fullPath = resolvePath(process.cwd(), relativePath);
  if (!existsSync(dirname(fullPath))) mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, JSON.stringify(payload, null, 2));
}
