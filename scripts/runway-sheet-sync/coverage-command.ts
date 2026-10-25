/**
 * The coverage command's logic, with discovery and report reading injected
 * so tests never touch Drive. Exit codes: 0 when every row not superseded is
 * DEPLOYED, 2 when any is not, 1 when discovery cannot run.
 */
import { buildCoverage, renderCoverage } from "./coverage";
import type { RunReportReader } from "./run-report-status";
import type { ScheduleDiscovery } from "./schedule-discovery";

export interface CoverageDeps {
  discover: () => Promise<ScheduleDiscovery>;
  readReport: RunReportReader;
  /** Where the listing came from, printed in the header. */
  source: string;
}

const DISCOVERY_FAILED = "runway-sheet-coverage: cannot discover schedules, no coverage reported";

export async function runCoverage(deps: CoverageDeps): Promise<{ exitCode: number; output: string }> {
  let discovery: ScheduleDiscovery;
  try {
    discovery = await deps.discover();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, output: `${DISCOVERY_FAILED}: ${message.replace(/\s+/g, " ")}\n` };
  }
  if (discovery.listing.length === 0) {
    return { exitCode: 1, output: `${DISCOVERY_FAILED}: the Drive listing is empty\n` };
  }

  const result = buildCoverage({ discovery, readReport: deps.readReport });
  const c = result.counts;
  const exitCode = c.missing + c.failed + c.couldNotTell === 0 ? 0 : 2;
  return { exitCode, output: renderCoverage(result, deps.source) };
}
