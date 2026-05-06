/**
 * Data extraction for the Runway Gantt CLI.
 *
 * Given a resolved subject (wrapper or L1) and its client, fetch the children
 * needed for the chosen view:
 *   - Wrapper view  → child L1 projects (already on the subject) + a probe for
 *                     orphan weekItems attached directly to the wrapper.
 *   - L1 view       → weekItems WHERE project_id = entity.id.
 *
 * Both shapes carry a single discriminated union so downstream code can
 * narrow on `kind` without re-querying.
 */

import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { weekItems } from "@/lib/db/runway-schema";
import { buildRawData } from "../../../src/lib/runway/gantt/build-raw-data";
import type {
  ClientRow,
  RawData,
  ResolvedSubject,
} from "../../../src/lib/runway/gantt/types";

export { buildRawData };

type DrizzleDb = ReturnType<typeof drizzle>;

/** Async: fetch weekItems for the subject and build the discriminated dataset. */
export async function extractData(
  db: DrizzleDb,
  subject: ResolvedSubject,
  client: ClientRow,
): Promise<RawData> {
  const items = await db
    .select()
    .from(weekItems)
    .where(eq(weekItems.projectId, subject.project.id));
  return buildRawData(subject, client, items);
}
