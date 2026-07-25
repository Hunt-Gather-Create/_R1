import { describe, expect, it } from "vitest";
import { classifyRows } from "./classify";
import type { RowType } from "./types";

/**
 * Synthetic grid modeled on the observed shapes — no client content.
 * Covers: variant-A banner zone, rollup (span-envelope), section headers,
 * numbered leaves, unnumbered dated leaf, milestone (with and without
 * predecessor values), empty-template, spacer.
 */
const GRID: (string | undefined)[][] = [
  ["", "CIVILIZATION", "", "", "", "", "", "", "", "", "", "", "", ""], // 1
  [], // 2
  ["", "Acme | Project Plan", "", "", "", "", "", "", "", "7", "", "", "", ""], // 3
  [], // 4
  ["", "Widget Refresh  |   ACM-2601-01", "", "", "", "", "", "", "", "", "16", "", "", ""], // 5
  [], // 6
  [], // 7
  ["", "OVERALL PROGRESS", "", "", "", "", "", "", "", "", "", "", "", ""], // 8
  [], // 9
  ["", "✔", "TASKS", "PRIORITY", "START DATE", "DUE DATE", "DURATION", "PREDECESSOR", "LAG", "RESOURCE", "STATUS", "DURATION", "DAYS LEFT", "%"], // 10
  ["", "FALSE", "Widget Release", "", "1-Jun-2026", "30-Jun-2026", "", "", "", "", "", "", "", ""], // 11 rollup (spans all)
  ["", "TRUE", "   1.1 Kickoff call", "", "1-Jun-2026", "1-Jun-2026", "", "", "", "Civ + Acme", "", "", "", ""], // 12 leaf
  ["", "FALSE", "Design Sprint", "", "2-Jun-2026", "10-Jun-2026", "", "", "", "", "", "", "", ""], // 13 section
  ["", "FALSE", "   2.1 Comps", "High", "2-Jun-2026", "5-Jun-2026", "", "12", "1", "Civ Design", "", "", "", ""], // 14 leaf
  ["", "FALSE", "   Buffer / contingency", "", "8-Jun-2026", "10-Jun-2026", "", "14", "1", "Civ Dev (hold)", "", "", "", ""], // 15 leaf-unnumbered
  ["", "FALSE", "*** STAGE 1 COMPLETE ***", "", "10-Jun-2026", "10-Jun-2026", "", "14", "0", "", "", "", "", ""], // 16 milestone w/ predecessor
  ["", "FALSE", "Launch", "", "30-Jun-2026", "30-Jun-2026", "", "", "", "", "", "", "", ""], // 17 section
  ["", "FALSE", "   3.1 Go live", "", "30-Jun-2026", "30-Jun-2026", "", "16", "1", "Civ Dev", "", "", "", ""], // 18 leaf
  ["", "FALSE", "*** LIVE ***", "", "30-Jun-2026", "30-Jun-2026", "", "", "", "", "", "", "", ""], // 19 milestone
  ["", "FALSE", "", "", "1-Jan-2026", "", "", "", "", "", "", "", "-", "-"], // 20 empty-template
  [], // 21 spacer
];

function typeOf(rows: ReturnType<typeof classifyRows>["rows"], rowNumber: number): RowType {
  return rows.find((r) => r.rowNumber === rowNumber)!.type;
}

describe("classifyRows", () => {
  const { rows, headerRowNumber } = classifyRows(GRID);

  it("finds the column-header row", () => {
    expect(headerRowNumber).toBe(10);
    expect(typeOf(rows, 10)).toBe("column-header");
  });

  it("classifies banner zone as pre-header", () => {
    for (const n of [1, 2, 3, 5, 8]) expect(typeOf(rows, n)).toBe("pre-header");
  });

  it("promotes the engagement-spanning row to rollup", () => {
    expect(typeOf(rows, 11)).toBe("rollup");
  });

  it("keeps non-spanning unindented rows as section headers", () => {
    expect(typeOf(rows, 13)).toBe("section-header");
    expect(typeOf(rows, 17)).toBe("section-header");
  });

  it("classifies numbered leaves", () => {
    expect(typeOf(rows, 12)).toBe("leaf");
    expect(typeOf(rows, 14)).toBe("leaf");
    expect(typeOf(rows, 18)).toBe("leaf");
  });

  it("catches indented+dated rows without numeric prefix as leaf-unnumbered", () => {
    expect(typeOf(rows, 15)).toBe("leaf-unnumbered");
  });

  it("classifies milestones including ones carrying predecessor/lag values", () => {
    expect(typeOf(rows, 16)).toBe("milestone");
    expect(typeOf(rows, 19)).toBe("milestone");
  });

  it("separates empty-template rows from spacers", () => {
    expect(typeOf(rows, 20)).toBe("empty-template");
    expect(typeOf(rows, 21)).toBe("spacer");
  });

  it("handles a sheet with no rollup (first data row is a section header)", () => {
    const noRollup = [
      GRID[9], // header at row 1 of this grid
      ["", "FALSE", "Kickoff & Brief", "", "13-Jul-2026", "13-Jul-2026", "", "", "", "", "", "", "", ""],
      ["", "FALSE", "   1.1 Walk brief", "", "13-Jul-2026", "13-Jul-2026", "", "", "", "Design", "", "", "", ""],
      ["", "FALSE", "Build", "", "14-Jul-2026", "20-Aug-2026", "", "", "", "", "", "", "", ""],
      ["", "FALSE", "   2.1 Build it", "", "14-Jul-2026", "20-Aug-2026", "", "2", "1", "Dev", "", "", "", ""],
    ];
    const res = classifyRows(noRollup);
    // "Kickoff & Brief" spans only 7/13 — not the whole engagement (through 8/20).
    expect(res.rows[1].type).toBe("section-header");
    // "Build" spans 7/14-8/20 but not the kickoff's 7/13 — no envelope, no rollup.
    expect(res.rows[3].type).toBe("section-header");
  });
});
