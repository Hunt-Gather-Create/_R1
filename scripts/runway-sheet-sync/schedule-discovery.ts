/**
 * Schedule discovery: a pure function of the job ledger, a Drive listing,
 * the Runway clients and the sheet_registry overrides. It picks at most one
 * schedule per job and says why for every other file, so adding a schedule
 * never needs a code change.
 */
import { matchClient, type RunwayClient } from "./client-match";
import type { LedgerJob } from "./job-ledger";
import { scheduleVersion, startsWithJob, type DriveFile } from "./schedule-files";
import type { SheetConfig } from "./types";

/** A sheet_registry row: its sheet wins over discovery for that job. */
export interface ScheduleOverride {
  engagementKey: string;
  currentSheetId: string;
}

export type JobSchedule =
  | { kind: "chosen"; job: LedgerJob; config: SheetConfig; file: DriveFile | null; superseded: DriveFile[] }
  | { kind: "refused"; job: LedgerJob; reason: string; files: DriveFile[] }
  | { kind: "none"; job: LedgerJob };

export interface ScheduleDiscovery {
  jobs: JobSchedule[];
  /** Schedule files whose name starts with no ledger job number. */
  unowned: DriveFile[];
  listing: DriveFile[];
}

export interface DiscoveryInput {
  jobs: LedgerJob[];
  listing: DriveFile[];
  clients: RunwayClient[];
  overrides: ScheduleOverride[];
}

const sameKey = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function pick(files: DriveFile[], override: ScheduleOverride | undefined, listing: DriveFile[]) {
  if (override) {
    const id = override.currentSheetId;
    return { file: listing.find((f) => f.id === id) ?? null, id, superseded: files.filter((f) => f.id !== id) };
  }
  const top = Math.max(...files.map((f) => scheduleVersion(f.name)!));
  const tops = files.filter((f) => scheduleVersion(f.name) === top);
  if (tops.length > 1) {
    return { tie: `${tops.length} schedule files carry version v${top}, so neither is chosen: ${tops.map((f) => `${f.name} (${f.id})`).join(", ")}` };
  }
  return { file: tops[0], id: tops[0].id, superseded: files.filter((f) => f !== tops[0]) };
}

function scheduleFor(job: LedgerJob, files: DriveFile[], input: DiscoveryInput): JobSchedule {
  const override = input.overrides.find((o) => sameKey(o.engagementKey, job.jobNumber));
  if (!override && files.length === 0) return { kind: "none", job };

  const picked = pick(files, override, input.listing);
  if ("tie" in picked) return { kind: "refused", job, reason: `Job ${job.jobNumber}: ${picked.tie}.`, files };

  const client = matchClient(job.jobNumber, job.client, input.clients);
  if ("error" in client) return { kind: "refused", job, reason: client.error, files };

  const config: SheetConfig = {
    sheetId: picked.id,
    clientSlug: client.slug,
    engagementCode: job.jobNumber,
    label: job.engagement,
    ...(override ? { fromRegistry: true } : {}),
  };
  return { kind: "chosen", job, config, file: picked.file, superseded: picked.superseded };
}

export function discoverSchedules(input: DiscoveryInput): ScheduleDiscovery {
  const schedules = input.listing.filter((f) => scheduleVersion(f.name) !== null);
  const overrideIds = new Set(input.overrides.map((o) => o.currentSheetId));
  const owned = new Set<string>();

  const jobs = input.jobs.map((job) => {
    const files = schedules.filter(
      (f) => startsWithJob(f.name, job.jobNumber) && (!overrideIds.has(f.id) || ownsOverride(input, job, f.id)),
    );
    for (const f of files) owned.add(f.id);
    return scheduleFor(job, files, input);
  });

  const unowned = schedules.filter((f) => !owned.has(f.id) && !overrideIds.has(f.id));
  return { jobs, unowned, listing: input.listing };
}

/** A file an override names belongs to the override's job, never to another job by its name. */
function ownsOverride(input: DiscoveryInput, job: LedgerJob, sheetId: string): boolean {
  return input.overrides.some((o) => o.currentSheetId === sheetId && sameKey(o.engagementKey, job.jobNumber));
}
