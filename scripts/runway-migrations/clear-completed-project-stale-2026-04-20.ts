/**
 * Clear `staleDays` + `waitingOn` on status=completed projects.
 *
 * Bug: `src/lib/runway/flags-detectors.ts:detectStaleItems` flags any project
 * with staleDays >= 14 regardless of status. Completed projects that had
 * stale values at close-out still generate Critical/Warning flags.
 *
 * Fix (data-only): clear those fields on completed projects. Code-side fix
 * (skip completed in detectStaleItems) is flagged in the morning report for
 * operator review.
 */

import { and, eq, isNotNull } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { projects } from "../../src/lib/db/runway-schema";
import { writeFileSync } from "fs";

export const description =
  "Clear staleDays + waitingOn on status=completed projects (flag-detector bug workaround)";

export async function up(ctx: MigrationContext): Promise<void> {
  const { db, dryRun } = ctx;

  // Find completed projects with stale fields set
  const candidates = await db
    .select({
      id: projects.id,
      name: projects.name,
      status: projects.status,
      staleDays: projects.staleDays,
      waitingOn: projects.waitingOn,
    })
    .from(projects)
    .where(eq(projects.status, "completed"));

  const toClear = candidates.filter(
    (p) => p.staleDays != null || p.waitingOn != null
  );

  console.log(
    `[${dryRun ? "DRY-RUN" : "APPLY"}] Found ${candidates.length} completed projects, ${toClear.length} with staleDays/waitingOn to clear.`
  );

  for (const p of toClear) {
    console.log(
      `  ${p.id.slice(0, 8)} | ${p.name} | staleDays=${p.staleDays} | waitingOn=${p.waitingOn}`
    );
  }

  const snapshotPath = dryRun
    ? "docs/tmp/clear-completed-stale-snapshot-dryrun.json"
    : "docs/tmp/clear-completed-stale-snapshot.json";
  writeFileSync(
    snapshotPath,
    JSON.stringify({ at: new Date().toISOString(), items: toClear }, null, 2)
  );

  if (dryRun) {
    console.log(`[DRY-RUN] Would clear staleDays + waitingOn on ${toClear.length} projects.`);
    return;
  }

  // Raw UPDATE to clear to NULL (helper can't write NULL via updateProjectField)
  for (const p of toClear) {
    await db
      .update(projects)
      .set({ staleDays: null, waitingOn: null })
      .where(eq(projects.id, p.id));
    console.log(`[APPLY] Cleared ${p.id.slice(0, 8)} / ${p.name}`);
  }

  console.log(`[APPLY] === Clear-completed-stale complete ===`);
}
