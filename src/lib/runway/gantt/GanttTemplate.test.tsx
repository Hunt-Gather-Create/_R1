import { describe, expect, it } from "vitest";
import {
  computeBarGeometry,
  computeTodayPosition,
  renderGantt,
  renderClientRundown,
} from "./GanttTemplate";
import type {
  AnnotatedRow,
  AxisParams,
  ClientRow,
  ClientRundownData,
  GanttData,
  Issue,
  IssueCode,
  ProjectRow,
  RawData,
  RundownSection,
  Severity,
  Summary,
} from "./types";

const NOW = new Date("2026-04-28T00:00:00Z");

function makeClient(): ClientRow {
  return {
    id: "c1",
    name: "Test Client",
    slug: "test-client",
    nicknames: null,
    contractValue: null,
    contractTerm: null,
    contractStatus: null,
    team: null,
    clientContacts: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeProject(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: "p1",
    clientId: "c1",
    name: "Test Project",
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

function mkIssue(code: IssueCode, severity: Severity = "warn", message = "msg"): Issue {
  return { code, message, severity };
}

function emptySummary(overrides: Partial<Summary> = {}): Summary {
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

const weeklyAxis: AxisParams = {
  kind: "weekly",
  start: "2026-04-13",
  end: "2026-05-25",
  today: "2026-04-28",
  columns: [
    { date: "2026-04-13", label: "4/13" },
    { date: "2026-04-20", label: "4/20" },
    { date: "2026-04-27", label: "4/27" },
    { date: "2026-05-04", label: "5/4" },
    { date: "2026-05-11", label: "5/11" },
    { date: "2026-05-18", label: "5/18" },
  ],
};

// ── Geometry ─────────────────────────────────────────────

describe("computeBarGeometry", () => {
  it("returns bar geometry with positive left + width for a normal range", () => {
    const row = makeRow({ startDate: "2026-04-20", endDate: "2026-04-26" });
    const geom = computeBarGeometry(row, weeklyAxis);
    expect(geom.kind).toBe("bar");
    if (geom.kind === "bar") {
      expect(geom.left).toBeGreaterThan(0);
      expect(geom.left).toBeLessThan(50);
      expect(geom.width).toBeGreaterThan(0);
    }
  });

  it("returns milestone geometry when start === end", () => {
    const row = makeRow({ startDate: "2026-05-04", endDate: "2026-05-04" });
    const geom = computeBarGeometry(row, weeklyAxis);
    expect(geom.kind).toBe("milestone");
  });

  it("returns none when both dates are null", () => {
    const row = makeRow({ startDate: null, endDate: null });
    expect(computeBarGeometry(row, weeklyAxis).kind).toBe("none");
  });

  it("returns none when only one date is set", () => {
    const row = makeRow({ startDate: "2026-04-20", endDate: null });
    expect(computeBarGeometry(row, weeklyAxis).kind).toBe("none");
  });

  it("returns none when end < start (bad pair)", () => {
    const row = makeRow({ startDate: "2026-05-10", endDate: "2026-04-20" });
    expect(computeBarGeometry(row, weeklyAxis).kind).toBe("none");
  });

  it("returns none when axis has no-axis kind", () => {
    const row = makeRow({ startDate: "2026-04-20", endDate: "2026-04-26" });
    const geom = computeBarGeometry(row, { kind: "no-axis", today: "2026-04-28" });
    expect(geom.kind).toBe("none");
  });
});

describe("computeTodayPosition", () => {
  it("returns a percent within 0-100 for an in-range today", () => {
    const pct = computeTodayPosition(weeklyAxis);
    expect(pct).not.toBeNull();
    expect(pct!).toBeGreaterThan(0);
    expect(pct!).toBeLessThan(100);
  });

  it("returns null when today is before axis start", () => {
    const before: AxisParams = { ...weeklyAxis, today: "2026-01-01" };
    expect(computeTodayPosition(before)).toBeNull();
  });

  it("returns null for no-axis", () => {
    expect(
      computeTodayPosition({ kind: "no-axis", today: "2026-04-28" }),
    ).toBeNull();
  });
});

// ── renderGantt: structural assertions on output HTML ─────

function makeGanttData(overrides: Partial<GanttData> = {}): GanttData {
  const entity = makeProject({
    id: "p-l1",
    name: "Sample L1",
    startDate: "2026-04-15",
    endDate: "2026-05-15",
  });
  const client = makeClient();
  const raw: RawData = { kind: "l1", entity, client, children: [] };
  return {
    raw,
    rows: [],
    chartIssues: [],
    axis: weeklyAxis,
    headerRange: "4/15 – 5/15",
    generatedAt: "2026-04-28",
    summary: emptySummary(),
    ...overrides,
  };
}

describe("renderGantt", () => {
  it("includes the doctype and html structure", () => {
    const html = renderGantt(makeGanttData());
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
  });

  it("includes the project name and header range", () => {
    const html = renderGantt(makeGanttData());
    expect(html).toContain("Test Client");
    expect(html).toContain("Sample L1");
    expect(html).toContain("4/15 – 5/15");
    expect(html).toContain("Generated 2026-04-28");
  });

  it("renders the visual legend with status swatches + milestone + alert", () => {
    // Legend rewritten 2026-04-30 to use rendered swatches instead of
    // text-only key. Each status gets a color swatch; milestone + alert
    // glyphs appear inline.
    const html = renderGantt(makeGanttData());
    expect(html).toContain("legend-swatch active");
    expect(html).toContain("legend-swatch scheduled");
    expect(html).toContain("legend-swatch at-risk");
    expect(html).toContain("legend-swatch blocked");
    expect(html).toContain("legend-swatch completed");
    expect(html).toContain("legend-swatch canceled");
    expect(html).toContain("legend-diamond");
    expect(html).toContain("legend-alert");
    // Labels still render
    expect(html).toContain("in-progress");
    expect(html).toContain("milestone");
  });

  it("renders the Data Integrity panel + ✅ clean state for an empty summary", () => {
    // Compact panel rewrite (operator 2026-04-30): clean state collapses
    // to a single emoji-led line; severity buckets aren't grouped into
    // nested colored boxes.
    const html = renderGantt(makeGanttData({ summary: emptySummary({ totalRows: 2 }) }));
    expect(html).toContain("Data Integrity");
    expect(html).toContain("0 of 2 rows have data gaps");
    expect(html).toContain('class="panel-clean"');
    expect(html).toContain("✅");
    expect(html).not.toContain('class="panel-issues"');
  });

  it("renders flat issue list with emoji severity prefixes when issues exist", () => {
    const chartIssue = mkIssue("l1-null-engagement-type", "warn", "engagementType is null.");
    const data = makeGanttData({
      rows: [
        makeRow({
          id: "w1",
          title: "A",
          inline: [mkIssue("wi-only-end-null", "warn", "end null")],
        }),
        makeRow({ id: "w2", title: "B" }),
      ],
      chartIssues: [chartIssue],
      summary: {
        rowsWithGaps: 1,
        totalRows: 2,
        chartIssueCount: 1,
        byCode: {
          "wi-only-end-null": [{ id: "w1", title: "A" }],
          "l1-null-engagement-type": [{ id: "p-l1", title: "Sample L1" }],
        },
        codeSeverity: {
          "wi-only-end-null": "warn",
          "l1-null-engagement-type": "warn",
        },
        severity: { critical: 0, warn: 2, info: 0 },
        chartIssues: [chartIssue],
        childRollup: [],
      },
    });
    const html = renderGantt(data);
    expect(html).toContain("1 of 2 rows have data gaps + 1 chart-level issue");
    expect(html).toContain('class="panel-issues"');
    expect(html).toContain("🟡 2 warn");
    expect(html).toContain("engagementType is null.");
    expect(html).toContain("wi-only-end-null");
  });

  it("flat list sorts critical before warn before info", () => {
    const critical = mkIssue(
      "wrapper-bad-engagement-type",
      "critical",
      "Wrapper engagementType is 'project', expected 'retainer'.",
    );
    const data = makeGanttData({
      chartIssues: [critical],
      summary: {
        ...emptySummary(),
        chartIssueCount: 1,
        byCode: {
          "wrapper-bad-engagement-type": [{ id: "p-l1", title: "Sample L1" }],
          "wi-bare-resource-name": [{ id: "w1", title: "A" }],
        },
        codeSeverity: {
          "wrapper-bad-engagement-type": "critical",
          "wi-bare-resource-name": "info",
        },
        severity: { critical: 1, warn: 0, info: 1 },
        chartIssues: [critical],
      },
    });
    const html = renderGantt(data);
    // 🔴 critical entry must appear before 🔵 info entry in the rendered HTML.
    const criticalIdx = html.indexOf("wrapper-bad-engagement-type");
    const infoIdx = html.indexOf("wi-bare-resource-name");
    expect(criticalIdx).toBeGreaterThan(0);
    expect(infoIdx).toBeGreaterThan(criticalIdx);
    expect(html).toContain("🔴 1 critical");
    expect(html).toContain("🔵 1 info");
  });

  it("renders the per-child rollup table only on wrapper view", () => {
    const wrapper = makeProject({
      id: "p-wrap",
      name: "Wrap",
      engagementType: "retainer",
    });
    const child = makeProject({ id: "p-c", parentProjectId: "p-wrap" });
    const wrapperRaw: RawData = {
      kind: "wrapper",
      entity: wrapper,
      client: makeClient(),
      children: [child],
      orphanWeekItems: [],
    };
    const data: GanttData = {
      raw: wrapperRaw,
      rows: [],
      chartIssues: [],
      axis: weeklyAxis,
      headerRange: "4/15 – 5/15",
      generatedAt: "2026-04-28",
      summary: emptySummary({
        childRollup: [
          { id: "p-c", title: "Alpha", critical: 1, warn: 0, info: 0 },
          { id: "p-d", title: "Beta", critical: 0, warn: 0, info: 0 },
        ],
        severity: { critical: 1, warn: 0, info: 0 },
      }),
    };
    const html = renderGantt(data);
    // Match the rollup heading element rather than the bare string (the
    // inline <style> block contains the same text in a CSS comment).
    expect(html).toMatch(/<h3>Per-child rollup<\/h3>/);
    expect(html).toContain("Alpha");
    expect(html).toContain("1 critical");
    expect(html).toContain(">clean<"); // Beta is clean
  });

  it("does NOT render the per-child rollup on L1 view", () => {
    const html = renderGantt(makeGanttData());
    expect(html).not.toMatch(/<h3>Per-child rollup<\/h3>/);
  });

  it("renders rows with explicit start–end and red null span when end is missing", () => {
    const data = makeGanttData({
      rows: [makeRow({ id: "w1", title: "Concept", startDate: "2026-04-30", endDate: null })],
    });
    const html = renderGantt(data);
    expect(html).toContain("Concept");
    expect(html).toContain("4/30");
    expect(html).toContain('<span class="null">null</span>');
  });

  it("shows both dates verbatim even when start === end (no milestone collapse on rows)", () => {
    const data = makeGanttData({
      rows: [
        makeRow({
          id: "w1",
          title: "Same Day",
          startDate: "2026-05-04",
          endDate: "2026-05-04",
        }),
      ],
    });
    const html = renderGantt(data);
    const dateCount = (html.match(/>5\/4</g) ?? []).length;
    expect(dateCount).toBeGreaterThanOrEqual(2);
  });

  it("renders both dates as red null when both are null", () => {
    const data = makeGanttData({
      rows: [makeRow({ id: "w1", title: "Empty", startDate: null, endDate: null })],
    });
    const html = renderGantt(data);
    const nullCount = (html.match(/<span class="null">null<\/span>/g) ?? []).length;
    expect(nullCount).toBe(2);
  });

  it("renders a milestone diamond when start === end (with status class)", () => {
    const data = makeGanttData({
      rows: [
        makeRow({
          id: "w1",
          title: "Milestone",
          startDate: "2026-05-04",
          endDate: "2026-05-04",
          status: "scheduled",
        }),
      ],
    });
    const html = renderGantt(data);
    // Bar/milestone classes now carry a status modifier (active/scheduled/
    // at-risk/blocked) to drive color. Match the prefix.
    expect(html).toMatch(/class="milestone scheduled"/);
  });

  it("paints the bar pale (scheduled) when status is null or scheduled", () => {
    const data = makeGanttData({
      rows: [
        makeRow({
          id: "w1",
          title: "Pencils",
          startDate: "2026-04-20",
          endDate: "2026-04-26",
          status: "scheduled",
        }),
      ],
    });
    const html = renderGantt(data);
    expect(html).toMatch(/class="bar scheduled"/);
  });

  it("paints the bar full blue (active) when status is in-progress", () => {
    const data = makeGanttData({
      rows: [
        makeRow({
          id: "w1",
          title: "Active",
          startDate: "2026-04-20",
          endDate: "2026-04-26",
          status: "in-progress",
        }),
      ],
    });
    const html = renderGantt(data);
    expect(html).toMatch(/class="bar active"/);
  });

  it("paints the bar red (blocked) when status is blocked", () => {
    const data = makeGanttData({
      rows: [
        makeRow({
          id: "w1",
          title: "Blocked",
          startDate: "2026-04-20",
          endDate: "2026-04-26",
          status: "blocked",
        }),
      ],
    });
    const html = renderGantt(data);
    expect(html).toMatch(/class="bar blocked"/);
  });

  it("does not render a bar element when both dates null", () => {
    const data = makeGanttData({
      rows: [makeRow({ id: "w1", title: "NoDates", startDate: null, endDate: null })],
    });
    const html = renderGantt(data);
    expect(html).not.toContain('class="bar"');
    expect(html).toMatch(
      /<span class="null">null<\/span><span> – <\/span><span class="null">null<\/span>/,
    );
  });

  it("renders a sub-row only when subRow issues are present", () => {
    const without = renderGantt(
      makeGanttData({ rows: [makeRow({ id: "a", title: "A" })] }),
    );
    expect(without).not.toMatch(/class="sub-row /);

    const withSub = renderGantt(
      makeGanttData({
        rows: [
          makeRow({
            id: "b",
            title: "B",
            subRow: [mkIssue("wi-overdue", "warn", "overdue")],
          }),
        ],
      }),
    );
    expect(withSub).toMatch(/class="sub-row warn"/);
    expect(withSub).toContain("wi-overdue");
  });

  it("paints the sub-row red when its highest severity is critical", () => {
    const withCritical = renderGantt(
      makeGanttData({
        rows: [
          makeRow({
            id: "b",
            title: "B",
            subRow: [mkIssue("wi-end-before-start", "critical", "bad")],
          }),
        ],
      }),
    );
    expect(withCritical).toMatch(/class="sub-row critical"/);
  });

  it("renders the today line when axis has dates", () => {
    const html = renderGantt(makeGanttData());
    expect(html).toContain("today-line");
  });

  it("renders the no-axis note when axis kind is no-axis", () => {
    const data = makeGanttData({
      axis: { kind: "no-axis", today: "2026-04-28" },
    });
    const html = renderGantt(data);
    expect(html).toContain("No dates available");
    expect(html).not.toContain('class="today-line"');
  });

  it("applies the completed class to rows with status=completed", () => {
    const data = makeGanttData({
      rows: [
        makeRow({
          id: "c",
          title: "Done",
          status: "completed",
          startDate: "2026-04-20",
          endDate: "2026-04-26",
        }),
      ],
    });
    const html = renderGantt(data);
    expect(html).toContain("row completed");
  });

  it("applies the canceled class to rows with status=canceled", () => {
    const data = makeGanttData({
      rows: [
        makeRow({
          id: "x",
          title: "Cancel",
          status: "canceled",
          startDate: "2026-04-20",
          endDate: "2026-04-26",
        }),
      ],
    });
    const html = renderGantt(data);
    expect(html).toContain("row canceled");
  });

  it("emits an alert badge ⚠ on rows that have sub-row issues, severity-colored", () => {
    const data = makeGanttData({
      rows: [
        makeRow({
          id: "alert",
          title: "Has alert",
          subRow: [mkIssue("wi-end-before-start", "critical", "bad")],
        }),
      ],
    });
    const html = renderGantt(data);
    expect(html).toContain("alert-badge critical");
    expect(html).toContain("⚠");
  });
});

// ── Phase B tests ─────────────────────────────────────────

// ── Rundown fixture helpers ───────────────────────────────

function makeRundownSection(
  overrides: Partial<RundownSection> & { id?: string } = {},
): RundownSection {
  const { id = "s1", ...rest } = overrides;
  return {
    anchor: `anchor-${id}`,
    kind: "standalone",
    title: `Section ${id}`,
    data: makeGanttData(),
    ...rest,
  };
}

function makeClientRundownData(
  sections: RundownSection[] = [],
  overrides: Partial<ClientRundownData> = {},
): ClientRundownData {
  return {
    client: makeClient(),
    sections: sections.length > 0 ? sections : [makeRundownSection()],
    generatedAt: "2026-04-30",
    overallSeverity: { critical: 0, warn: 0, info: 0 },
    ...overrides,
  };
}

// ── G1: Baseline preservation (light-internal) ───────────

describe("G1: light-internal baseline preservation", () => {
  it("light-internal renders SectionLegend inside every SectionBlock and NOT in the rundown hero", () => {
    const section1 = makeRundownSection({ id: "a" });
    const section2 = makeRundownSection({ id: "b" });
    const rundown = makeClientRundownData([section1, section2]);
    const html = renderClientRundown(rundown);

    // Count rendered HTML elements with the legend-in-section class (not CSS rule text).
    // The CSS rule contains ".legend-in-section" but only element renders have class="...legend-in-section...".
    const legendCount = (html.match(/class="legend legend-in-section"/g) ?? []).length;
    expect(legendCount).toBeGreaterThanOrEqual(2);

    // Confirm the in-section class is present
    expect(html).toContain("legend-in-section");
  });

  it("single-project triage renders exactly one SectionLegend", () => {
    const html = renderGantt(makeGanttData());
    // Count rendered elements with the class, not occurrences in CSS text.
    const legendCount = (html.match(/class="legend legend-in-section"/g) ?? []).length;
    expect(legendCount).toBe(1);
  });

  it("light-internal still renders the DataIntegrityPanel", () => {
    const html = renderGantt(makeGanttData({ summary: emptySummary({ totalRows: 3 }) }));
    expect(html).toContain("Data Integrity");
    expect(html).toContain("panel-clean");
  });
});

// ── G2: Light-branded structural ─────────────────────────

describe("G2: light-branded structural", () => {
  it("light-branded renders logo data-URI in header", () => {
    const html = renderGantt(makeGanttData(), "light-branded");
    expect(html).toContain("data:image/jpeg;base64,");
  });

  it("light-branded omits DataIntegrityPanel", () => {
    const html = renderGantt(
      makeGanttData({ summary: emptySummary({ totalRows: 5 }) }),
      "light-branded",
    );
    expect(html).not.toContain("Data Integrity");
    expect(html).not.toContain("panel-clean");
    expect(html).not.toContain("panel-issues");
  });

  it("light-branded omits per-row alerts", () => {
    const html = renderGantt(
      makeGanttData({
        rows: [
          makeRow({
            id: "r1",
            title: "Row with issue",
            subRow: [mkIssue("wi-overdue", "warn", "overdue")],
          }),
        ],
      }),
      "light-branded",
    );
    expect(html).not.toContain("alert-badge");
    expect(html).not.toContain("sub-row warn");
  });

  it("light-branded uses STYLES_BRANDED block (brand primary color)", () => {
    const html = renderGantt(makeGanttData(), "light-branded");
    // Brand primary #0E5DFF should appear in the branded stylesheet
    expect(html).toContain("#0E5DFF");
  });
});

// ── G3: Dark-account-view structural ─────────────────────

describe("G3: dark-account-view structural", () => {
  it("dark-account-view renders without inline <style> block", () => {
    const html = renderGantt(makeGanttData(), "dark-account-view");
    expect(html).not.toContain("<style");
  });

  it("dark-account-view emits Tailwind classes on legend swatches", () => {
    const html = renderGantt(makeGanttData(), "dark-account-view");
    expect(html).toContain("bg-sky-400");
  });

  it("dark-account-view omits DataIntegrityPanel and per-row alerts", () => {
    const html = renderGantt(
      makeGanttData({
        rows: [
          makeRow({
            id: "r1",
            title: "Dark row",
            subRow: [mkIssue("wi-overdue", "warn", "overdue")],
          }),
        ],
        summary: emptySummary({ totalRows: 2 }),
      }),
      "dark-account-view",
    );
    expect(html).not.toContain("Data Integrity");
    expect(html).not.toContain("alert-badge");
    expect(html).not.toContain("sub-row");
  });
});

// ── G4: Section legend cross-theme ───────────────────────

describe("G4: SectionLegend cross-theme", () => {
  it("SectionLegend appears once per section in a wrapper rundown (N+1 rule)", () => {
    // Wrapper + 2 children = 3 sections = 3 legends
    const wrapper = makeRundownSection({ id: "wrap", kind: "wrapper" });
    const child1 = makeRundownSection({ id: "c1", kind: "wrapper-child" });
    const child2 = makeRundownSection({ id: "c2", kind: "wrapper-child" });
    const rundown = makeClientRundownData([wrapper, child1, child2]);
    const html = renderClientRundown(rundown);
    // Count rendered elements with the class, not occurrences in CSS text.
    const legendCount = (html.match(/class="legend legend-in-section"/g) ?? []).length;
    expect(legendCount).toBe(3);
  });

  it("SectionLegend appears once in a standalone L1 rundown section", () => {
    const section = makeRundownSection({ id: "l1", kind: "standalone" });
    const rundown = makeClientRundownData([section]);
    const html = renderClientRundown(rundown);
    // Count rendered elements with the class, not occurrences in CSS text.
    const legendCount = (html.match(/class="legend legend-in-section"/g) ?? []).length;
    expect(legendCount).toBe(1);
  });

  it("SectionLegend swatch sentinel differs by theme", () => {
    // light-internal: #3b82f6 (active swatch background in STYLES CSS)
    const lightInternal = renderGantt(makeGanttData(), "light-internal");
    expect(lightInternal).toContain("#3b82f6");

    // light-branded: #0E5DFF (active swatch background in STYLES_BRANDED CSS)
    const lightBranded = renderGantt(makeGanttData(), "light-branded");
    expect(lightBranded).toContain("#0E5DFF");
    expect(lightBranded).not.toContain("#3b82f6"); // internal color must not bleed in

    // dark: Tailwind classes
    const dark = renderGantt(makeGanttData(), "dark-account-view");
    expect(dark).toContain("bg-sky-400");
  });
});
