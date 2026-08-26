/**
 * Dave Asprey - close out the engagement (2026-08-25)
 *
 * Operator: "the client is closed out." The relationship ended; the board was
 * never told. Contract ran through 2026-04-30, the wind-down project ended
 * 2026-06-17, and all 9 tasks are already completed.
 *
 * This makes the record TRUE. It does NOT remove Dave Asprey from the board:
 * getClientsWithCounts calls getAllClients() with no filter, so the client
 * card stays visible with zero open work. Removing the card would require
 * deleting the client row, which is a separate destructive call the operator
 * has not asked for. All 89 update rows are preserved.
 *
 * Order is load-bearing: category must reach "completed" before status does,
 * because validateStatusCategoryCompatibility hard-rejects
 * status=completed + category=active.
 */
import type { MigrationContext } from "../runway-migrate";
import { updateProjectField } from "@/lib/runway/operations-writes-project";
import { updateProjectStatus } from "@/lib/runway/operations-writes";
import { updateClientField } from "@/lib/runway/operations-writes-client";
import { withBatchId } from "@/lib/runway/runway-als";

const BATCH_ID = "asprey-close-out-2026-08-25";
const CLIENT_SLUG = "dave-asprey";
const PROJECT = "Social Retainer \u2014 Wind Down";

export const description =
  "Dave Asprey 2026-08-25: close out the engagement. Project category+status -> completed, client contract_status -> expired. Client row and all 89 update rows preserved.";

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("=== Dave Asprey close-out ===");
  ctx.log(`projects."${PROJECT}".category  active        -> completed`);
  ctx.log(`projects."${PROJECT}".status    in-production -> completed`);
  ctx.log(`clients.dave-asprey.contractStatus  signed    -> expired`);
  ctx.log("Client row NOT deleted. Card stays visible; Runway has no hide.");

  if (ctx.dryRun) {
    ctx.log("Dry-run: no writes performed.");
    return;
  }

  await withBatchId(BATCH_ID, async () => {
    const cat = await updateProjectField({
      clientSlug: CLIENT_SLUG,
      projectName: PROJECT,
      field: "category",
      newValue: "completed",
      updatedBy: BATCH_ID,
    });
    if (!cat.ok) throw new Error(`updateProjectField(category) failed: ${cat.error}`);
    ctx.log(cat.message);

    // `status` is NOT in updateProjectField's allowlist. L1 status has its own
    // helper with its own enum whitelist (L1_PROJECT_STATUSES_ARR).
    const st = await updateProjectStatus({
      clientSlug: CLIENT_SLUG,
      projectName: PROJECT,
      newStatus: "completed",
      updatedBy: BATCH_ID,
    });
    if (!st.ok) throw new Error(`updateProjectStatus failed: ${st.error}`);
    ctx.log(st.message);

    const c = await updateClientField({
      clientSlug: CLIENT_SLUG,
      field: "contractStatus",
      newValue: "expired",
      updatedBy: BATCH_ID,
    });
    if (!c.ok) throw new Error(`updateClientField(contractStatus) failed: ${c.error}`);
    ctx.log(c.message);
  });
}
