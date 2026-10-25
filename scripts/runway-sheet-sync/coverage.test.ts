/**
 * buildCoverage over a synthetic discovery: a ledger, a Drive listing and
 * clients that are all invented, with no run reports on disk.
 */
import { describe, expect, it } from "vitest";
import { buildCoverage, renderCoverage, stateForReport } from "./coverage";
import { discoverSchedules } from "./schedule-discovery";
import { driveFile, ledgerJob, SYN_CLIENTS } from "./schedule.test-fixtures";

const JOBS = [
  ledgerJob("ACW-2601", "Acme Widgets", "Two Versions"),
  ledgerJob("ACW-2602", "Acme Widgets", "Twin Files", "proposed"),
  ledgerJob("GLX-2601", "Globex", "Nothing Yet"),
  ledgerJob("GLX-2602", "Globex", "Long Done", "shipped"),
  ledgerJob("GLX-2603", "Initech", "Unknown Client"),
];
const LISTING = [
  driveFile("syn-two-v1", "ACW-2601_two-versions_Project-Plan-v1"),
  driveFile("syn-two-v2", "ACW-2601_two-versions_Project-Plan-v2"),
  driveFile("syn-twin-a", "ACW-2602 | Twin Files Schedule v1"),
  driveFile("syn-twin-b", "ACW-2602 | Twin Files Schedule v1"),
  driveFile("syn-stray", "ZZZ-2601 Schedule v1"),
  driveFile("syn-client", "GLX-2603 Schedule v1"),
  driveFile("syn-not-a-schedule", "ACW-2601 budget"),
];
const discovery = discoverSchedules({ jobs: JOBS, listing: LISTING, clients: SYN_CLIENTS, overrides: [] });
const result = buildCoverage({ discovery, readReport: () => ({ kind: "none" }) });
const row = (id: string) => result.rows.find((r) => r.sheetId === id);

describe("buildCoverage on a synthetic discovery", () => {
  it("gives every schedule file one row and every live or proposed job without a file one row", () => {
    const fileIds = result.rows.flatMap((r) => (r.sheetId ? [r.sheetId] : [])).sort();
    expect(fileIds).toEqual(LISTING.filter((f) => f.id !== "syn-not-a-schedule").map((f) => f.id).sort());
    expect(result.rows.filter((r) => r.sheetId === null).map((r) => r.job)).toEqual(["GLX-2601"]);
    const c = result.counts;
    expect(c.covered + c.superseded + c.missing + c.failed + c.couldNotTell).toBe(result.total);
  });

  it("rule 2: the older version reads SUPERSEDED by rule and the chosen one reads its report state", () => {
    expect(row("syn-two-v1")).toMatchObject({ label: "SUPERSEDED", job: "ACW-2601" });
    expect(row("syn-two-v2")).toMatchObject({ label: "FAILED", detail: "chosen, no run report" });
  });

  it("rule 3: both same-name files read COULD-NOT-TELL, naming both ids", () => {
    for (const id of ["syn-twin-a", "syn-twin-b"]) {
      expect(row(id)?.label).toBe("COULD-NOT-TELL");
      expect(row(id)?.detail).toMatch(/syn-twin-a.*syn-twin-b/);
    }
  });

  it("rule 4: a job whose client maps to nothing reads COULD-NOT-TELL with the client text", () => {
    expect(row("syn-client")).toMatchObject({ label: "COULD-NOT-TELL" });
    expect(row("syn-client")?.detail).toMatch(/"Initech"/);
  });

  it("a live job with no file and a file with no job both read MISSING; a shipped job with no file is outside the count", () => {
    expect(result.rows.find((r) => r.job === "GLX-2601")).toMatchObject({ label: "MISSING", detail: "live job with no schedule in Drive" });
    expect(row("syn-stray")).toMatchObject({ label: "MISSING", job: null });
    expect(result.rows.some((r) => r.job === "GLX-2602")).toBe(false);
  });

  it("a sheet_registry row is named in the chosen row's detail", () => {
    const pinned = discoverSchedules({
      jobs: JOBS,
      listing: LISTING,
      clients: SYN_CLIENTS,
      overrides: [{ engagementKey: "ACW-2601", currentSheetId: "syn-two-v1" }],
    });
    const rows = buildCoverage({ discovery: pinned, readReport: () => ({ kind: "clean", path: "p" }) }).rows;
    expect(rows.find((r) => r.sheetId === "syn-two-v1")).toMatchObject({ label: "DEPLOYED" });
    expect(rows.find((r) => r.sheetId === "syn-two-v1")?.detail).toMatch(/sheet_registry/);
    expect(rows.find((r) => r.sheetId === "syn-two-v2")?.label).toBe("SUPERSEDED");
  });

  it("renders a percent over rows that are not superseded", () => {
    const out = renderCoverage(result, "synthetic");
    expect(out).toContain(`0 deployed of ${result.total - 1} not superseded`);
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
