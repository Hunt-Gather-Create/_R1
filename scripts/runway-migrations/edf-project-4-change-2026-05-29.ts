/**
 * EDF — Project 4 Change reframe + pitch follow-up WI
 *
 * Operator decisions (2026-05-29):
 *   - Rename L1 "TBD — Awaiting Lauren to re-engage and Update" → "Project 4 Change"
 *   - Flip L1 status on-hold → in-production (actively pitching today)
 *   - Rename open WI "EDF SOW Draft — Project Change Campaign Scope" → "Pitch Deck Draft"
 *   - Refresh open WI notes (drop SOW-draft framing, reflect pitch deck)
 *   - Add new WI "Pitch Meeting Feedback from Lauren" on Tuesday 6/2,
 *     owner Kathy, resource "AM: Kathy"
 *
 * Order of ops (lookup-key safety):
 *   1. Existing WI notes refresh (uses old title for lookup)
 *   2. Existing WI title rename (uses old title for lookup, sets new title)
 *   3. Create new WI (uses old L1 name for project lookup)
 *   4. L1 status flip (uses old name)
 *   5. L1 rename (LAST — breaks lookup key)
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve as resolvePath, dirname } from "node:path";
import { eq } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { clients, projects, weekItems } from "@/lib/db/runway-schema";
import { updateProjectField } from "@/lib/runway/operations-writes-project";
import {
  updateWeekItemField,
  createWeekItem,
} from "@/lib/runway/operations-writes-week";
import { updateProjectStatus } from "@/lib/runway/operations-writes";

const EDF_SLUG = "edf";
const UPDATED_BY = "edf-project-4-change-2026-05-29";

const L1_ID = "724becd9f77347008c1e9a36b";
const L1_OLD_NAME = "TBD — Awaiting Lauren to re-engage and Update";
const L1_NEW_NAME = "Project 4 Change";
const L1_OLD_STATUS = "on-hold";
const L1_NEW_STATUS = "in-production";

const WI_OPEN_ID = "d5ff65d8dcc24d70afe0b4a7e";
const WI_OPEN_OLD_TITLE = "EDF SOW Draft — Project Change Campaign Scope";
const WI_OPEN_NEW_TITLE = "Pitch Deck Draft";
const WI_OPEN_WEEK_OF = "2026-05-25";
const WI_OPEN_NEW_NOTES =
  "Pitch deck for Project 4 Change campaign identity + fundraising narrative. Pitching Lauren 5/29 PM.";

const NEW_WI = {
  title: "Pitch Meeting Feedback from Lauren",
  startDate: "2026-06-02",
  endDate: "2026-06-02",
  weekOf: "2026-06-01",
  dayOfWeek: "tuesday",
  status: "scheduled",
  owner: "Kathy",
  resources: "AM: Kathy",
  notes: "Follow up with Lauren on Project 4 Change pitch reception.",
};

const PRE_SNAPSHOT_PATH = "docs/tmp/edf-project-4-change-pre-2026-05-29.json";
const POST_SNAPSHOT_PATH = "docs/tmp/edf-project-4-change-post-2026-05-29.json";

export const description =
  "EDF — Rename L1 to Project 4 Change, reframe open WI to Pitch Deck Draft, add Tuesday follow-up WI";

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("--- Step 1: Pre-check ---");
  await preChecks(ctx);

  if (!ctx.dryRun) {
    await snapshot(ctx, PRE_SNAPSHOT_PATH);
    ctx.log(`  Pre-snapshot written: ${PRE_SNAPSHOT_PATH}`);
  } else {
    ctx.log("  [DRY] would write pre-snapshot");
  }

  // ── Phase A — Existing WI edits ─────────────────────────
  ctx.log("--- Phase A: existing WI (notes first, title LAST) ---");

  ctx.log(`  WI ${WI_OPEN_ID.slice(0, 8)} notes → refresh (drop SOW framing)`);
  if (!ctx.dryRun) {
    const r = await updateWeekItemField({
      weekOf: WI_OPEN_WEEK_OF,
      weekItemTitle: WI_OPEN_OLD_TITLE,
      field: "notes",
      newValue: WI_OPEN_NEW_NOTES,
      updatedBy: UPDATED_BY,
      source: "migration",
    });
    if (!r.ok) throw new Error(`WI notes update failed: ${r.error}`);
  }

  ctx.log(
    `  WI ${WI_OPEN_ID.slice(0, 8)} title: "${WI_OPEN_OLD_TITLE}" → "${WI_OPEN_NEW_TITLE}"`
  );
  if (!ctx.dryRun) {
    const r = await updateWeekItemField({
      weekOf: WI_OPEN_WEEK_OF,
      weekItemTitle: WI_OPEN_OLD_TITLE,
      field: "title",
      newValue: WI_OPEN_NEW_TITLE,
      updatedBy: UPDATED_BY,
      source: "migration",
    });
    if (!r.ok) throw new Error(`WI title update failed: ${r.error}`);
  }

  // ── Phase B — Create new WI ─────────────────────────────
  ctx.log(`--- Phase B: create new WI "${NEW_WI.title}" ---`);
  ctx.log(
    `  ${NEW_WI.startDate} → ${NEW_WI.endDate} | ${NEW_WI.dayOfWeek} | weekOf ${NEW_WI.weekOf} | owner=${NEW_WI.owner} | res="${NEW_WI.resources}"`
  );
  if (!ctx.dryRun) {
    const r = await createWeekItem({
      clientSlug: EDF_SLUG,
      projectName: L1_OLD_NAME, // uses OLD name — created before L1 rename
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
      source: "migration",
    });
    if (!r.ok) throw new Error(`createWeekItem failed: ${r.error}`);
  }

  // ── Phase C — L1 edits (status first, name LAST) ────────
  ctx.log("--- Phase C: L1 (status first, name LAST) ---");

  ctx.log(
    `  L1 ${L1_ID.slice(0, 8)} status: ${L1_OLD_STATUS} → ${L1_NEW_STATUS}`
  );
  if (!ctx.dryRun) {
    const r = await updateProjectStatus({
      clientSlug: EDF_SLUG,
      projectName: L1_OLD_NAME,
      newStatus: L1_NEW_STATUS,
      updatedBy: UPDATED_BY,
      source: "migration",
    });
    if (!r.ok) throw new Error(`L1 status update failed: ${r.error}`);
  }

  ctx.log(
    `  L1 ${L1_ID.slice(0, 8)} name: "${L1_OLD_NAME}" → "${L1_NEW_NAME}"`
  );
  if (!ctx.dryRun) {
    const r = await updateProjectField({
      clientSlug: EDF_SLUG,
      projectName: L1_OLD_NAME,
      field: "name",
      newValue: L1_NEW_NAME,
      updatedBy: UPDATED_BY,
      source: "migration",
    });
    if (!r.ok) throw new Error(`L1 name update failed: ${r.error}`);
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
    .where(eq(clients.slug, EDF_SLUG));
  if (!client) throw new Error(`EDF client not found.`);

  const [l1] = await ctx.db
    .select()
    .from(projects)
    .where(eq(projects.id, L1_ID));
  if (!l1) throw new Error(`L1 (id=${L1_ID}) not found.`);
  if (l1.name !== L1_OLD_NAME) {
    throw new Error(
      `L1 name drift: expected '${L1_OLD_NAME}', got '${l1.name}'.`
    );
  }
  if (l1.status !== L1_OLD_STATUS) {
    throw new Error(
      `L1 status drift: expected '${L1_OLD_STATUS}', got '${l1.status}'.`
    );
  }
  if (l1.clientId !== client.id) throw new Error(`L1 clientId drift.`);

  const [wi] = await ctx.db
    .select()
    .from(weekItems)
    .where(eq(weekItems.id, WI_OPEN_ID));
  if (!wi) throw new Error(`Open WI (id=${WI_OPEN_ID}) not found.`);
  if (wi.title !== WI_OPEN_OLD_TITLE) {
    throw new Error(
      `WI title drift: expected '${WI_OPEN_OLD_TITLE}', got '${wi.title}'.`
    );
  }
  if (wi.weekOf !== WI_OPEN_WEEK_OF) {
    throw new Error(
      `WI weekOf drift: expected '${WI_OPEN_WEEK_OF}', got '${wi.weekOf}'.`
    );
  }
  if (wi.projectId !== L1_ID) throw new Error(`WI projectId drift.`);

  // Confirm no existing WI by the new title (avoid silent collision on create).
  const [collision] = await ctx.db
    .select()
    .from(weekItems)
    .where(eq(weekItems.title, NEW_WI.title));
  if (collision) {
    throw new Error(
      `New WI title "${NEW_WI.title}" already exists (id=${collision.id}). Pick a different title or delete the collision.`
    );
  }

  ctx.log(`  EDF client: ${client.id}`);
  ctx.log(`  L1 ${L1_ID.slice(0, 8)}: name='${l1.name}', status=${l1.status}`);
  ctx.log(
    `  Open WI ${WI_OPEN_ID.slice(0, 8)}: title='${wi.title}', weekOf=${wi.weekOf}, status=${wi.status}`
  );
  ctx.log(`  No collision on new WI title "${NEW_WI.title}"`);
}

async function verify(ctx: MigrationContext): Promise<void> {
  const [l1] = await ctx.db
    .select()
    .from(projects)
    .where(eq(projects.id, L1_ID));
  if (l1.name !== L1_NEW_NAME)
    throw new Error(`Post: L1 name '${l1.name}', expected '${L1_NEW_NAME}'.`);
  if (l1.status !== L1_NEW_STATUS)
    throw new Error(
      `Post: L1 status '${l1.status}', expected '${L1_NEW_STATUS}'.`
    );

  const [wi] = await ctx.db
    .select()
    .from(weekItems)
    .where(eq(weekItems.id, WI_OPEN_ID));
  if (wi.title !== WI_OPEN_NEW_TITLE)
    throw new Error(
      `Post: WI title '${wi.title}', expected '${WI_OPEN_NEW_TITLE}'.`
    );
  if (wi.notes !== WI_OPEN_NEW_NOTES) {
    throw new Error(
      `Post: WI notes drift.\n  got: ${wi.notes}\n  exp: ${WI_OPEN_NEW_NOTES}`
    );
  }

  const [newWi] = await ctx.db
    .select()
    .from(weekItems)
    .where(eq(weekItems.title, NEW_WI.title));
  if (!newWi) throw new Error(`Post: new WI "${NEW_WI.title}" not found.`);
  if (
    newWi.startDate !== NEW_WI.startDate ||
    newWi.endDate !== NEW_WI.endDate
  ) {
    throw new Error(
      `Post: new WI dates ${newWi.startDate}→${newWi.endDate}, expected ${NEW_WI.startDate}→${NEW_WI.endDate}.`
    );
  }
  if (newWi.weekOf !== NEW_WI.weekOf || newWi.dayOfWeek !== NEW_WI.dayOfWeek) {
    throw new Error(`Post: new WI weekOf/dow drift.`);
  }
  if (newWi.status !== NEW_WI.status)
    throw new Error(`Post: new WI status drift.`);
  if (newWi.owner !== NEW_WI.owner)
    throw new Error(
      `Post: new WI owner='${newWi.owner}', expected '${NEW_WI.owner}'.`
    );
  if (newWi.resources !== NEW_WI.resources) {
    throw new Error(
      `Post: new WI resources='${newWi.resources}', expected '${NEW_WI.resources}'.`
    );
  }
  if (newWi.projectId !== L1_ID)
    throw new Error(`Post: new WI projectId drift.`);

  ctx.log(
    `  Verified: L1 renamed + status, open WI renamed + notes refreshed, new WI created on Tuesday`
  );
}

async function snapshot(
  ctx: MigrationContext,
  relativePath: string
): Promise<void> {
  const [client] = await ctx.db
    .select()
    .from(clients)
    .where(eq(clients.slug, EDF_SLUG));
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
      ? "pre-project-4-change"
      : "post-project-4-change",
    client,
    projects: allProjects,
    weekItems: allWis,
  };
  const fullPath = resolvePath(process.cwd(), relativePath);
  if (!existsSync(dirname(fullPath)))
    mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, JSON.stringify(payload, null, 2));
}
