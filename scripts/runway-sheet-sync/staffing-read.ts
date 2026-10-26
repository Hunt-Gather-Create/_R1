/**
 * Reads staffing: client labels from the Runway clients table, and every team
 * and person from the Civilization Account Teams sheet. Read only.
 */
import { clients } from "../../src/lib/db/runway-schema";
import type { createRunwayDb } from "../lib/run-script";
import { readAccountTeams, requireAccountTeamsSheetId, staffingFromSheet } from "./account-teams";
import { readRangeWithCli, type ReadRange } from "./job-ledger";
import type { Staffing } from "./staffing";

type RunwayDb = ReturnType<typeof createRunwayDb>["db"];

export interface StaffingSource {
  env: NodeJS.ProcessEnv;
  read: ReadRange;
}

export async function loadStaffing(
  db: RunwayDb,
  source: StaffingSource = { env: process.env, read: readRangeWithCli }
): Promise<Staffing> {
  const sheetId = requireAccountTeamsSheetId(source.env);
  const clientRows = await db.select({ slug: clients.slug, name: clients.name, nicknames: clients.nicknames }).from(clients);
  return staffingFromSheet(await readAccountTeams(sheetId, source.read), clientRows);
}
