/**
 * The coverage command over a stub discovery, the real run-report reader
 * on a temp folder, and a synthetic ledger and listing. No real Drive call
 * and no real google-api CLI run here.
 */
import { chmodSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCoverage } from "./coverage-command";
import { reportStatusReader } from "./run-report-status";
import { discoverSchedules, type ScheduleOverride } from "./schedule-discovery";
import type { DriveFile } from "./schedule-files";
import { driveFile, ledgerJob, SYN_CLIENTS } from "./schedule.test-fixtures";

const JOBS = [
  ledgerJob("ACME-9001", "Acme Widgets", "Clean"),
  ledgerJob("ACME-9002", "Acme Widgets", "Refused"),
  ledgerJob("ACME-9003", "Acme Widgets", "Old and New"),
];
const LISTING: DriveFile[] = [
  driveFile("SYN-clean", "ACME-9001_clean_Project-Plan-v1"),
  driveFile("SYN-refused", "ACME-9002_refused_Project-Plan-v1"),
  driveFile("SYN-old", "ACME-9003_old_Project-Plan-v1"),
  driveFile("SYN-unowned", "ACME-9004_new_Project-Plan-v1"),
  driveFile("SYN-new", "ACME-9003_old_Project-Plan-v2"),
];

const CLEAN_REPORT = "# Runway Sheet Sync Diff Report\n\n## Summary\n\n| matched | 4 |\n";
const ERROR_REPORT =
  "# Runway Sheet Sync Diff Report\n\n> **ERROR: ledger populated, nothing matched.** Do not apply these payloads.\n";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "runway-coverage-"));
  writeFileSync(join(dir, "diff-SYN-clean-2026-10-20.md"), CLEAN_REPORT);
  writeFileSync(join(dir, "diff-SYN-refused-2026-10-20.md"), ERROR_REPORT);
  writeFileSync(join(dir, "diff-SYN-new-2026-10-20.md"), CLEAN_REPORT);
});
afterEach(() => {
  chmodSync(dir, 0o755);
});

function run(listing: DriveFile[], jobs = JOBS, overrides: ScheduleOverride[] = []) {
  return runCoverage({
    discover: async () => discoverSchedules({ jobs, listing, clients: SYN_CLIENTS, overrides }),
    readReport: reportStatusReader(dir),
    source: "stub listing",
  });
}

describe("runCoverage", () => {
  it("gives each schedule one state and counts 2 covered, 1 superseded, 1 missing, 1 failed", async () => {
    const { exitCode, output } = await run(LISTING);
    expect(output).toMatch(/^DEPLOYED .*SYN-clean/m);
    expect(output).toMatch(/^FAILED .*SYN-refused/m);
    expect(output).toMatch(/^SUPERSEDED .*SYN-old/m);
    expect(output).toMatch(/^DEPLOYED .*SYN-new/m);
    expect(output).toMatch(/^MISSING .*SYN-unowned/m);
    expect(output).toContain("covered 2, superseded 1, missing 1, failed 1, could-not-tell 0");
    expect(output).toContain("5 row(s)");
    expect(exitCode).toBe(2);
  });

  it("reads a chosen sheet with no run report as FAILED, never as DEPLOYED", async () => {
    const { output } = await run(LISTING, [...JOBS, ledgerJob("ACME-9004", "Acme Widgets", "New")]);
    expect(output).toMatch(/^FAILED .*SYN-unowned.*no run report/m);
    expect(output).toContain("covered 2, superseded 1, missing 0, failed 2, could-not-tell 0");
  });

  it("exits 0 only when every row not superseded is DEPLOYED", async () => {
    const { exitCode, output } = await run([LISTING[0], LISTING[2], LISTING[4]], [JOBS[0], JOBS[2]]);
    expect(output).toContain("covered 2, superseded 1, missing 0, failed 0, could-not-tell 0");
    expect(output).toContain("100.0%");
    expect(exitCode).toBe(0);
  });

  it("exits non-zero with one plain line and no counts when discovery cannot run", async () => {
    const { exitCode, output } = await runCoverage({
      discover: async () => {
        throw new Error("google-api CLI drive:search exited with code 1: 403");
      },
      readReport: reportStatusReader(dir),
      source: "stub listing",
    });
    expect(exitCode).toBe(1);
    expect(output.trim().split("\n")).toHaveLength(1);
    expect(output).toMatch(/cannot discover schedules/);
    expect(output).not.toMatch(/covered|DEPLOYED|MISSING/);
  });

  it("exits non-zero with no counts on an empty Drive listing", async () => {
    const { exitCode, output } = await run([]);
    expect(exitCode).toBe(1);
    expect(output.trim().split("\n")).toHaveLength(1);
    expect(output).not.toMatch(/covered/);
  });

  it("maps a refused read of the run report to COULD-NOT-TELL, not FAILED", async () => {
    chmodSync(dir, 0o000);
    const { output } = await run(LISTING);
    expect(output).toMatch(/^COULD-NOT-TELL .*SYN-clean/m);
    expect(output).toMatch(/^COULD-NOT-TELL .*SYN-refused/m);
    expect(output).not.toMatch(/^FAILED /m);
    expect(output).toContain("covered 0, superseded 1, missing 1, failed 0, could-not-tell 3");
  });

  it("names the newer sheet a superseded one lost to, by rule, with no list in code", async () => {
    const { output } = await run(LISTING);
    expect(output).toMatch(/^SUPERSEDED ACME-9003 \| ACME-9003_old_Project-Plan-v1 \| SYN-old \| job ACME-9003 chose SYN-new$/m);
  });

  it("a sheet_registry row's sheet is the chosen one even when it is the older version", async () => {
    const { output } = await run(LISTING, JOBS, [{ engagementKey: "ACME-9003", currentSheetId: "SYN-old" }]);
    expect(output).toMatch(/^FAILED .*SYN-old.*chosen by a sheet_registry row/m);
    expect(output).toMatch(/^SUPERSEDED .*SYN-new/m);
  });
});
