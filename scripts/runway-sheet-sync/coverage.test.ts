/**
 * buildCoverage over the frozen 2026-09-27 Drive listing, the real registry
 * and the real exclusions list, with no run reports on disk.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { SHEETS } from "./config";
import { buildCoverage, renderCoverage, stateForReport } from "./coverage";
import { COVERAGE_EXCLUSIONS } from "./coverage-exclusions";
import type { DriveFile } from "./discovery";

const FIXTURE_PATH = join(__dirname, "__fixtures__", "drive-listing-2026-09-27.json");
const listing = (JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as { files: DriveFile[] }).files;
const result = buildCoverage({
  listing,
  registry: SHEETS,
  exclusions: COVERAGE_EXCLUSIONS,
  readReport: () => ({ kind: "none" }),
});

describe("buildCoverage on the frozen listing", () => {
  it("gives every Drive sheet exactly one row, so the denominator is the listing", () => {
    expect(result.driveTotal).toBe(listing.length);
    expect(result.rows.map((r) => r.sheetId).sort()).toEqual(listing.map((f) => f.id).sort());
    const c = result.counts;
    expect(c.covered + c.excluded + c.missing + c.failed + c.couldNotTell).toBe(listing.length);
  });

  it("puts the unregistered ITEP v2 plan in the denominator as MISSING", () => {
    const itepV2 = result.rows.find((r) => r.sheetId === "1cS5yxsnNlXiMX84CwAUBpyEueEph__RmIrf9OTUmtgM");
    expect(itepV2?.label).toBe("MISSING");
  });

  it("reads every registered sheet with no run report as FAILED", () => {
    for (const s of SHEETS) {
      expect(result.rows.find((r) => r.sheetId === s.sheetId)?.label).toBe("FAILED");
    }
  });

  it("matches every real exclusion to a sheet in the listing", () => {
    expect(result.staleExclusions).toEqual([]);
    expect(result.counts.excluded).toBe(COVERAGE_EXCLUSIONS.length);
  });

  it("carries discovery's notes, such as the superseded registered ITEP v1", () => {
    const itepV1 = result.rows.find((r) => r.sheetId === "1e0VtdHSGG-LMpQqeZ9Bm709fPSYGjrIBOi2sNFKObog");
    expect(itepV1?.detail).toMatch(/not the latest plan/);
  });

  it("renders a percent over Drive sheets that are not excluded", () => {
    const out = renderCoverage(result, "frozen listing");
    expect(out).toContain(`0 deployed of ${listing.length - COVERAGE_EXCLUSIONS.length} not excluded`);
  });
});

describe("stateForReport", () => {
  it("maps each report status to one state", () => {
    expect(stateForReport({ kind: "clean", path: "p" }).label).toBe("DEPLOYED");
    expect(stateForReport({ kind: "failed", path: "p", reason: "ERROR: x" }).label).toBe("FAILED");
    expect(stateForReport({ kind: "none" }).label).toBe("FAILED");
    expect(stateForReport({ kind: "could-not-tell", reason: "EACCES" }).label).toBe("COULD-NOT-TELL");
  });
});
