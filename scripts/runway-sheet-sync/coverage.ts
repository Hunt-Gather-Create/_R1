/**
 * Rollout coverage: a pure function of a schedule discovery and each chosen
 * sheet's run report status.
 *
 * The denominator is every Drive file that matches the schedule name rule,
 * plus every live or proposed ledger job with no such file. Each reads
 * exactly one label, and superseded versions say so by rule, never from a list.
 */
import type { RunReportReader, RunReportStatus } from "./run-report-status";
import type { ScheduleDiscovery } from "./schedule-discovery";
import type { DriveFile } from "./schedule-files";

export type CoverageLabel = "DEPLOYED" | "FAILED" | "COULD-NOT-TELL" | "SUPERSEDED" | "MISSING";

/** Ledger statuses whose jobs owe a schedule. */
export const COUNTED_STATUSES = ["live", "proposed"];

export interface CoverageRow {
  label: CoverageLabel;
  job: string | null;
  sheetId: string | null;
  name: string;
  detail: string;
}

export interface CoverageCounts {
  covered: number;
  superseded: number;
  missing: number;
  failed: number;
  couldNotTell: number;
}

export interface CoverageResult {
  total: number;
  rows: CoverageRow[];
  counts: CoverageCounts;
  /** DEPLOYED over rows not SUPERSEDED, null when nothing is left to cover. */
  percent: number | null;
}

/** A chosen sheet's state from its most recent run report. */
export function stateForReport(status: RunReportStatus): { label: CoverageLabel; detail: string } {
  switch (status.kind) {
    case "clean":
      return { label: "DEPLOYED", detail: `clean run, ${status.path}` };
    case "failed":
      return { label: "FAILED", detail: `${status.reason}, ${status.path}` };
    case "none":
      return { label: "FAILED", detail: "chosen, no run report" };
    case "could-not-tell":
      return { label: "COULD-NOT-TELL", detail: status.reason };
  }
}

const fileRow = (label: CoverageLabel, job: string | null, f: DriveFile, detail: string): CoverageRow => ({
  label,
  job,
  sheetId: f.id,
  name: f.name,
  detail,
});

export function buildCoverage(args: { discovery: ScheduleDiscovery; readReport: RunReportReader }): CoverageResult {
  const rows: CoverageRow[] = [];
  for (const entry of args.discovery.jobs) {
    const job = entry.job.jobNumber;
    if (entry.kind === "chosen") {
      const { label, detail } = stateForReport(args.readReport(entry.config.sheetId));
      const via = entry.config.fromRegistry ? "; chosen by a sheet_registry row" : "";
      rows.push({ label, job, sheetId: entry.config.sheetId, name: entry.file?.name ?? entry.job.engagement, detail: detail + via });
      for (const f of entry.superseded) {
        rows.push(fileRow("SUPERSEDED", job, f, `job ${job} chose ${entry.config.sheetId}`));
      }
    } else if (entry.kind === "refused") {
      for (const f of entry.files) rows.push(fileRow("COULD-NOT-TELL", job, f, entry.reason));
      if (entry.files.length === 0) rows.push({ label: "COULD-NOT-TELL", job, sheetId: null, name: entry.job.engagement, detail: entry.reason });
    } else if (COUNTED_STATUSES.includes(entry.job.status)) {
      rows.push({ label: "MISSING", job, sheetId: null, name: entry.job.engagement, detail: `${entry.job.status} job with no schedule in Drive` });
    }
  }
  for (const f of args.discovery.unowned) rows.push(fileRow("MISSING", null, f, "no job ledger number starts this file name"));

  const count = (l: CoverageLabel) => rows.filter((r) => r.label === l).length;
  const counts: CoverageCounts = {
    covered: count("DEPLOYED"),
    superseded: count("SUPERSEDED"),
    missing: count("MISSING"),
    failed: count("FAILED"),
    couldNotTell: count("COULD-NOT-TELL"),
  };
  const target = rows.length - counts.superseded;
  return { total: rows.length, rows, counts, percent: target > 0 ? (100 * counts.covered) / target : null };
}

export function renderCoverage(result: CoverageResult, source: string): string {
  const c = result.counts;
  const percent =
    result.percent === null
      ? "percent rolled out: none, nothing left to cover"
      : `percent rolled out: ${result.percent.toFixed(1)}%, ${c.covered} deployed of ${result.total - c.superseded} not superseded`;
  const width = Math.max(0, ...result.rows.map((r) => r.label.length));
  const lines = [
    `Sheet coverage: ${result.total} row(s), from ${source}`,
    `covered ${c.covered}, superseded ${c.superseded}, missing ${c.missing}, failed ${c.failed}, could-not-tell ${c.couldNotTell}`,
    percent,
    "",
    ...result.rows.map((r) => `${r.label.padEnd(width)} ${r.job ?? "no job"} | ${r.name} | ${r.sheetId ?? "no sheet"} | ${r.detail}`),
  ];
  return lines.join("\n") + "\n";
}
