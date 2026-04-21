/**
 * Stale-Completed Cleanup Migration — 2026-04-20
 *
 * Deletes historical week_items where:
 *   - status = 'completed'
 *   - date < today
 *
 * Rationale: The Runway board's "Needs Update" filter (see
 * `src/app/runway/queries.ts:getStaleWeekItems`) uses projectId +
 * recent updates, NOT status. Items with projectId=NULL always
 * appear stale. Completed historical items have no board value —
 * their audit_records capture the history.
 *
 * Applies across all clients. Expects ~20-30 items after the
 * Bonterra/Convergix/TAP/Soundly/HDL/LPPC migrations land their
 * "mark completed" flips.
 *
 * Usage:
 *   pnpm runway:migrate scripts/runway-migrations/stale-completed-cleanup-2026-04-20.ts --target prod
 *   pnpm runway:migrate scripts/runway-migrations/stale-completed-cleanup-2026-04-20.ts --apply --target prod
 */

import { and, eq, lt } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { weekItems } from "../../src/lib/db/runway-schema";
import { writeFileSync } from "fs";

export const description =
  "Delete stale-completed week items (status=completed, date<today) that stick in Needs Update";

const TODAY_ISO = "2026-04-21"; // tomorrow — delete anything strictly before

export async function up(ctx: MigrationContext): Promise<void> {
  const { db, dryRun } = ctx;

  const targets = await db
    .select({
      id: weekItems.id,
      title: weekItems.title,
      date: weekItems.date,
      clientId: weekItems.clientId,
      projectId: weekItems.projectId,
      status: weekItems.status,
    })
    .from(weekItems)
    .where(
      and(eq(weekItems.status, "completed"), lt(weekItems.date, TODAY_ISO))
    );

  console.log(
    `[${dryRun ? "DRY-RUN" : "APPLY"}] Found ${targets.length} stale-completed week items to delete (status=completed AND date<${TODAY_ISO}).`
  );

  for (const t of targets) {
    const prefix = t.id.slice(0, 8);
    const pid = t.projectId ? String(t.projectId).slice(0, 8) : "null";
    console.log(
      `  ${prefix} | date=${t.date} | projectId=${pid} | ${t.title}`
    );
  }

  const snapshotPath = dryRun
    ? "docs/tmp/stale-completed-cleanup-snapshot-dryrun.json"
    : "docs/tmp/stale-completed-cleanup-snapshot.json";

  if (!dryRun) {
    writeFileSync(snapshotPath, JSON.stringify({ deletedAt: new Date().toISOString(), items: targets }, null, 2));
    console.log(`[APPLY] Snapshot written: ${snapshotPath}`);
  } else {
    writeFileSync(snapshotPath, JSON.stringify({ plannedDeletion: true, items: targets }, null, 2));
    console.log(`[DRY-RUN] Snapshot written: ${snapshotPath}`);
  }

  if (dryRun) {
    console.log(`[DRY-RUN] Would delete ${targets.length} week items.`);
    return;
  }

  let deleted = 0;
  for (const t of targets) {
    await db.delete(weekItems).where(eq(weekItems.id, t.id));
    deleted++;
  }

  console.log(`[APPLY] Deleted ${deleted} stale-completed week items.`);
  console.log(`[APPLY] === Stale-Completed Cleanup complete ===`);
}
