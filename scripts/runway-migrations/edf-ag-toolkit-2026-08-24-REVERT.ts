/**
 * REVERT for edf-ag-toolkit-2026-08-24.
 *
 * Undoes: the Ag Toolkit L1 + its 7 L3 sections + 29 L4 tasks, the Martin
 * team-member create, and the two EDF client field changes.
 *
 * Restores EDF to its pre-batch state:
 *   contractStatus: signed -> unsigned
 *   team:           "Kathy Horn (lead)" -> "Jill (lead)"
 *
 * Deletes are scoped by projectId so nothing outside this batch is touched.
 * Run dry-run first; it prints exact row counts before removing anything.
 */

import { eq, and } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { clients, projects, sections, weekItems, teamMembers } from "@/lib/db/runway-schema";

const PROJECT_NAME = "Ag Toolkit";
const PRIOR_CONTRACT_STATUS = "unsigned";
const PRIOR_TEAM = "Jill (lead)";

export const description =
  "REVERT edf-ag-toolkit-2026-08-24 — remove the Ag Toolkit project, its sections and tasks, the Martin team member, and restore EDF contractStatus + team.";

export async function up(ctx: MigrationContext): Promise<void> {
  const { db, dryRun } = ctx;

  const edf = (await db.select().from(clients).where(eq(clients.slug, "edf")).limit(1))[0];
  if (!edf) throw new Error("EDF client not found — aborting.");

  const proj = (await db.select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.clientId, edf.id), eq(projects.name, PROJECT_NAME)))
    .limit(1))[0];

  if (!proj) {
    ctx.log(`No '${PROJECT_NAME}' project found for EDF — nothing to revert on the project side.`);
  } else {
    const secRows = await db.select({ id: sections.id }).from(sections).where(eq(sections.projectId, proj.id));
    const taskRows = await db.select({ id: weekItems.id }).from(weekItems).where(eq(weekItems.projectId, proj.id));
    ctx.log(`Found project ${proj.id.slice(0, 8)} with ${secRows.length} sections and ${taskRows.length} tasks.`);

    if (!dryRun) {
      await db.delete(weekItems).where(eq(weekItems.projectId, proj.id));
      await db.delete(sections).where(eq(sections.projectId, proj.id));
      await db.delete(projects).where(eq(projects.id, proj.id));
      ctx.log("Deleted tasks, sections, then the project.");
    }
  }

  const martin = (await db.select({ id: teamMembers.id, name: teamMembers.name })
    .from(teamMembers).where(eq(teamMembers.name, "Martin")).limit(1))[0];
  if (!martin) {
    ctx.log("No 'Martin' team member found — nothing to remove.");
  } else {
    ctx.log(`Found team member Martin (${martin.id.slice(0, 8)}).`);
    if (!dryRun) {
      await db.delete(teamMembers).where(eq(teamMembers.id, martin.id));
      ctx.log("Deleted team member Martin.");
    }
  }

  ctx.log(`EDF restore: contractStatus '${edf.contractStatus}' -> '${PRIOR_CONTRACT_STATUS}', team '${edf.team}' -> '${PRIOR_TEAM}'.`);
  if (!dryRun) {
    await db.update(clients)
      .set({ contractStatus: PRIOR_CONTRACT_STATUS, team: PRIOR_TEAM })
      .where(eq(clients.id, edf.id));
    ctx.log("EDF client fields restored.");
  }

  ctx.log(dryRun ? "DRY-RUN complete — nothing removed." : "REVERT complete.");
}
