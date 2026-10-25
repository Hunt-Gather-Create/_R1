/**
 * Wires schedule discovery to its live inputs: the job ledger and Drive
 * through the google-api CLI, the clients and sheet_registry tables through
 * the run's own database. Reads only. Tests inject every dependency.
 */
import { clients, sheetRegistry } from "../../src/lib/db/runway-schema";
import type { createRunwayDb } from "../lib/run-script";
import type { RunwayClient } from "./client-match";
import { listDrivePlanSheets } from "./drive-plan-listing";
import { readJobLedger, requireJobLedgerSheetId, type JobLedger } from "./job-ledger";
import { discoverSchedules, type ScheduleDiscovery, type ScheduleOverride } from "./schedule-discovery";
import type { DriveFile } from "./schedule-files";

type RunwayDb = ReturnType<typeof createRunwayDb>["db"];

export interface DiscoveryDeps {
  readLedger: (sheetId: string) => Promise<JobLedger>;
  listDrive: () => Promise<DriveFile[]>;
  readClients: () => Promise<RunwayClient[]>;
  readOverrides: () => Promise<ScheduleOverride[]>;
}

export function liveDiscoveryDeps(db: RunwayDb): DiscoveryDeps {
  return {
    readLedger: (sheetId) => readJobLedger(sheetId),
    listDrive: () => listDrivePlanSheets(),
    readClients: () => db.select({ slug: clients.slug, name: clients.name, nicknames: clients.nicknames }).from(clients),
    readOverrides: () =>
      db.select({ engagementKey: sheetRegistry.engagementKey, currentSheetId: sheetRegistry.currentSheetId }).from(sheetRegistry),
  };
}

/** Checks the ledger id before any read, so a missing id stops the run with one line. */
export async function discoverForRun(env: NodeJS.ProcessEnv, deps: DiscoveryDeps): Promise<ScheduleDiscovery> {
  const ledgerSheetId = requireJobLedgerSheetId(env);
  const [ledger, listing, clientRows, overrides] = await Promise.all([
    deps.readLedger(ledgerSheetId),
    deps.listDrive(),
    deps.readClients(),
    deps.readOverrides(),
  ]);
  return discoverSchedules({ jobs: ledger.jobs, listing, clients: clientRows, overrides, skipped: ledger.skipped });
}
