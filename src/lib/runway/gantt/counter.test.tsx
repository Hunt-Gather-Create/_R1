import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  formatCounterConsole,
  formatCounterMarkup,
  formatHeadline,
  formatSeverityLine,
  summarize,
} from "./counter";
import type {
  AnnotatedRow,
  Issue,
  IssueCode,
  ProjectRow,
  Severity,
  Summary,
} from "./types";

const NOW = new Date("2026-04-29T00:00:00Z");

function makeProject(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: "p1",
    clientId: "c1",
    name: "Subject",
    status: null,
    category: null,
    owner: null,
    resources: null,
    waitingOn: null,
    dueDate: null,
    startDate: null,
    endDate: null,
    contractStart: null,
    contractEnd: null,
    engagementType: null,
    parentProjectId: null,
    notes: null,
    staleDays: null,
    sortOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeRow(overrides: Partial<AnnotatedRow> = {}): AnnotatedRow {
  return {
    kind: "weekitem",
    id: "w1",
    title: "Item",
    owner: null,
    resources: null,
    startDate: null,
    endDate: null,
    status: null,
    category: null,
    weekOf: null,
    inline: [],
    subRow: [],
    ...overrides,
  } as AnnotatedRow;
}

function mkIssue(code: IssueCode, severity: Severity = "warn", message = "x"): Issue {
  return { code, message, severity };
}

const entity = makeProject({ id: "p-l1", name: "Sample L1" });

// ── summarize ────────────────────────────────────────────

describe("summarize", () => {
  it("returns zeros and an empty byCode for clean data", () => {
    const result = summarize({
      rows: [makeRow({ id: "a" }), makeRow({ id: "b" })],
      chartIssues: [],
      entity,
    });
    expect(result.rowsWithGaps).toBe(0);
    expect(result.totalRows).toBe(2);
    expect(result.chartIssueCount).toBe(0);
    expect(result.byCode).toEqual({});
    expect(result.severity).toEqual({ critical: 0, warn: 0, info: 0 });
    expect(result.chartIssues).toEqual([]);
  });

  it("counts a row exactly once even if it has multiple issues", () => {
    const result = summarize({
      rows: [
        makeRow({
          id: "a",
          inline: [mkIssue("wi-only-end-null", "warn")],
          subRow: [mkIssue("wi-overdue", "warn")],
        }),
      ],
      chartIssues: [],
      entity,
    });
    expect(result.rowsWithGaps).toBe(1);
    expect(result.totalRows).toBe(1);
    expect(result.severity).toEqual({ critical: 0, warn: 2, info: 0 });
  });

  it("aggregates row entities under each issue code", () => {
    const issue = mkIssue("wi-only-end-null", "warn");
    const result = summarize({
      rows: [
        makeRow({ id: "a", title: "First", inline: [issue] }),
        makeRow({ id: "b", title: "Second", inline: [issue] }),
        makeRow({ id: "c", title: "Third" }),
      ],
      chartIssues: [],
      entity,
    });
    expect(result.byCode["wi-only-end-null"]).toEqual([
      { id: "a", title: "First" },
      { id: "b", title: "Second" },
    ]);
  });

  it("attaches chart-level issues to byCode using the entity name as the ref", () => {
    const result = summarize({
      rows: [],
      chartIssues: [
        mkIssue("l1-null-engagement-type", "warn"),
        mkIssue("l1-null-engagement-type", "warn"),
      ],
      entity,
    });
    expect(result.chartIssueCount).toBe(2);
    expect(result.byCode["l1-null-engagement-type"]).toEqual([
      { id: "p-l1", title: "Sample L1" },
      { id: "p-l1", title: "Sample L1" },
    ]);
  });

  it("rolls severity counts across rows + chart issues", () => {
    const result = summarize({
      rows: [
        makeRow({
          id: "row",
          inline: [mkIssue("wi-end-before-start", "critical")],
          subRow: [mkIssue("wi-bare-resource-name", "info")],
        }),
      ],
      chartIssues: [
        mkIssue("wrapper-bad-engagement-type", "critical"),
        mkIssue("l1-null-dates", "warn"),
      ],
      entity,
    });
    expect(result.severity).toEqual({ critical: 2, warn: 1, info: 1 });
  });

  it("populates childRollup with per-row severity tallies", () => {
    const result = summarize({
      rows: [
        makeRow({
          id: "a",
          title: "Alpha",
          inline: [mkIssue("wi-end-before-start", "critical")],
        }),
        makeRow({ id: "b", title: "Beta" }),
      ],
      chartIssues: [],
      entity,
    });
    expect(result.childRollup).toEqual([
      { id: "a", title: "Alpha", critical: 1, warn: 0, info: 0 },
      { id: "b", title: "Beta", critical: 0, warn: 0, info: 0 },
    ]);
  });

  it("populates codeSeverity from both row + chart sources", () => {
    const result = summarize({
      rows: [makeRow({ inline: [mkIssue("wi-end-before-start", "critical")] })],
      chartIssues: [mkIssue("wrapper-no-children", "critical")],
      entity,
    });
    expect(result.codeSeverity["wi-end-before-start"]).toBe("critical");
    expect(result.codeSeverity["wrapper-no-children"]).toBe("critical");
  });
});

// ── formatHeadline ───────────────────────────────────────

function makeSummary(overrides: Partial<Summary> = {}): Summary {
  return {
    rowsWithGaps: 0,
    totalRows: 0,
    chartIssueCount: 0,
    byCode: {},
    codeSeverity: {},
    severity: { critical: 0, warn: 0, info: 0 },
    chartIssues: [],
    childRollup: [],
    ...overrides,
  };
}

describe("formatHeadline", () => {
  it("uses the explicit zero form when nothing is wrong", () => {
    expect(formatHeadline(makeSummary({ totalRows: 5 }))).toBe(
      "0 of 5 rows have data gaps",
    );
  });

  it("omits the chart clause when chartIssueCount is 0", () => {
    expect(
      formatHeadline(makeSummary({ rowsWithGaps: 3, totalRows: 7 })),
    ).toBe("3 of 7 rows have data gaps");
  });

  it("renders both clauses joined with ' + '", () => {
    expect(
      formatHeadline(
        makeSummary({ rowsWithGaps: 3, totalRows: 7, chartIssueCount: 2 }),
      ),
    ).toBe("3 of 7 rows have data gaps + 2 chart-level issues");
  });

  it("uses singular 'issue' when chartIssueCount is exactly 1", () => {
    expect(
      formatHeadline(
        makeSummary({ rowsWithGaps: 0, totalRows: 7, chartIssueCount: 1 }),
      ),
    ).toBe("0 of 7 rows have data gaps + 1 chart-level issue");
  });

  it("renders both clauses even when row count is zero (chart-only failure)", () => {
    expect(
      formatHeadline(
        makeSummary({ rowsWithGaps: 0, totalRows: 1, chartIssueCount: 4 }),
      ),
    ).toBe("0 of 1 rows have data gaps + 4 chart-level issues");
  });
});

// ── formatSeverityLine ───────────────────────────────────

describe("formatSeverityLine", () => {
  it("renders 'clean' when all counts are zero", () => {
    expect(formatSeverityLine({ critical: 0, warn: 0, info: 0 })).toBe("clean");
  });

  it("omits zero buckets", () => {
    expect(formatSeverityLine({ critical: 2, warn: 0, info: 0 })).toBe("2 critical");
    expect(formatSeverityLine({ critical: 0, warn: 5, info: 0 })).toBe("5 warn");
    expect(formatSeverityLine({ critical: 0, warn: 0, info: 3 })).toBe("3 info");
  });

  it("joins multiple non-zero buckets with ' · '", () => {
    expect(formatSeverityLine({ critical: 1, warn: 2, info: 3 })).toBe(
      "1 critical · 2 warn · 3 info",
    );
  });
});

// ── formatCounterMarkup ──────────────────────────────────

describe("formatCounterMarkup", () => {
  it("renders the headline and severity line for clean data", () => {
    const html = renderToStaticMarkup(
      formatCounterMarkup(makeSummary({ totalRows: 3 })) as JSX.Element,
    );
    expect(html).toContain("0 of 3 rows have data gaps");
    expect(html).toContain("clean");
    expect(html).not.toContain("counter-breakdown");
  });

  it("sorts itemized codes alphabetically for deterministic output", () => {
    const summary = makeSummary({
      rowsWithGaps: 3,
      totalRows: 3,
      byCode: {
        "wi-overdue": [{ id: "1", title: "Z" }],
        "child-orphan": [{ id: "2", title: "A" }],
        "row-only-end-null": [{ id: "3", title: "M" }],
      },
    });
    const html = renderToStaticMarkup(formatCounterMarkup(summary) as JSX.Element);
    const childIdx = html.indexOf("child-orphan");
    const rowIdx = html.indexOf("row-only-end-null");
    const wiIdx = html.indexOf("wi-overdue");
    expect(childIdx).toBeGreaterThan(0);
    expect(rowIdx).toBeGreaterThan(childIdx);
    expect(wiIdx).toBeGreaterThan(rowIdx);
  });

  it("renders affected entities by title separated by commas", () => {
    const summary = makeSummary({
      rowsWithGaps: 2,
      totalRows: 2,
      byCode: {
        "wi-only-end-null": [
          { id: "a", title: "Alpha" },
          { id: "b", title: "Beta" },
        ],
      },
    });
    const html = renderToStaticMarkup(formatCounterMarkup(summary) as JSX.Element);
    expect(html).toContain("Alpha, Beta");
    expect(html).toContain("(2)");
  });
});

// ── formatCounterConsole ─────────────────────────────────

describe("formatCounterConsole", () => {
  const outputPath = "/Users/x/runway-gantts/foo.html";

  it("starts with the headline + severity line and ends with the absolute output path", () => {
    const out = formatCounterConsole(makeSummary({ totalRows: 5 }), outputPath);
    const lines = out.split("\n");
    expect(lines[0]).toBe("0 of 5 rows have data gaps");
    expect(lines[1]).toBe("  clean");
    expect(lines[lines.length - 1]).toBe(`Wrote: ${outputPath}`);
  });

  it("emits one indented line per issue code, alphabetically", () => {
    const summary = makeSummary({
      rowsWithGaps: 1,
      totalRows: 1,
      chartIssueCount: 1,
      byCode: {
        "wi-overdue": [{ id: "1", title: "Item" }],
        "l1-null-engagement-type": [{ id: "p", title: "Subject" }],
      },
      severity: { critical: 0, warn: 2, info: 0 },
    });
    const out = formatCounterConsole(summary, outputPath);
    const lines = out.split("\n");
    expect(lines[0]).toBe("1 of 1 rows have data gaps + 1 chart-level issue");
    expect(lines[1]).toBe("  2 warn");
    expect(lines[2]).toBe("  [l1-null-engagement-type] (1): Subject");
    expect(lines[3]).toBe("  [wi-overdue] (1): Item");
    expect(lines[4]).toBe(`Wrote: ${outputPath}`);
  });

  it("omits per-code lines when byCode is empty (clean run)", () => {
    const out = formatCounterConsole(makeSummary({ totalRows: 4 }), outputPath);
    expect(out.split("\n")).toEqual([
      "0 of 4 rows have data gaps",
      "  clean",
      `Wrote: ${outputPath}`,
    ]);
  });

  it("includes all affected titles comma-separated when a code has many refs", () => {
    const summary = makeSummary({
      rowsWithGaps: 3,
      totalRows: 3,
      byCode: {
        "wi-only-end-null": [
          { id: "a", title: "First" },
          { id: "b", title: "Second" },
          { id: "c", title: "Third" },
        ],
      },
      severity: { critical: 0, warn: 3, info: 0 },
    });
    const out = formatCounterConsole(summary, outputPath);
    expect(out).toContain("[wi-only-end-null] (3): First, Second, Third");
  });
});
