/**
 * Runway sheet coverage: every plan sheet Drive holds, each read as
 * DEPLOYED, FAILED, COULD-NOT-TELL, EXCLUDED or MISSING. Reads only.
 *
 * Usage:
 *   pnpm runway:sheet-coverage
 *   pnpm runway:sheet-coverage -- --out <dir>   # run report folder, default docs/tmp/data/runway-sync
 *
 * The denominator comes from Drive through the google-api CLI, never from
 * config.ts. Exit 0 full coverage, 2 a gap, 1 Drive could not be listed.
 */
import { COVERAGE_EXCLUSIONS } from "./runway-sheet-sync/coverage-exclusions";
import { runCoverage } from "./runway-sheet-sync/coverage-command";
import { SHEETS } from "./runway-sheet-sync/config";
import { DRIVE_PLAN_QUERY, listDrivePlanSheets } from "./runway-sheet-sync/drive-plan-listing";
import { reportStatusReader } from "./runway-sheet-sync/run-report-status";

const DEFAULT_OUT_DIR = "docs/tmp/data/runway-sync";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main(): Promise<void> {
  const outDir = arg("out") ?? DEFAULT_OUT_DIR;
  const { exitCode, output } = await runCoverage({
    listDrive: () => listDrivePlanSheets(),
    registry: SHEETS,
    exclusions: COVERAGE_EXCLUSIONS,
    readReport: reportStatusReader(outDir),
    source: `Drive query ${DRIVE_PLAN_QUERY}`,
  });
  process.stdout.write(output);
  process.exit(exitCode);
}

main().catch((err) => {
  console.error("runway-sheet-coverage failed:", err);
  process.exit(1);
});
