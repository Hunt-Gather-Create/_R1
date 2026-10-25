/**
 * Picks run targets out of a schedule discovery. Every miss throws a plain
 * reason, so a run never syncs a sheet discovery did not choose.
 */
import { JOB_NUMBER, scheduleVersion } from "./schedule-files";
import type { JobSchedule, ScheduleDiscovery } from "./schedule-discovery";
import type { SheetConfig } from "./types";

function chosenOrThrow(entry: JobSchedule): SheetConfig {
  if (entry.kind === "chosen") return entry.config;
  if (entry.kind === "refused") throw new Error(entry.reason);
  const n = entry.job.jobNumber;
  throw new Error(
    `Job ${n} has no schedule in Drive: no spreadsheet name starts with ${n} and carries Schedule v, Project Plan v or Project-Plan-v.`,
  );
}

export function scheduleForJob(discovery: ScheduleDiscovery, jobNumber: string): SheetConfig {
  const wanted = jobNumber.trim().toUpperCase();
  if (!JOB_NUMBER.test(wanted)) throw new Error(`Job ${jobNumber} is not shaped like ABC-2604, AB1-2601 or ABC-2501-03-35.`);
  const skipped = discovery.skipped.find((s) => s.text === wanted);
  if (skipped) throw new Error(`Job ${wanted} is refused: the job ledger row was skipped, ${skipped.reason}.`);
  const entry = discovery.jobs.find((j) => j.job.jobNumber === wanted);
  if (!entry) throw new Error(`Job ${jobNumber} is not in the job ledger.`);
  return chosenOrThrow(entry);
}

export function scheduleForSheet(discovery: ScheduleDiscovery, sheetId: string): SheetConfig {
  for (const entry of discovery.jobs) {
    if (entry.kind === "chosen" && entry.config.sheetId === sheetId) return entry.config;
    if (entry.kind === "chosen") {
      const old = entry.superseded.find((f) => f.id === sheetId);
      if (old) {
        const newer = entry.file ? `${entry.file.name} (${entry.config.sheetId})` : entry.config.sheetId;
        throw new Error(
          `Sheet ${sheetId} (${old.name}, v${scheduleVersion(old.name) ?? "?"}) is not the latest plan for job ${entry.job.jobNumber}: the chosen schedule is ${newer}.`,
        );
      }
    }
    if (entry.kind === "refused" && entry.files.some((f) => f.id === sheetId)) throw new Error(entry.reason);
  }
  const unowned = discovery.unowned.find((f) => f.id === sheetId);
  if (unowned) throw new Error(`Sheet ${sheetId} (${unowned.name}) starts with no job number in the job ledger.`);
  throw new Error(`Sheet ${sheetId} was not found by schedule discovery.`);
}

/** Every chosen schedule, plus the refusal reasons a run must print. */
export function allSchedules(discovery: ScheduleDiscovery): { targets: SheetConfig[]; refusals: string[] } {
  const targets: SheetConfig[] = [];
  const refusals: string[] = [];
  for (const entry of discovery.jobs) {
    if (entry.kind === "chosen") targets.push(entry.config);
    if (entry.kind === "refused") refusals.push(entry.reason);
  }
  return { targets, refusals };
}

/** One run report line per skipped job ledger row, each naming the row's text. */
export function skippedRowLines(discovery: ScheduleDiscovery): string[] {
  return discovery.skipped.map((s) => `job ledger row "${s.text}" skipped: ${s.reason}`);
}
