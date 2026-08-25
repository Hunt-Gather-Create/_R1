/**
 * Create the Merit client record — 2026-08-25
 *
 * Operator instruction (Client Meeting Processing room, 2026-08-25T15:52Z):
 *   "Go ahead and set Merit up (correct spelling is Merit) in Runway,
 *    I don't want you building the project yet."
 *
 * SCOPE: the client row only. No project, no tasks, no pipeline item.
 * Rationale for no pipeline row: the bar I stated in-thread is that a prospect
 * earns a pipeline row once it has a real number and a real owner. I have
 * neither. Creating one now would put a placeholder in prod, which is the exact
 * failure pattern the 2026-08-24 cleanup surfaced.
 *
 * Fields deliberately left NULL: contractValue, contractTerm, team,
 * clientContacts, nicknames. Nothing is known about them and inventing them is
 * worse than an empty field.
 *
 * contractStatus = "unsigned" — matches ag1 / hermitage / jenkins, the existing
 * prospect-stage clients.
 *
 * REVERT: scripts/runway-migrations/merit-client-create-2026-08-25-REVERT.ts
 */

import { eq } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { clients } from "@/lib/db/runway-schema";
import { createClient } from "@/lib/runway/operations-writes-client";

const UPDATED_BY = "merit-client-create-2026-08-25";
const NAME = "Merit";
const SLUG = "merit";

export const description =
  "Create the Merit client record (client row only, no project / tasks / pipeline).";

export async function up(ctx: MigrationContext): Promise<void> {
  const { db, dryRun } = ctx;

  const existing = await db
    .select({ id: clients.id, slug: clients.slug, name: clients.name })
    .from(clients)
    .where(eq(clients.slug, SLUG))
    .limit(1);
  if (existing[0]) {
    throw new Error(
      `Client slug '${SLUG}' already exists (${existing[0].name}) — aborting to avoid a duplicate.`,
    );
  }
  ctx.log(`No existing '${SLUG}' client. Safe to create.`);
  ctx.log(`Plan: 1 client row. name='${NAME}' slug='${SLUG}' contractStatus='unsigned'. All other fields NULL.`);

  if (dryRun) {
    ctx.log("--- DRY RUN: no write performed. ---");
    return;
  }

  const res = await createClient({
    name: NAME,
    slug: SLUG,
    contractStatus: "unsigned",
    updatedBy: UPDATED_BY,
  });
  if (!res.ok) throw new Error(`createClient FAILED: ${res.error}`);

  const after = await db
    .select({ id: clients.id, name: clients.name, slug: clients.slug, contractStatus: clients.contractStatus })
    .from(clients)
    .where(eq(clients.slug, SLUG))
    .limit(1);
  if (!after[0]) throw new Error("Client reported created but could not be re-read.");
  ctx.log(`Created: ${after[0].name} (${after[0].slug}) id=${after[0].id.slice(0, 8)} contractStatus=${after[0].contractStatus}`);
}
