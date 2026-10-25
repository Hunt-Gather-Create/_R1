/**
 * The job ledger reader over synthetic grids. No real ledger is read.
 */
import { describe, expect, it } from "vitest";
import { JOB_LEDGER_ENV, parseJobLedger, readJobLedger, requireJobLedgerSheetId, type Grid } from "./job-ledger";

const JOB_HEADER = ["Job #", "Client", "Engagement", "Status", "Year", "SOW Signed", "SOW File ID", "Folder ID"];
const PREFIX_HEADER = ["Prefix", "Client Full Name", "Drive Root ID", "Active?", "Notes"];

const JOBS: Grid = [
  JOB_HEADER,
  ["acw-2604-02", " Acme Widgets ", "Phase Two", "Live", "2026", "TRUE", "", ""],
  [],
  ["GLX-2605", "Globex", "Launch Site", "proposed"],
];
const PREFIXES: Grid = [PREFIX_HEADER, ["ACW", "Acme Widgets Inc", "", "TRUE", ""], ["GLX", "Globex Corp", "", "no", ""]];

describe("requireJobLedgerSheetId", () => {
  it("a missing id stops with one plain line naming the variable", () => {
    for (const env of [{}, { [JOB_LEDGER_ENV]: "   " }]) {
      let message = "";
      try {
        requireJobLedgerSheetId(env);
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toBe(
        "RUNWAY_JOB_LEDGER_SHEET_ID is not set, so the job ledger cannot be read and no schedule can be found.",
      );
      expect(message).not.toContain("\n");
    }
  });

  it("a set id is returned trimmed", () => {
    expect(requireJobLedgerSheetId({ [JOB_LEDGER_ENV]: " syn-ledger " })).toBe("syn-ledger");
  });
});

describe("parseJobLedger", () => {
  it("reads both tabs by header name, skipping blank rows", () => {
    const ledger = parseJobLedger(JOBS, PREFIXES);
    expect(ledger.jobs).toEqual([
      { jobNumber: "ACW-2604-02", client: "Acme Widgets", engagement: "Phase Two", status: "live" },
      { jobNumber: "GLX-2605", client: "Globex", engagement: "Launch Site", status: "proposed" },
    ]);
    expect(ledger.prefixes).toEqual([
      { prefix: "ACW", fullName: "Acme Widgets Inc", active: true },
      { prefix: "GLX", fullName: "Globex Corp", active: false },
    ]);
  });

  it("finds columns by name, not position", () => {
    const shuffled: Grid = [[...JOB_HEADER].reverse(), ["", "", "", "", "shipped", "Old Work", "Globex", "GLX-2501"]];
    expect(parseJobLedger(shuffled, PREFIXES).jobs[0]).toEqual({
      jobNumber: "GLX-2501",
      client: "Globex",
      engagement: "Old Work",
      status: "shipped",
    });
  });

  it("a missing header column refuses, naming it", () => {
    expect(() => parseJobLedger([JOB_HEADER.filter((h) => h !== "Status")], PREFIXES)).toThrow(/"Job Numbers".*"Status"/);
    expect(() => parseJobLedger(JOBS, [["Prefix"]])).toThrow(/"Client Prefixes".*"Client Full Name"/);
  });

  it("a prefix with a digit and two suffix groups both parse as job numbers", () => {
    const grid: Grid = [JOB_HEADER, ["zq7-2601", "Acme Widgets", "Digit Prefix", "live"], ["ZQX-2501-03-35", "Globex", "Two Groups", "live"]];
    const ledger = parseJobLedger(grid, PREFIXES);
    expect(ledger.jobs.map((j) => j.jobNumber)).toEqual(["ZQ7-2601", "ZQX-2501-03-35"]);
    expect(ledger.skipped).toEqual([]);
  });

  it("a malformed row is skipped and counted with its text, and the rows after it still parse", () => {
    const grid: Grid = [JOB_HEADER, ["ACW2604", "x", "y", "live"], ["ACW-26O4", "x", "y", "live"], ["GLX-2605", "Globex", "Launch Site", "live"]];
    const ledger = parseJobLedger(grid, PREFIXES);
    expect(ledger.jobs.map((j) => j.jobNumber)).toEqual(["GLX-2605"]);
    expect(ledger.skipped.map((s) => s.text)).toEqual(["ACW2604", "ACW-26O4"]);
    expect(ledger.skipped[0].reason).toMatch(/not shaped like/);
  });

  it("a repeated job number skips every copy, naming the count", () => {
    const grid: Grid = [JOB_HEADER, ["ACW-2604", "x", "y"], ["acw-2604", "x", "z"], ["GLX-2605", "Globex", "Launch Site"]];
    const ledger = parseJobLedger(grid, PREFIXES);
    expect(ledger.jobs.map((j) => j.jobNumber)).toEqual(["GLX-2605"]);
    expect(ledger.skipped).toEqual([{ text: "ACW-2604", reason: "listed 2 times" }]);
  });
});

describe("readJobLedger", () => {
  it("reads both named tabs from the given sheet", async () => {
    const calls: string[] = [];
    const ledger = await readJobLedger("syn-ledger", async (id, range) => {
      calls.push(`${id} ${range}`);
      return range.startsWith("'Job Numbers'") ? JOBS : PREFIXES;
    });
    expect(calls.sort()).toEqual(["syn-ledger 'Client Prefixes'!A:Z", "syn-ledger 'Job Numbers'!A:Z"]);
    expect(ledger.jobs).toHaveLength(2);
  });
});
