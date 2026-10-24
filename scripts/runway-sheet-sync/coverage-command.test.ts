/**
 * The coverage command over a stub Drive listing, the real run-report reader
 * on a temp folder, and a hand-built registry and exclusions list. No real
 * Drive call and no real google-api CLI run here.
 */
import { chmodSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCoverage } from "./coverage-command";
import type { CoverageExclusion } from "./coverage-exclusions";
import type { DriveFile } from "./discovery";
import { reportStatusReader } from "./run-report-status";
import type { SheetConfig } from "./types";

const reg = (sheetId: string, label: string): SheetConfig => ({
  sheetId,
  clientSlug: "acme",
  engagementCode: "ACME-9001",
  label,
  planSlug: label.toLowerCase(),
});
const file = (id: string, name: string): DriveFile => ({ id, name, modifiedTime: "2026-10-01T00:00:00.000Z" });

const LISTING: DriveFile[] = [
  file("SYN-clean", "ACME-9001_clean_Project-Plan-v1"),
  file("SYN-refused", "ACME-9002_refused_Project-Plan-v1"),
  file("SYN-excluded", "ACME-9003_old_Project-Plan-v1"),
  file("SYN-unregistered", "ACME-9004_new_Project-Plan-v1"),
];
const REGISTRY = [reg("SYN-clean", "Clean"), reg("SYN-refused", "Refused")];
const EXCLUSIONS: CoverageExclusion[] = [
  { sheetId: "SYN-excluded", name: "ACME-9003_old_Project-Plan-v1", reason: "Superseded by a v2 that is registered." },
];

const CLEAN_REPORT = "# Runway Sheet Sync Diff Report\n\n## Summary\n\n| matched | 4 |\n";
const ERROR_REPORT =
  "# Runway Sheet Sync Diff Report\n\n> **ERROR: ledger populated, nothing matched.** Do not apply these payloads.\n";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "runway-coverage-"));
  writeFileSync(join(dir, "diff-SYN-clean-2026-10-20.md"), CLEAN_REPORT);
  writeFileSync(join(dir, "diff-SYN-refused-2026-10-20.md"), ERROR_REPORT);
});
afterEach(() => {
  chmodSync(dir, 0o755);
});

function run(listing: DriveFile[], registry = REGISTRY) {
  return runCoverage({
    listDrive: async () => listing,
    registry,
    exclusions: EXCLUSIONS,
    readReport: reportStatusReader(dir),
    source: "stub listing",
  });
}

describe("runCoverage", () => {
  it("gives each Drive sheet one state and counts 1 covered, 1 excluded, 1 missing, 1 failed", async () => {
    const { exitCode, output } = await run(LISTING);
    expect(output).toMatch(/^DEPLOYED .*SYN-clean/m);
    expect(output).toMatch(/^FAILED .*SYN-refused/m);
    expect(output).toMatch(/^EXCLUDED .*SYN-excluded/m);
    expect(output).toMatch(/^MISSING .*SYN-unregistered/m);
    expect(output).toContain("covered 1, excluded 1, missing 1, failed 1, could-not-tell 0");
    expect(output).toContain("4 sheet(s) in Drive");
    expect(exitCode).toBe(2);
  });

  it("reads a registered sheet with no run report as FAILED, never as DEPLOYED", async () => {
    const { output } = await run(LISTING, [...REGISTRY, reg("SYN-unregistered", "New")]);
    expect(output).toMatch(/^FAILED .*SYN-unregistered.*no run report/m);
    expect(output).toContain("covered 1, excluded 1, missing 0, failed 2, could-not-tell 0");
  });

  it("exits 0 only when every non-excluded Drive sheet is DEPLOYED", async () => {
    const { exitCode, output } = await run([LISTING[0], LISTING[2]]);
    expect(output).toContain("covered 1, excluded 1, missing 0, failed 0, could-not-tell 0");
    expect(output).toContain("100.0%");
    expect(exitCode).toBe(0);
  });

  it("exits non-zero with one plain line and no counts when Drive cannot be listed", async () => {
    const { exitCode, output } = await runCoverage({
      listDrive: async () => {
        throw new Error("google-api CLI drive:search exited with code 1: 403");
      },
      registry: REGISTRY,
      exclusions: EXCLUSIONS,
      readReport: reportStatusReader(dir),
      source: "stub listing",
    });
    expect(exitCode).toBe(1);
    expect(output.trim().split("\n")).toHaveLength(1);
    expect(output).toMatch(/cannot list Drive/);
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
    expect(output).toContain("covered 0, excluded 1, missing 1, failed 0, could-not-tell 2");
  });

  it("lists an excluded sheet with its reason in the output", async () => {
    const { output } = await run(LISTING);
    expect(output).toMatch(/^EXCLUDED .*SYN-excluded.*Superseded by a v2 that is registered\./m);
    expect(output).toMatch(/Exclusions[^\n]*\n- ACME-9003_old_Project-Plan-v1 \| SYN-excluded \| Superseded/);
  });

  it("names a registered sheet the Drive listing did not return, outside the count", async () => {
    const { output } = await run(LISTING, [...REGISTRY, reg("SYN-gone", "Gone")]);
    expect(output).toMatch(/Registered but not in this Drive listing[^\n]*\n- SYN-gone/);
    expect(output).toContain("4 sheet(s) in Drive");
  });
});
