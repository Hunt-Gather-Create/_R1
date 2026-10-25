/**
 * Discovery CLI: prints what schedule discovery finds for each job ledger
 * job, chosen, refused or none, plus Drive schedules no job owns. Reads
 * only; never writes a sheet_registry row.
 *
 * Usage:
 *   pnpm runway:sheet-discovery
 *
 * Reads the job ledger named by RUNWAY_JOB_LEDGER_SHEET_ID and Drive through
 * the google-api CLI, and clients and sheet_registry from prod through a
 * read-only handle, as a dry run reads them.
 */
import { createRunwayDb, runIfDirect } from "./lib/run-script";
import { discoverForRun, liveDiscoveryDeps } from "./runway-sheet-sync/discover-live";
import { readOnlyDb } from "./runway-sheet-sync/read-only-db";
import type { ScheduleDiscovery } from "./runway-sheet-sync/schedule-discovery";
import { skippedRowLines } from "./runway-sheet-sync/schedule-select";

/** One line per job, per unowned file and per skipped job ledger row. */
export function discoveryLines(d: ScheduleDiscovery): string[] {
  const lines = d.jobs.map((e) => {
    if (e.kind === "chosen") {
      const via = e.config.fromRegistry ? ", from sheet_registry" : "";
      return `${e.job.jobNumber} chosen ${e.config.sheetId}${via}, ${e.superseded.length} superseded`;
    }
    if (e.kind === "refused") return `${e.job.jobNumber} refused: ${e.reason}`;
    return `${e.job.jobNumber} none, status ${e.job.status}`;
  });
  return [...lines, ...d.unowned.map((f) => `no job: ${f.name} ${f.id}`), ...skippedRowLines(d)];
}

async function main(): Promise<void> {
  const discovery = await discoverForRun(process.env, liveDiscoveryDeps(readOnlyDb(createRunwayDb().db)));
  console.log(discoveryLines(discovery).join("\n"));
  process.exit(0);
}

runIfDirect("runway-sheet-discovery", main);
