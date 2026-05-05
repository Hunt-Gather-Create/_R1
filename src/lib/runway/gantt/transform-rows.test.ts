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

  // ── 2026-05-05 axis rework ───────────────────────────────
  // Three adaptive density tiers + always-on month-band header:
  //   ≤ 14 days       → kind: "daily"   (one column per day, M/D every day)
  //   15-56 days      → kind: "weekly"  (one column per Monday, M/D)
  //   > 56 days (8wk) → kind: "monthly" (6-10 sparse ticks chosen to fit)
  // No more Mon-Fri 5-cell weeks. Numeric M/D labels are wider than the
  // single-letter abbreviations they replaced and crashed at long spans.

  it("daily mode (≤14-day span): one column per day, M/D label every day", () => {
    // 4/13 (Mon) to 4/22 (Wed) = 9 days span (10 columns when end is inclusive).
    const raw = l1Raw([
      makeWeekItem({ id: "w1", startDate: "2026-04-13", endDate: "2026-04-13" }),
      makeWeekItem({ id: "w2", startDate: "2026-04-22", endDate: "2026-04-22" }),
    ]);
    const rows = transformRows(raw);
    const axis = computeAxis(raw, rows, today);
    expect(axis.kind).toBe("daily");
    if (axis.kind === "daily") {
      // Every column in this small window has an M/D label.
      const numericRe = /^\d+\/\d+$/;
      expect(axis.columns.every((c) => numericRe.test(c.label))).toBe(true);
      // 10 inclusive days = 10 columns at minimum. The axis aligns to the
      // containing Monday (4/13) and ends after the last day, so we get
      // every day of that range with no gaps.
      expect(axis.columns.length).toBeGreaterThanOrEqual(10);
      expect(axis.columns[0].label).toBe("4/13");
      // Consecutive columns must be one day apart.
      for (let i = 1; i < axis.columns.length; i++) {
        const prev = new Date(`${axis.columns[i - 1].date}T00:00:00Z`);
        const cur = new Date(`${axis.columns[i].date}T00:00:00Z`);
        const diffDays = (cur.getTime() - prev.getTime()) / (24 * 60 * 60 * 1000);
        expect(diffDays).toBe(1);
      }
    }
  });

  it("weekly mode (15-56-day span): one column per Monday, no Tue-Fri", () => {
    // 4/15 to 5/22 = 37-day span → weekly tier.
    const raw = l1Raw([
      makeWeekItem({ id: "w1", startDate: "2026-04-15", endDate: "2026-04-15" }),
      makeWeekItem({ id: "w2", startDate: "2026-05-20", endDate: "2026-05-22" }),
    ]);
    const rows = transformRows(raw);
    const axis = computeAxis(raw, rows, today);
    expect(axis.kind).toBe("weekly");
    if (axis.kind === "weekly") {
      // Min=4/15 (Wed), Monday-of-week = 4/13. Max=5/22, end = next Monday = 5/25.
      expect(axis.start).toBe("2026-04-13");
      expect(axis.end).toBe("2026-05-25");
      // Mondays only: 4/13, 4/20, 4/27, 5/4, 5/11, 5/18 → 6 columns.
      expect(axis.columns).toHaveLength(6);
      expect(axis.columns.map((c) => c.label)).toEqual([
        "4/13",
        "4/20",
        "4/27",
        "5/4",
        "5/11",
        "5/18",
      ]);
      // Every column is a Monday.
      for (const col of axis.columns) {
        const d = new Date(`${col.date}T00:00:00Z`);
        expect(d.getUTCDay()).toBe(1);
      }
    }
  });

  it("monthly mode (>8-week span): sparse 6-10 ticks, no daily/weekly crashing", () => {
    // 4/15 to 9/15 = ~153 days (~22 weeks) — the long-span case that
    // crashed with daily Mon-Fri ticks at narrow widths.
    const raw = l1Raw([], {
      startDate: "2026-04-15",
      endDate: "2026-09-15",
    });
    const rows = transformRows(raw);
    const axis = computeAxis(raw, rows, today);
    expect(axis.kind).toBe("monthly");
    if (axis.kind === "monthly") {
      // Sparse ticks — between 6 and 10 total — chosen by the implementation
      // (every-other Monday or 1st-of-month) to minimize collision.
      expect(axis.columns.length).toBeGreaterThanOrEqual(6);
      expect(axis.columns.length).toBeLessThanOrEqual(10);
      // Every label is M/D — no weekday letters, no month abbreviations.
      const numericRe = /^\d+\/\d+$/;
      expect(axis.columns.every((c) => numericRe.test(c.label))).toBe(true);
    }
  });

  it("very long span gets sparse-month ticks, not 22 weekly columns", () => {
    // 4/15/2026 → 12/31/2026 = ~37 weeks. Weekly mode would emit 37
    // columns and crash visually; monthly tier should emit ≤10.
    const raw = l1Raw([], {
      startDate: "2026-04-15",
      endDate: "2026-12-31",
    });
    const rows = transformRows(raw);
    const axis = computeAxis(raw, rows, today);
    expect(axis.kind).toBe("monthly");
    if (axis.kind === "monthly") {
      expect(axis.columns.length).toBeLessThanOrEqual(10);
    }
  });

  it("emits month-band header data spanning multiple months", () => {
    // 4/15 to 6/2 — should produce 3 month bands (April, May, June).
    const raw = l1Raw([
      makeWeekItem({ id: "w1", startDate: "2026-04-15", endDate: "2026-04-15" }),
      makeWeekItem({ id: "w2", startDate: "2026-06-02", endDate: "2026-06-02" }),
    ]);
    const rows = transformRows(raw);
    const axis = computeAxis(raw, rows, today);
    expect(axis.kind).not.toBe("no-axis");
    if (axis.kind !== "no-axis") {
      const labels = axis.monthBands.map((b) => b.label);
      expect(labels).toEqual(["April", "May", "June"]);
      // No band label contains a year — operator-locked 2026-05-05.
      for (const b of axis.monthBands) {
        expect(b.label).not.toMatch(/\d{4}/);
        expect(b.label).not.toMatch(/'\d{2}/);
      }
      // Every band's [startCol, endCol] is in range and ordered.
      for (const b of axis.monthBands) {
        expect(b.startCol).toBeGreaterThanOrEqual(0);
        expect(b.endCol).toBeLessThan(axis.columns.length);
        expect(b.startCol).toBeLessThanOrEqual(b.endCol);
      }
      // Bands are contiguous, non-overlapping, and cover all columns.
      let cursor = 0;
      for (const b of axis.monthBands) {
        expect(b.startCol).toBe(cursor);
        cursor = b.endCol + 1;
      }
      expect(cursor).toBe(axis.columns.length);
    }
  });

  it("emits a single month band when span fits within one month", () => {
    // 4/15 to 4/22 — entirely in April.
    const raw = l1Raw([
      makeWeekItem({ id: "w1", startDate: "2026-04-15", endDate: "2026-04-15" }),
      makeWeekItem({ id: "w2", startDate: "2026-04-22", endDate: "2026-04-22" }),
    ]);
    const rows = transformRows(raw);
    const axis = computeAxis(raw, rows, today);
    expect(axis.kind).not.toBe("no-axis");
    if (axis.kind !== "no-axis") {
      expect(axis.monthBands).toHaveLength(1);
      expect(axis.monthBands[0].label).toBe("April");
      expect(axis.monthBands[0].startCol).toBe(0);
      expect(axis.monthBands[0].endCol).toBe(axis.columns.length - 1);
    }
  });

  it("regression-lock: no tick label contains weekday letters (T/W/Th/F/M-alone)", () => {
    // Run all three tiers and confirm none of them ever emit alphabetic
    // weekday letters. Regression-locks the all-numeric M/D contract.
    const fixtures: RawData[] = [
      // daily
      l1Raw([
        makeWeekItem({ id: "a1", startDate: "2026-04-13", endDate: "2026-04-20" }),
      ]),
      // weekly
      l1Raw([
        makeWeekItem({ id: "b1", startDate: "2026-04-15", endDate: "2026-05-22" }),
      ]),
      // monthly
      l1Raw([], { startDate: "2026-04-15", endDate: "2026-09-15" }),
    ];
    const numericRe = /^\d+\/\d+$/;
    for (const raw of fixtures) {
      const rows = transformRows(raw);
      const axis = computeAxis(raw, rows, today);
      if (axis.kind === "no-axis") continue;
      for (const c of axis.columns) {
        // Not "T", "W", "Th", "F", or "M" alone — strict numeric.
        expect(c.label).toMatch(numericRe);
      }
    }
  });

  it("considers entity dates even when no row has dates", () => {
    const raw = l1Raw(
      [makeWeekItem({ startDate: null, endDate: null })],
      { startDate: "2026-04-15", endDate: "2026-04-25" },
    );
    const rows = transformRows(raw);
    const axis = computeAxis(raw, rows, today);
    // 4/15 to 4/25 = 10-day span → daily tier.
    expect(axis.kind).toBe("daily");
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
