/**
 * Synthetic schedule discovery inputs for tests. Every client, job and
 * file here is invented; ids are short so no fixture looks like a Drive id.
 */
import type { RunwayClient } from "./client-match";
import type { LedgerJob } from "./job-ledger";
import type { ScheduleDiscovery } from "./schedule-discovery";
import type { DriveFile } from "./schedule-files";
import type { SheetConfig } from "./types";

export const driveFile = (id: string, name: string): DriveFile => ({ id, name, modifiedTime: "2026-10-01T00:00:00.000Z" });

export const ledgerJob = (jobNumber: string, client: string, engagement: string, status = "live"): LedgerJob => ({
  jobNumber,
  client,
  engagement,
  status,
});

export const SYN_CLIENTS: RunwayClient[] = [
  { slug: "acme-widgets", name: "Acme Widgets", nicknames: JSON.stringify(["AW"]) },
  { slug: "globex", name: "Globex", nicknames: null },
];

/** A discovery holding one chosen schedule, for a run test that injects its listing. */
export function oneScheduleDiscovery(
  config: SheetConfig,
  opts: { name?: string; superseded?: DriveFile[] } = {},
): ScheduleDiscovery {
  const file = driveFile(config.sheetId, opts.name ?? `${config.engagementCode} | ${config.label} - Project Plan v1`);
  const superseded = opts.superseded ?? [];
  return {
    jobs: [
      {
        kind: "chosen",
        job: ledgerJob(config.engagementCode, config.clientSlug, config.label),
        config,
        file,
        superseded,
      },
    ],
    unowned: [],
    skipped: [],
    listing: [file, ...superseded],
  };
}
