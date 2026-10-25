/**
 * Runway sheet coverage: every schedule Drive holds and every live or
 * proposed ledger job, each read as DEPLOYED, FAILED, COULD-NOT-TELL,
 * SUPERSEDED or MISSING. Reads only.
 *
 * Usage:
 *   pnpm runway:sheet-coverage
 *   pnpm runway:sheet-coverage -- --out <dir>   # run report folder, default docs/tmp/data/runway-sync
 *
 * The denominator comes from schedule discovery: the job ledger named by
 * RUNWAY_JOB_LEDGER_SHEET_ID and a Drive search, with clients and
 * sheet_registry read from runway-staging, the same database a dry run reads.
 * Exit 0 full coverage, 2 a gap, 1 discovery could not run.
 */
import { createRunwayDb } from "./lib/run-script";
import { runCoverage } from "./runway-sheet-sync/coverage-command";
import { discoverForRun, liveDiscoveryDeps } from "./runway-sheet-sync/discover-live";
import { DRIVE_PLAN_QUERY } from "./runway-sheet-sync/drive-plan-listing";
import { JOB_LEDGER_ENV } from "./runway-sheet-sync/job-ledger";
import { reportStatusReader } from "./runway-sheet-sync/run-report-status";

const DEFAULT_OUT_DIR = "docs/tmp/data/runway-sync";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main(): Promise<void> {
  const outDir = arg("out") ?? DEFAULT_OUT_DIR;
  const { exitCode, output } = await runCoverage({
    discover: () => discoverForRun(process.env, liveDiscoveryDeps(createRunwayDb({ staging: true }).db)),
    readReport: reportStatusReader(outDir),
    source: `the job ledger in ${JOB_LEDGER_ENV} and Drive query ${DRIVE_PLAN_QUERY}`,
  });
  process.stdout.write(output);
  process.exit(exitCode);
}

main().catch((err) => {
  console.error("runway-sheet-coverage failed:", err);
  process.exit(1);
});
