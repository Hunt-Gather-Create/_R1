import { describe, expect, it } from "vitest";
import { parseSheet } from "./parse-sheet";
import type { SheetConfig, SheetFixture } from "./types";

const CONFIG: SheetConfig = {
  sheetId: "synthetic-sheet-id",
  clientSlug: "acme",
  engagementCode: "ACM-2601-01",
  label: "Widget Refresh",
};

function fixture(values: (string | undefined)[][]): SheetFixture {
  return { sheetId: CONFIG.sheetId, tab: "Task Tracker & Gantt Chart", range: "A1:N", exportedAt: "2026-07-24T00:00:00Z", values };
}

/** Variant-A synthetic grid with a deliberate code drift in the banner. */
const VARIANT_A: (string | undefined)[][] = [
  ["", "CIVILIZATION"], // 1
  [], // 2
  ["", "Acme | Project Plan"], // 3
  [], // 4
  ["", "Widget Refresh  |   ACM-2600-99"], // 5 — drifted code
  [], [], ["", "OVERALL PROGRESS"], [], // 6-9
  ["", "✔", "TASKS", "PRIORITY", "START DATE", "DUE DATE", "DURATION", "PREDECESSOR", "LAG", "RESOURCE", "STATUS", "DURATION", "DAYS LEFT", "%"], // 10
  ["", "FALSE", "Widget Release", "", "1-Jun-2026", "30-Jun-2026"], // 11 rollup
  ["", "TRUE", "   1.1 Kickoff call", "", "1-Jun-2026", "1-Jun-2026", "", "", "", "Civ + Acme"], // 12
  ["", "FALSE", "Design Sprint", "", "2-Jun-2026", "10-Jun-2026"], // 13
  ["", "FALSE", "   2.1 Comps", "High", "2-Jun-2026", "5-Jun-2026", "", "12", "1", "Civ Design"], // 14
  ["", "FALSE", "   2.2 Client review", "", "8-Jun-2026", "9-Jun-2026", "", "14", "1", "Acme"], // 15
  ["", "FALSE", "Launch", "", "30-Jun-2026", "30-Jun-2026"], // 16
  ["", "FALSE", "   3.1 Client review", "", "10-Jun-2026", "10-Jun-2026", "", "15", "1", "Acme", "On going"], // 17 — same title+week as 2.2
  ["", "FALSE", "*** LIVE ***", "", "30-Jun-2026", "30-Jun-2026"], // 18
  ["", "FALSE", "", "", "1-Jan-2026", "", "", "", "", "", "", "", "-", "-"], // 19
];

describe("parseSheet — variant A", () => {
  const parsed = parseSheet(fixture(VARIANT_A), CONFIG);

  it("detects banner variant A and engagement title", () => {
    expect(parsed.meta.bannerVariant).toBe("A");
    expect(parsed.meta.engagementTitle).toBe("Widget Refresh");
    expect(parsed.meta.headerRowNumber).toBe(10);
  });

  it("flags code drift (R7) without failing", () => {
    expect(parsed.meta.bannerCode).toBe("ACM-2600-99");
    expect(parsed.meta.codeDrift).toBe(true);
    expect(parsed.flags.some((f) => f.startsWith("CODE-DRIFT"))).toBe(true);
  });

  it("extracts leaf tasks with derived fields", () => {
    expect(parsed.leafTasks).toHaveLength(4);
    const kickoff = parsed.leafTasks[0];
    expect(kickoff.taskNo).toBe("1.1");
    expect(kickoff.title).toBe("Kickoff call");
    expect(kickoff.startDate).toBe("2026-06-01");
    expect(kickoff.weekOf).toBe("2026-06-01");
    expect(kickoff.derivedStatus).toBe("completed");
    expect(kickoff.category).toBe("kickoff");

    const comps = parsed.leafTasks[1];
    expect(comps.section).toBe("Design Sprint");
    expect(comps.predecessorRow).toBe(12);
    expect(comps.lag).toBe(1);
    expect(comps.priority).toBe("High");
    expect(comps.notes).toBe("[Sheet 2.1] Resource: Civ Design | Predecessor row 12, lag 1 | Priority: High");
  });

  it("assigns sequential sortOrder across leaf tasks", () => {
    expect(parsed.leafTasks.map((t) => t.sortOrder)).toEqual([0, 1, 2, 3]);
  });

  it("disambiguates duplicate (title, weekOf) pairs across sections (§2.7)", () => {
    const dupes = parsed.leafTasks.filter((t) => t.title === "Client review");
    expect(dupes).toHaveLength(2);
    // Both fall in week of 2026-06-08 → suffixed with section context.
    expect(dupes[0].resolvedTitle).toBe("Client review [Design Sprint]");
    expect(dupes[1].resolvedTitle).toBe("Client review [Launch]");
    expect(parsed.flags.some((f) => f.startsWith("IDEMPOTENCY"))).toBe(true);
  });

  it("flags populated col K instead of reading it", () => {
    expect(parsed.flags.some((f) => f.includes('col K carries status text "On going"'))).toBe(true);
  });
});

describe("parseSheet — variant B + unfilled template", () => {
  const VARIANT_B: (string | undefined)[][] = [
    ["", "Client Name: Acme Inc."], // 1
    ["", "Project: Widget Refresh"], // 2
    ["", "TASK TRACKER", "", "", "", "", "", "", "", "", "DONE"], // 3
    [], [], ["", "OVERALL PROGRESS"], [], ["", "0", "0"], // 4-8
    ["", "✔", "TASKS", "PRIORITY", "START DATE", "DUE DATE", "DURATION", "PREDECESSOR", "LAG", "RESOURCE", "STATUS", "DURATION", "DAYS LEFT", "%"], // 9
    ["", "FALSE", "", "", "1-Jan-2026", "", "", "", "", "", "", "", "-", "-"], // 10 template junk
  ];
  const parsed = parseSheet(fixture(VARIANT_B), CONFIG);

  it("detects variant B, header row 9, and flags both", () => {
    expect(parsed.meta.bannerVariant).toBe("B");
    expect(parsed.meta.engagementTitle).toBe("Widget Refresh");
    expect(parsed.meta.headerRowNumber).toBe(9);
    expect(parsed.flags.some((f) => f.includes("variant B"))).toBe(true);
    expect(parsed.flags.some((f) => f.includes("row 9"))).toBe(true);
  });

  it("flags zero leaf tasks as unfilled template", () => {
    expect(parsed.leafTasks).toHaveLength(0);
    expect(parsed.flags.some((f) => f.includes("unfilled template"))).toBe(true);
  });
});

describe("parseSheet — degenerate inputs", () => {
  it("flags missing contract header row and returns no tasks", () => {
    const parsed = parseSheet(fixture([["", "random"], ["", "rows"]]), CONFIG);
    expect(parsed.leafTasks).toHaveLength(0);
    expect(parsed.flags.some((f) => f.includes("column-header row"))).toBe(true);
  });

  it("flags unparseable dates and carries the row with null dates", () => {
    const grid = [
      ["", "✔", "TASKS", "PRIORITY", "START DATE", "DUE DATE", "", "PREDECESSOR", "LAG", "RESOURCE", "STATUS"],
      ["", "FALSE", "   1.1 Task", "", "sometime soon", "5-Jun-2026", "", "", "", ""],
    ];
    const parsed = parseSheet(fixture(grid), CONFIG);
    expect(parsed.leafTasks).toHaveLength(1);
    expect(parsed.leafTasks[0].startDate).toBeNull();
    expect(parsed.leafTasks[0].weekOf).toBeNull();
    expect(parsed.leafTasks[0].endDate).toBe("2026-06-05");
    expect(parsed.flags.some((f) => f.includes("unparseable date"))).toBe(true);
  });
});
