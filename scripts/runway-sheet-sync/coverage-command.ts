/**
 * The coverage command's logic, with Drive listing and report reading
 * injected so tests never touch Drive. Exit codes: 0 when every Drive sheet
 * not excluded is DEPLOYED, 2 when any is not, 1 when Drive cannot be listed.
 */
import type { CoverageExclusion } from "./coverage-exclusions";
import { buildCoverage, renderCoverage } from "./coverage";
import type { DriveFile } from "./discovery";
import type { RunReportReader } from "./run-report-status";
import type { SheetConfig } from "./types";

export interface CoverageDeps {
  listDrive: () => Promise<DriveFile[]>;
  registry: SheetConfig[];
  exclusions: CoverageExclusion[];
  readReport: RunReportReader;
  /** Where the listing came from, printed in the header. */
  source: string;
}

const LISTING_FAILED = "runway-sheet-coverage: cannot list Drive, no coverage reported";

export async function runCoverage(deps: CoverageDeps): Promise<{ exitCode: number; output: string }> {
  let listing: DriveFile[];
  try {
    listing = await deps.listDrive();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, output: `${LISTING_FAILED}: ${message.replace(/\s+/g, " ")}\n` };
  }
  if (listing.length === 0) {
    return { exitCode: 1, output: `${LISTING_FAILED}: the listing is empty\n` };
  }

  const result = buildCoverage({
    listing,
    registry: deps.registry,
    exclusions: deps.exclusions,
    readReport: deps.readReport,
  });
  const c = result.counts;
  const exitCode = c.missing + c.failed + c.couldNotTell === 0 ? 0 : 2;
  return { exitCode, output: renderCoverage(result, deps.source) };
}
