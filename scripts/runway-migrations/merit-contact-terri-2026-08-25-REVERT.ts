/**
 * REVERT for merit-contact-terri-2026-08-25.
 *
 * Restores Merit.client_contacts to its pre-batch state, which was NULL.
 * updateClientField cannot write NULL, so this writes the empty JSON array
 * "[]" - the same value Bonterra carries - and says so out loud rather than
 * pretending the restore is byte-exact.
 */
import type { MigrationContext } from "../runway-migrate";
import { updateClientField } from "@/lib/runway/operations-writes-client";
import { withBatchId } from "@/lib/runway/runway-als";

const BATCH_ID = "merit-contact-terri-2026-08-25-REVERT";

export const description =
  "REVERT merit-contact-terri-2026-08-25: clear Merit client_contacts back to [] (pre-batch value was NULL; restore is not byte-exact).";

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("=== REVERT Merit contact: Terri Mcvey ===");
  ctx.log('clients.merit.client_contacts -> "[]"  (pre-batch value was NULL)');

  if (ctx.dryRun) {
    ctx.log("Dry-run: no writes performed.");
    return;
  }

  await withBatchId(BATCH_ID, async () => {
    const res = await updateClientField({
      clientSlug: "merit",
      field: "clientContacts",
      newValue: "[]",
      updatedBy: BATCH_ID,
    });
    if (!res.ok) throw new Error(`revert failed: ${res.error}`);
    ctx.log(`${res.message} (NULL -> [], not byte-exact)`);
  });
}
