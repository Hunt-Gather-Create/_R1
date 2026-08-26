/**
 * REVERT for merit-client-create-2026-08-25.
 * Removes the Merit client row. Refuses if anything was attached to it.
 */
import { eq } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { clients, projects, weekItems, pipelineItems } from "@/lib/db/runway-schema";

const SLUG = "merit";

export const description = "REVERT merit-client-create-2026-08-25 — remove the Merit client row.";

export async function up(ctx: MigrationContext): Promise<void> {
  const { db, dryRun } = ctx;
  const row = (await db.select({ id: clients.id, name: clients.name })
    .from(clients).where(eq(clients.slug, SLUG)).limit(1))[0];
  if (!row) { ctx.log(`No '${SLUG}' client found — nothing to revert.`); return; }

  const p = await db.select({ id: projects.id }).from(projects).where(eq(projects.clientId, row.id));
  const w = await db.select({ id: weekItems.id }).from(weekItems).where(eq(weekItems.clientId, row.id));
  const pi = await db.select({ id: pipelineItems.id }).from(pipelineItems).where(eq(pipelineItems.clientId, row.id));
  ctx.log(`Merit ${row.id.slice(0, 8)}: ${p.length} projects, ${w.length} week items, ${pi.length} pipeline items.`);
  if (p.length || w.length || pi.length) {
    throw new Error("Merit has attached rows — refusing to delete the client. Remove children first, deliberately.");
  }

  if (!dryRun) {
    await db.delete(clients).where(eq(clients.id, row.id));
    ctx.log("Deleted the Merit client row.");
  } else {
    ctx.log("DRY-RUN: would delete the Merit client row.");
  }
}
