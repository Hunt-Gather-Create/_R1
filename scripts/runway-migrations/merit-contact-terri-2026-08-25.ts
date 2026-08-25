/**
 * Merit - add Terri Mcvey as client contact (2026-08-25)
 *
 * Operator-approved via Account Manager relay, Client Meeting Processing room,
 * 2026-08-25. Scope is exactly one field on one client row.
 *
 * NOT in scope: no project, no pipeline row, no contract fields. The pipeline
 * bar (a dollar figure) is still unmet.
 *
 * Shape note: runway-schema.ts documents client_contacts as {name, role?}.
 * We add an `email` key because the operator supplied one and dropping it
 * would lose a known fact. Extra keys in the JSON blob are ignored by readers
 * that only project name/role.
 *
 * Capitalisation note: "Mcvey" is entered exactly as the operator typed it.
 * "McVey" is the common spelling; confirm against the transcript or an email
 * signature when the Merit draft lands, then correct in one follow-up.
 */
import type { MigrationContext } from "../runway-migrate";
import { updateClientField } from "@/lib/runway/operations-writes-client";
import { withBatchId } from "@/lib/runway/runway-als";

const BATCH_ID = "merit-contact-terri-2026-08-25";

const CONTACTS = JSON.stringify([
  {
    name: "Terri Mcvey",
    role: "Client-side decision owner",
    email: "terri.mcvey@meritcre.com",
  },
]);

export const description =
  "Merit 2026-08-25: set client_contacts to Terri Mcvey (client-side decision owner, terri.mcvey@meritcre.com). One field, one row.";

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("=== Merit contact: Terri Mcvey ===");
  ctx.log(`clients.merit.client_contacts -> ${CONTACTS}`);

  if (ctx.dryRun) {
    ctx.log("Dry-run: no writes performed.");
    return;
  }

  await withBatchId(BATCH_ID, async () => {
    const res = await updateClientField({
      clientSlug: "merit",
      field: "clientContacts",
      newValue: CONTACTS,
      updatedBy: BATCH_ID,
    });
    if (!res.ok) throw new Error(`updateClientField failed: ${res.error}`);
    ctx.log(res.message);
  });
}
