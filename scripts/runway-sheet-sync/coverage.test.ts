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
// Registered or excluded after this listing was captured, so not in it.
const PHASE_2 = "1K3nJwAO6DaFmcJYwFsGPOZZWMCh9rf8CvudnBQfvCF8";
const PHASE_2_OLDER = ["1xwos_75MXjkg4E724KHz_NnYVf4gOkR0kjrjEuGL_Cw", "1u9USwJk_AkKBNjjrnkLnz6gG0qF-z6Yv08sZDs50Wcw"];
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

  it("reads every registered sheet in the listing with no run report as FAILED", () => {
    for (const s of SHEETS.filter((s) => s.sheetId !== PHASE_2)) {
      expect(result.rows.find((r) => r.sheetId === s.sheetId)?.label).toBe("FAILED");
    }
    expect(result.registeredNotInDrive.map((r) => r.sheetId)).toEqual([PHASE_2]);
  });

  it("matches every real exclusion to a sheet in the listing, except the newer Phase 2 ones", () => {
    expect(result.staleExclusions.map((e) => e.sheetId)).toEqual(PHASE_2_OLDER);
    expect(result.counts.excluded).toBe(COVERAGE_EXCLUSIONS.length - PHASE_2_OLDER.length);
  });

  it("reads the second NFM file with the registered plan's name as EXCLUDED, with its reason", () => {
    const row = result.rows.find((r) => r.sheetId === "1giFx_-ewRrX-vpDxsNWUWBxxWlpBh_wtu0C-Jtu6sWs");
    expect(row?.label).toBe("EXCLUDED");
    const reason =
      "A second Drive file with the same name as the registered NFM plan; the registered sheet is 14x2WqepMH2iexwinkZ1mQQJY37TbSvqu1NhBqNL_dp0.";
    expect(row?.detail.startsWith(reason)).toBe(true);
    const registered = result.rows.find((r) => r.sheetId === "14x2WqepMH2iexwinkZ1mQQJY37TbSvqu1NhBqNL_dp0");
    expect(registered?.label).not.toBe("EXCLUDED");
  });

  it("carries discovery's notes, such as the superseded registered ITEP v1", () => {
    const itepV1 = result.rows.find((r) => r.sheetId === "1e0VtdHSGG-LMpQqeZ9Bm709fPSYGjrIBOi2sNFKObog");
    expect(itepV1?.detail).toMatch(/not the latest plan/);
  });

  it("renders a percent over Drive sheets that are not excluded", () => {
    const out = renderCoverage(result, "frozen listing");
    expect(out).toContain(`0 deployed of ${listing.length - result.counts.excluded} not excluded`);
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
