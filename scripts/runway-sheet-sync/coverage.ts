/**
 * Rollout coverage: a pure function of a Drive listing, the registry, the
 * exclusions list and each registered sheet's run report status.
 *
 * The denominator is the Drive listing. Every Drive sheet gets exactly one
 * label, and every exclusion stays in the output with its reason.
 */
import type { CoverageExclusion } from "./coverage-exclusions";
import { discoverPlans, type DriveFile } from "./discovery";
import type { RunReportReader, RunReportStatus } from "./run-report-status";
import type { SheetConfig } from "./types";

export type CoverageLabel = "DEPLOYED" | "FAILED" | "COULD-NOT-TELL" | "EXCLUDED" | "MISSING";

export interface CoverageRow {
  label: CoverageLabel;
  sheetId: string;
  name: string;
  detail: string;
}

export interface CoverageCounts {
  covered: number;
  excluded: number;
  missing: number;
  failed: number;
  couldNotTell: number;
}

export interface CoverageResult {
  driveTotal: number;
  rows: CoverageRow[];
  counts: CoverageCounts;
  /** DEPLOYED over Drive sheets not excluded, null when nothing is left to cover. */
  percent: number | null;
  exclusions: CoverageExclusion[];
  registeredNotInDrive: SheetConfig[];
  staleExclusions: CoverageExclusion[];
}

/** A registered sheet's state from its most recent run report. */
export function stateForReport(status: RunReportStatus): { label: CoverageLabel; detail: string } {
  switch (status.kind) {
    case "clean":
      return { label: "DEPLOYED", detail: `clean run, ${status.path}` };
    case "failed":
      return { label: "FAILED", detail: `${status.reason}, ${status.path}` };
    case "none":
      return { label: "FAILED", detail: "registered, no run report" };
    case "could-not-tell":
      return { label: "COULD-NOT-TELL", detail: status.reason };
  }
}

/** Discovery's own buckets, reused as per-sheet notes a person should see. */
function discoveryNotes(registry: SheetConfig[], listing: DriveFile[]): Map<string, string[]> {
  const report = discoverPlans(registry, listing);
  const notes = new Map<string, string[]>();
  const add = (id: string, note: string) => notes.set(id, [...(notes.get(id) ?? []), note]);
  for (const s of report.superseded) add(s.sheetId, `not the latest plan: ${s.reason}`);
  for (const d of report.duplicates) for (const id of d.ids) add(id, "another Drive file has the same name");
  for (const p of report.pendingClearanceOrTest) add(p.id, "pending clearance or test file");
  for (const u of report.unrecognizedShape) add(u.id, "title shape not recognised");
  return notes;
}

export function buildCoverage(args: {
  listing: DriveFile[];
  registry: SheetConfig[];
  exclusions: CoverageExclusion[];
  readReport: RunReportReader;
}): CoverageResult {
  const { listing, registry, exclusions, readReport } = args;
  const registered = new Map(registry.map((r) => [r.sheetId, r]));
  const excluded = new Map(exclusions.map((e) => [e.sheetId, e]));
  const driveIds = new Set(listing.map((f) => f.id));
  const notes = discoveryNotes(registry, listing);

  const rows: CoverageRow[] = listing.map((file) => {
    const extra = [...(notes.get(file.id) ?? [])];
    let label: CoverageLabel;
    let detail: string;
    if (registered.has(file.id)) {
      ({ label, detail } = stateForReport(readReport(file.id)));
      if (excluded.has(file.id)) extra.push("also in coverage-exclusions.ts, the registry wins, remove one");
    } else if (excluded.has(file.id)) {
      label = "EXCLUDED";
      detail = excluded.get(file.id)!.reason;
    } else {
      label = "MISSING";
      detail = "not in the registry and not excluded";
    }
    return { label, sheetId: file.id, name: file.name, detail: [detail, ...extra].join("; ") };
  });

  const count = (l: CoverageLabel) => rows.filter((r) => r.label === l).length;
  const counts: CoverageCounts = {
    covered: count("DEPLOYED"),
    excluded: count("EXCLUDED"),
    missing: count("MISSING"),
    failed: count("FAILED"),
    couldNotTell: count("COULD-NOT-TELL"),
  };
  const target = listing.length - counts.excluded;

  return {
    driveTotal: listing.length,
    rows,
    counts,
    percent: target > 0 ? (100 * counts.covered) / target : null,
    exclusions: exclusions.filter((e) => driveIds.has(e.sheetId) && !registered.has(e.sheetId)),
    registeredNotInDrive: registry.filter((r) => !driveIds.has(r.sheetId)),
    staleExclusions: exclusions.filter((e) => !driveIds.has(e.sheetId)),
  };
}

function section(title: string, items: string[]): string[] {
  return ["", title, ...(items.length > 0 ? items.map((i) => `- ${i}`) : ["- none"])];
}

export function renderCoverage(result: CoverageResult, source: string): string {
  const c = result.counts;
  const percent =
    result.percent === null
      ? "percent rolled out: none, every Drive sheet is excluded"
      : `percent rolled out: ${result.percent.toFixed(1)}%, ${c.covered} deployed of ${result.driveTotal - c.excluded} not excluded`;
  const width = Math.max(...result.rows.map((r) => r.label.length));
  const lines = [
    `Sheet coverage: ${result.driveTotal} sheet(s) in Drive, from ${source}`,
    `covered ${c.covered}, excluded ${c.excluded}, missing ${c.missing}, failed ${c.failed}, could-not-tell ${c.couldNotTell}`,
    percent,
    "",
    ...result.rows.map((r) => `${r.label.padEnd(width)} ${r.name} | ${r.sheetId} | ${r.detail}`),
    ...section(
      "Exclusions, each with its reason:",
      result.exclusions.map((e) => `${e.name} | ${e.sheetId} | ${e.reason}`)
    ),
    ...section(
      "Registered but not in this Drive listing, outside the count:",
      result.registeredNotInDrive.map((r) => `${r.sheetId} | ${r.label}`)
    ),
    ...section(
      "Exclusions naming a sheet not in this Drive listing:",
      result.staleExclusions.map((e) => `${e.name} | ${e.sheetId} | ${e.reason}`)
    ),
  ];
  return lines.join("\n") + "\n";
}
