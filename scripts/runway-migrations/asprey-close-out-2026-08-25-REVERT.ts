/**
 * REVERT for asprey-close-out-2026-08-25.
 *
 * Restores the three fields to their exact pre-batch values, captured from
 * prod before the batch ran and held verbatim in
 * docs/tmp/asprey-snapshot-2026-08-25.json.
 *
 *   projects."Social Retainer - Wind Down".status    -> in-production
 *   projects."Social Retainer - Wind Down".category  -> active
 *   clients.dave-asprey.contract_status              -> signed
 *
 * Order reversed from the forward batch: status must leave "completed" before
 * category does, or validateStatusCategoryCompatibility rejects the pair.
 */
import type { MigrationContext } from "../runway-migrate";
import { updateProjectField } from "@/lib/runway/operations-writes-project";
import { updateProjectStatus } from "@/lib/runway/operations-writes";
import { updateClientField } from "@/lib/runway/operations-writes-client";
import { withBatchId } from "@/lib/runway/runway-als";

const BATCH_ID = "asprey-close-out-2026-08-25-REVERT";
const CLIENT_SLUG = "dave-asprey";
const PROJECT = "Social Retainer \u2014 Wind Down";

export const description =
  "REVERT asprey-close-out-2026-08-25: project status -> in-production, category -> active, client contract_status -> signed.";

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("=== REVERT Dave Asprey close-out ===");

  if (ctx.dryRun) {
    ctx.log(`projects."${PROJECT}".status   completed -> in-production`);
    ctx.log(`projects."${PROJECT}".category completed -> active`);
    ctx.log("clients.dave-asprey.contractStatus expired -> signed");
    ctx.log("Dry-run: no writes performed.");
    return;
  }

  await withBatchId(BATCH_ID, async () => {
    const st = await updateProjectStatus({
      clientSlug: CLIENT_SLUG,
      projectName: PROJECT,
      newStatus: "in-production",
      updatedBy: BATCH_ID,
    });
    if (!st.ok) throw new Error(`revert updateProjectStatus failed: ${st.error}`);
    ctx.log(st.message);

    const cat = await updateProjectField({
      clientSlug: CLIENT_SLUG,
      projectName: PROJECT,
      field: "category",
      newValue: "active",
      updatedBy: BATCH_ID,
    });
    if (!cat.ok) throw new Error(`revert updateProjectField(category) failed: ${cat.error}`);
    ctx.log(cat.message);

    const c = await updateClientField({
      clientSlug: CLIENT_SLUG,
      field: "contractStatus",
      newValue: "signed",
      updatedBy: BATCH_ID,
    });
    if (!c.ok) throw new Error(`revert updateClientField failed: ${c.error}`);
    ctx.log(c.message);
  });
}
