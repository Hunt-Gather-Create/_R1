import { describe, expect, it } from "vitest";
import {
  computeAxis,
  formatDateRange,
  transformRows,
} from "./transform-rows";
import type {
  ClientRow,
  ProjectRow,
  RawData,
  WeekItemRow,
} from "./types";

const NOW = new Date("2026-04-28T00:00:00Z");

function makeClient(overrides: Partial<ClientRow> = {}): ClientRow {
  return {
    id: "c1",
    name: "Client",
    slug: "client",
    nicknames: null,
    contractValue: null,
    contractTerm: null,
    contractStatus: null,
    team: null,
    clientContacts: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeProject(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: "p1",
    clientId: "c1",
    name: "Project",
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

function makeWeekItem(overrides: Partial<WeekItemRow> = {}): WeekItemRow {
  return {
    id: "w1",
    projectId: "p1",
    clientId: "c1",
    dayOfWeek: null,
    weekOf: null,
    date: null,
    startDate: null,
    endDate: null,
    blockedBy: null,
    title: "WeekItem",
    status: null,
    category: null,
    owner: null,
    resources: null,
    notes: null,
    sortOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const client = makeClient();

describe("transformRows", () => {
  it("maps wrapper-view children to project rows", () => {
    const wrapper = makeProject({ id: "p-wrap", engagementType: "retainer" });
    const childA = makeProject({
      id: "p-a",
      name: "Child A",
      parentProjectId: "p-wrap",
      startDate: "2026-04-20",
      endDate: "2026-04-25",
      owner: "Lane",
    });
    const childB = makeProject({
      id: "p-b",
      name: "Child B",
      parentProjectId: "p-wrap",
      startDate: "2026-04-15",
      endDate: "2026-04-22",
    });
    const raw: RawData = {
      kind: "wrapper",
      entity: wrapper,
      client,
      children: [childA, childB],
      orphanWeekItems: [],
    };
    const rows = transformRows(raw);
    expect(rows.map((r) => r.id)).toEqual(["p-b", "p-a"]); // sorted by startDate asc
    expect(rows[0].kind).toBe("project");
    if (rows[0].kind === "project") {
      expect(rows[0].title).toBe("Child B");
      expect(rows[1].owner).toBe("Lane");
    }
  });

  it("maps L1-view children to weekitem rows", () => {
    const project = makeProject({ id: "p-l1" });
    const w = makeWeekItem({ id: "w-1", title: "Concept", weekOf: "2026-04-20" });
    const raw: RawData = { kind: "l1", entity: project, client, children: [w] };
    const rows = transformRows(raw);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("weekitem");
    if (rows[0].kind === "weekitem") {
      expect(rows[0].title).toBe("Concept");
      expect(rows[0].weekOf).toBe("2026-04-20");
    }
  });

  it("sorts startDate ascending with nulls last", () => {
    const project = makeProject({ id: "p-l1" });
    const items = [
      makeWeekItem({ id: "w-late", title: "Late", startDate: "2026-05-10" }),
      makeWeekItem({ id: "w-null", title: "NoDate", startDate: null }),
      makeWeekItem({ id: "w-early", title: "Early", startDate: "2026-04-05" }),
      makeWeekItem({ id: "w-mid", title: "Mid", startDate: "2026-04-20" }),
    ];
    const raw: RawData = { kind: "l1", entity: project, client, children: items };
    const rows = transformRows(raw);
    expect(rows.map((r) => r.id)).toEqual(["w-early", "w-mid", "w-late", "w-null"]);
  });

  it("preserves weekOf without synthesizing dates from it", () => {
    const project = makeProject({ id: "p-l1" });
    const w = makeWeekItem({
      id: "w-onlyweek",
      title: "Only weekOf",
      weekOf: "2026-04-20",
      startDate: null,
      endDate: null,
    });
    const raw: RawData = { kind: "l1", entity: project, client, children: [w] };
    const rows = transformRows(raw);
    expect(rows[0].kind).toBe("weekitem");
    if (rows[0].kind === "weekitem") {
      expect(rows[0].startDate).toBeNull();
      expect(rows[0].endDate).toBeNull();
      expect(rows[0].weekOf).toBe("2026-04-20");
    }
  });
});

describe("computeAxis", () => {
  const project = makeProject({ id: "p-l1" });
  const today = new Date("2026-04-28T00:00:00Z");

  function l1Raw(items: WeekItemRow[], entityOverrides: Partial<ProjectRow> = {}): RawData {
    return {
      kind: "l1",
      entity: { ...project, ...entityOverrides },
      client,
      children: items,
    };
  }

  it("returns no-axis when all dates are null", () => {
    const raw = l1Raw([makeWeekItem({ startDate: null, endDate: null })]);
    const rows = transformRows(raw);
    const axis = computeAxis(raw, rows, today);
    expect(axis.kind).toBe("no-axis");
    expect(axis.today).toBe("2026-04-28");
  });

  it("uses weekly columns when span is under 16 weeks", () => {
    const raw = l1Raw([
      makeWeekItem({ id: "w1", startDate: "2026-04-15", endDate: "2026-04-15" }), // a Wednesday
      makeWeekItem({ id: "w2", startDate: "2026-05-20", endDate: "2026-05-22" }), // 5 weeks later
    ]);
    const rows = transformRows(raw);
    const axis = computeAxis(raw, rows, today);
    expect(axis.kind).toBe("weekly");
    if (axis.kind === "weekly") {
      // Min=4/15 (Wed), Monday-of-week = 4/13. Max=5/22, end = next Monday after 5/22 = 5/25.
      expect(axis.start).toBe("2026-04-13");
      expect(axis.end).toBe("2026-05-25");
      // Daily mode emits one column per weekday (Mon-Fri), skipping weekends.
      // 4/13 (Mon) to 5/25 (Mon, exclusive) = 6 weeks × 5 weekdays = 30 ticks.
      // (operator 2026-04-30): daily ticks pulled forward from fast-follow.
      expect(axis.columns).toHaveLength(30);
      expect(axis.columns[0].date).toBe("2026-04-13"); // Monday
      expect(axis.columns[0].label).toBe("4/13");      // Monday gets full M/D label
      expect(axis.columns[1].date).toBe("2026-04-14"); // Tuesday
      expect(axis.columns[1].label).toBe("4/14");      // Operator 2026-05-04: all weekdays carry M/D
      expect(axis.columns[axis.columns.length - 1].date).toBe("2026-05-22"); // last Friday
    }
  });

  // Operator-locked 2026-05-04: every daily-mode column must label M/D.
  // No alphabetic weekday abbreviations (T, W, Th, F) inline. The brain
  // reads numeric dates faster than alternating letter glyphs.
  it("daily-mode columns all carry numeric M/D labels (no weekday letters)", () => {
    const raw = l1Raw([
      makeWeekItem({ id: "w1", startDate: "2026-04-15", endDate: "2026-04-15" }),
      makeWeekItem({ id: "w2", startDate: "2026-05-20", endDate: "2026-05-22" }),
    ]);
    const rows = transformRows(raw);
    const axis = computeAxis(raw, rows, today);
    expect(axis.kind).toBe("weekly");
    if (axis.kind === "weekly") {
      // Every label must match \d+/\d+ — no T/W/Th/F letters.
      const numericRe = /^\d+\/\d+$/;
      const nonNumeric = axis.columns.filter((c) => !numericRe.test(c.label));
      expect(nonNumeric).toEqual([]);
      // Spot checks: weekday letters from the prior implementation must be gone.
      const labels = axis.columns.map((c) => c.label);
      expect(labels).not.toContain("T");
      expect(labels).not.toContain("W");
      expect(labels).not.toContain("Th");
      expect(labels).not.toContain("F");
    }
  });

  it("treats span of exactly 16 weeks as monthly (strict <)", () => {
    // 4/13 to 8/3 is exactly 16 weeks (112 days)
    const raw = l1Raw([], {
      startDate: "2026-04-13",
      endDate: "2026-08-03",
    });
    const rows = transformRows(raw);
    const axis = computeAxis(raw, rows, today);
    expect(axis.kind).toBe("monthly");
  });

  it("uses monthly columns when span is over 16 weeks", () => {
    const raw = l1Raw([], {
      startDate: "2026-04-15",
      endDate: "2026-09-15", // ~22 weeks
    });
    const rows = transformRows(raw);
    const axis = computeAxis(raw, rows, today);
    expect(axis.kind).toBe("monthly");
    if (axis.kind === "monthly") {
      expect(axis.start).toBe("2026-04-01");
      expect(axis.end).toBe("2026-10-01");
      expect(axis.columns.map((c) => c.label)).toEqual(["Apr", "May", "Jun", "Jul", "Aug", "Sep"]);
    }
  });

  it("considers entity dates even when no row has dates", () => {
    const raw = l1Raw(
      [makeWeekItem({ startDate: null, endDate: null })],
      { startDate: "2026-04-15", endDate: "2026-04-25" },
    );
    const rows = transformRows(raw);
    const axis = computeAxis(raw, rows, today);
    expect(axis.kind).toBe("weekly");
  });
});

describe("formatDateRange", () => {
  it("renders both nulls as literal 'null – null'", () => {
    expect(formatDateRange(null, null)).toBe("null – null");
  });

  it("renders only-start-null with literal null and numeric end", () => {
    expect(formatDateRange(null, "2026-05-11")).toBe("null – 5/11");
  });

  it("renders only-end-null with numeric start and literal null", () => {
    expect(formatDateRange("2026-04-17", null)).toBe("4/17 – null");
  });

  it("renders single-date row as just that date (milestone)", () => {
    expect(formatDateRange("2026-05-11", "2026-05-11")).toBe("5/11");
  });

  // Regression lock for the 2026-05-04 visual QA pass: a stale render of the
  // Convergix rundown showed `4/23 – 4/23`, `9/1 – 9/1`, `4/29 – 4/29` for
  // single-day rows. The fix shipped in Phase 1A Wave 3 — `start === end`
  // collapses to `M/D` — these tests pin that contract for representative
  // rows so a future regression that re-introduces `M/D – M/D` is caught.
  it.each([
    ["2026-04-23", "4/23"],
    ["2026-09-01", "9/1"],
    ["2026-04-29", "4/29"],
    ["2026-01-07", "1/7"],
  ])("collapses %s twice to '%s' with no en-dash", (iso, expected) => {
    const result = formatDateRange(iso, iso);
    expect(result).toBe(expected);
    expect(result).not.toContain("–"); // U+2013 must not appear
  });

  it("renders normal range with en-dash separator", () => {
    expect(formatDateRange("2026-04-17", "2026-05-11")).toBe("4/17 – 5/11");
  });

  it("strips zero-padding from month and day", () => {
    expect(formatDateRange("2026-04-07", "2026-05-09")).toBe("4/7 – 5/9");
  });
});
