import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GanttChartsSection } from "./gantt-charts-section";
import { RundownContentRSC } from "./rundown-content-rsc";
import type { Account } from "../types";
import type {
  ClientRow,
  GanttData,
  ProjectRow,
  RundownSection,
  SeverityCounts,
  WeekItemRow,
} from "@/lib/runway/gantt/types";

// GanttSectionDark renders a complex DOM and is exercised by its own unit
// suite + the live page. Stub it here so the chip-in-dark-embed tests
// stay focused on RundownContentRSC's chip placement, not the section
// chrome.
vi.mock("@/lib/runway/gantt/gantt-section-dark", () => ({
  GanttSectionDark: () => <div data-testid="gantt-section-dark-stub" />,
}));

// CSS module is auto-stubbed by vitest's css handler; nothing to mock here.

// Stub AuditBadge so we can assert presence/severity wiring without
// depending on its tone/className internals.
vi.mock("./audit-badge", () => ({
  AuditBadge: ({ severity }: { severity: SeverityCounts }) => (
    <span
      data-testid="audit-badge-stub"
      data-critical={severity.critical}
      data-warn={severity.warn}
    />
  ),
}));

const baseAccount = (overrides: Partial<Account> = {}): Account => ({
  name: "Convergix",
  slug: "convergix",
  contractValue: undefined,
  contractTerm: undefined,
  contractStatus: "signed",
  team: undefined,
  items: [],
  ...overrides,
});

describe("GanttChartsSection", () => {
  it("renders the empty-state copy when accounts is empty", () => {
    render(<GanttChartsSection accounts={[]} />);
    expect(screen.getByTestId("gantt-charts-empty")).toBeInTheDocument();
    expect(
      screen.getByText("All clear — no active rundowns.")
    ).toBeInTheDocument();
  });

  it("does NOT render the empty state when at least one account exists", () => {
    const accounts = [{ ...baseAccount() }];
    render(<GanttChartsSection accounts={accounts} />);
    expect(screen.queryByTestId("gantt-charts-empty")).not.toBeInTheDocument();
  });

  it("renders one article per surviving account", () => {
    const accounts = [
      { ...baseAccount({ name: "Convergix", slug: "convergix" }) },
      { ...baseAccount({ name: "Bonterra", slug: "bonterra" }) },
      { ...baseAccount({ name: "HDL", slug: "hdl" }) },
    ];
    render(<GanttChartsSection accounts={accounts} />);
    expect(screen.getAllByTestId("gantt-charts-card")).toHaveLength(3);
  });

  it("renders each account's name as a heading", () => {
    const accounts = [
      { ...baseAccount({ name: "Convergix", slug: "convergix" }) },
      { ...baseAccount({ name: "Bonterra", slug: "bonterra" }) },
    ];
    render(<GanttChartsSection accounts={accounts} />);
    expect(screen.getByText("Convergix")).toBeInTheDocument();
    expect(screen.getByText("Bonterra")).toBeInTheDocument();
  });

  it("slots ganttContent inside each card", () => {
    const accounts = [
      {
        ...baseAccount({ slug: "a", name: "A" }),
        ganttContent: (
          <div data-testid="gantt-content-a">Gantt for A</div>
        ),
      },
      {
        ...baseAccount({ slug: "b", name: "B" }),
        ganttContent: (
          <div data-testid="gantt-content-b">Gantt for B</div>
        ),
      },
    ];
    render(<GanttChartsSection accounts={accounts} />);

    const cardA = screen.getByText("A").closest("article")!;
    const cardB = screen.getByText("B").closest("article")!;

    // ganttContent must be inside its own card.
    expect(cardA).toContainElement(screen.getByTestId("gantt-content-a"));
    expect(cardB).toContainElement(screen.getByTestId("gantt-content-b"));

    // Cross-card leak check: A's ganttContent should NOT appear in B's card.
    expect(cardA).not.toContainElement(screen.getByTestId("gantt-content-b"));
    expect(cardB).not.toContainElement(screen.getByTestId("gantt-content-a"));
  });

  it("renders AuditBadge when ganttSeverity is provided", () => {
    const accounts = [
      {
        ...baseAccount({ slug: "convergix", name: "Convergix" }),
        ganttSeverity: { critical: 2, warn: 3, info: 0 } as SeverityCounts,
      },
    ];
    render(<GanttChartsSection accounts={accounts} />);
    const badge = screen.getByTestId("audit-badge-stub");
    expect(badge).toBeInTheDocument();
    expect(badge.getAttribute("data-critical")).toBe("2");
    expect(badge.getAttribute("data-warn")).toBe("3");
  });

  it("does NOT render AuditBadge when ganttSeverity is undefined", () => {
    const accounts = [
      { ...baseAccount({ slug: "convergix", name: "Convergix" }) },
    ];
    render(<GanttChartsSection accounts={accounts} />);
    expect(screen.queryByTestId("audit-badge-stub")).not.toBeInTheDocument();
  });

  it("uses account.slug as the React key (stable across renders)", () => {
    const accounts = [
      { ...baseAccount({ slug: "convergix", name: "Convergix" }) },
      { ...baseAccount({ slug: "bonterra", name: "Bonterra" }) },
    ];
    render(<GanttChartsSection accounts={accounts} />);
    const cards = screen.getAllByTestId("gantt-charts-card");
    expect(cards[0].getAttribute("data-account-slug")).toBe("convergix");
    expect(cards[1].getAttribute("data-account-slug")).toBe("bonterra");
  });
});

// ── Track 3 Wave 5 — RundownContentRSC dark "Ready to close?" chip ──
//
// The chip travels with the slotted ganttContent that page.tsx hands to
// each account card. Because RundownContentRSC is what actually renders
// the chip in the dark embed, exercise it directly with handcrafted
// fixtures here (the GanttChartsSection slot test above proves the slot
// wires through; these tests prove the slot CONTENT renders the chip in
// the right spots).
describe("RundownContentRSC ready-to-close chip (dark embed)", () => {
  const NOW = new Date("2026-05-04T00:00:00Z");

  function makeClient(): ClientRow {
    return {
      id: "c1",
      name: "Acme",
      slug: "acme",
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
      name: "P1",
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

  /** Minimal GanttData stub — the actual GanttSectionDark is mocked above. */
  function makeData(l1: ProjectRow, weekItems: WeekItemRow[]): GanttData {
    return {
      raw: { kind: "l1", entity: l1, client: makeClient(), children: weekItems },
      rows: [],
      chartIssues: [],
      axis: { kind: "no-axis", today: "2026-05-04" },
      headerRange: "null – null",
      generatedAt: "2026-05-04",
      summary: {
        rowsWithGaps: 0,
        totalRows: 0,
        chartIssueCount: 0,
        byCode: {},
        codeSeverity: {},
        severity: { critical: 0, warn: 0, info: 0 },
        chartIssues: [],
      },
    };
  }

  function makeStandaloneSection(l1: ProjectRow): RundownSection {
    return {
      anchor: `s-${l1.id}`,
      kind: "standalone",
      title: l1.name,
      data: makeData(l1, []),
    };
  }

  function makeWrapperChildSection(l1: ProjectRow, parentTitle = "Wrapper"): RundownSection {
    return {
      anchor: `wc-${l1.id}`,
      kind: "wrapper-child",
      title: l1.name,
      parentTitle,
      data: makeData(l1, []),
    };
  }

  function makeWrapperSection(wrapperId: string, title = "Wrapper"): RundownSection {
    const wrapper = makeProject({ id: wrapperId, name: title, engagementType: "retainer" });
    return {
      anchor: `w-${wrapperId}`,
      kind: "wrapper",
      title,
      data: {
        raw: {
          kind: "wrapper",
          entity: wrapper,
          client: makeClient(),
          children: [],
          orphanWeekItems: [],
        },
        rows: [],
        chartIssues: [],
        axis: { kind: "no-axis", today: "2026-05-04" },
        headerRange: "null – null",
        generatedAt: "2026-05-04",
        summary: {
          rowsWithGaps: 0,
          totalRows: 0,
          chartIssueCount: 0,
          byCode: {},
          codeSeverity: {},
          severity: { critical: 0, warn: 0, info: 0 },
          chartIssues: [],
        },
      },
    };
  }

  it("renders the chip on a standalone section whose L1 id is in readyToCloseIds", () => {
    const l1 = makeProject({ id: "p-ready", name: "Ready Project" });
    render(
      <RundownContentRSC
        sections={[makeStandaloneSection(l1)]}
        readyToCloseIds={new Set(["p-ready"])}
      />
    );
    const chip = screen.getByTestId("ready-to-close-chip");
    // Chip lives inside the section's <summary>.
    expect(chip.closest("summary")).not.toBeNull();
    expect(chip).toHaveTextContent("Ready to close?");
  });

  it("does NOT render the chip on a standalone section whose L1 id is NOT in the set", () => {
    const l1 = makeProject({ id: "p-cold", name: "Cold Project" });
    render(
      <RundownContentRSC
        sections={[makeStandaloneSection(l1)]}
        readyToCloseIds={new Set(["other-id"])}
      />
    );
    expect(screen.queryByTestId("ready-to-close-chip")).not.toBeInTheDocument();
  });

  it("renders the chip on a wrapper-child whose L1 id is in the set", () => {
    const wrapper = makeWrapperSection("wrap1");
    const childReady = makeProject({ id: "child-ready", name: "Child Ready", parentProjectId: "wrap1" });
    const childCold = makeProject({ id: "child-cold", name: "Child Cold", parentProjectId: "wrap1" });
    render(
      <RundownContentRSC
        sections={[
          wrapper,
          makeWrapperChildSection(childReady),
          makeWrapperChildSection(childCold),
        ]}
        readyToCloseIds={new Set(["child-ready"])}
      />
    );
    const chips = screen.getAllByTestId("ready-to-close-chip");
    expect(chips).toHaveLength(1);
    // Chip's <summary> contains the child's title.
    expect(chips[0].closest("summary")).toHaveTextContent("Child Ready");
  });

  it("does NOT render chips when readyToCloseIds is undefined (back-compat)", () => {
    const l1 = makeProject({ id: "p1", name: "P1" });
    render(<RundownContentRSC sections={[makeStandaloneSection(l1)]} />);
    expect(screen.queryByTestId("ready-to-close-chip")).not.toBeInTheDocument();
  });

  it("does NOT render the chip on a wrapper section (wrapper raw kind has no L1 entity)", () => {
    // Even if the wrapper's id happens to be in the set, the chip
    // shouldn't fire — the chip rule only applies to L1 entities.
    const wrapper = makeWrapperSection("wrap1");
    render(
      <RundownContentRSC
        sections={[wrapper]}
        readyToCloseIds={new Set(["wrap1"])}
      />
    );
    expect(screen.queryByTestId("ready-to-close-chip")).not.toBeInTheDocument();
  });
});

// ── Track 4 Wave 4.4 — chevron-rotation polish on dark <details> ──
//
// Mirrors the Wave 4.1 CollapsibleSection pattern (which uses class
// `account-tier-details` + `account-tier-chevron`). Here every <details>
// emitted by RundownContentRSC gets `gantt-charts-details` + a custom
// chevron <span> as the first child of <summary>. Default open stays
// driven by the `open` attribute already wired to each element.
describe("RundownContentRSC chevron-rotation polish (Wave 4.4)", () => {
  const NOW = new Date("2026-05-04T00:00:00Z");

  function makeClient(): ClientRow {
    return {
      id: "c1",
      name: "Acme",
      slug: "acme",
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
      name: "P1",
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

  function makeData(l1: ProjectRow, weekItems: WeekItemRow[]): GanttData {
    return {
      raw: { kind: "l1", entity: l1, client: makeClient(), children: weekItems },
      rows: [],
      chartIssues: [],
      axis: { kind: "no-axis", today: "2026-05-04" },
      headerRange: "null – null",
      generatedAt: "2026-05-04",
      summary: {
        rowsWithGaps: 0,
        totalRows: 0,
        chartIssueCount: 0,
        byCode: {},
        codeSeverity: {},
        severity: { critical: 0, warn: 0, info: 0 },
        chartIssues: [],
      },
    };
  }

  function makeStandaloneSection(l1: ProjectRow): RundownSection {
    return {
      anchor: `s-${l1.id}`,
      kind: "standalone",
      title: l1.name,
      data: makeData(l1, []),
    };
  }

  function makeWrapperChildSection(l1: ProjectRow, parentTitle = "Wrapper"): RundownSection {
    return {
      anchor: `wc-${l1.id}`,
      kind: "wrapper-child",
      title: l1.name,
      parentTitle,
      data: makeData(l1, []),
    };
  }

  function makeWrapperSection(wrapperId: string, title = "Wrapper"): RundownSection {
    const wrapper = makeProject({ id: wrapperId, name: title, engagementType: "retainer" });
    return {
      anchor: `w-${wrapperId}`,
      kind: "wrapper",
      title,
      data: {
        raw: {
          kind: "wrapper",
          entity: wrapper,
          client: makeClient(),
          children: [],
          orphanWeekItems: [],
        },
        rows: [],
        chartIssues: [],
        axis: { kind: "no-axis", today: "2026-05-04" },
        headerRange: "null – null",
        generatedAt: "2026-05-04",
        summary: {
          rowsWithGaps: 0,
          totalRows: 0,
          chartIssueCount: 0,
          byCode: {},
          codeSeverity: {},
          severity: { critical: 0, warn: 0, info: 0 },
          chartIssues: [],
        },
      },
    };
  }

  it("applies the gantt-charts-details class to every <details> element rendered by the RSC", () => {
    // One wrapper + one child + one standalone — three separate
    // <details> elements should all carry the chevron polish class.
    const wrapper = makeWrapperSection("wrap1", "Wrapper Title");
    const child = makeProject({ id: "child-1", name: "Child", parentProjectId: "wrap1" });
    const standalone = makeProject({ id: "solo", name: "Solo Project" });
    const { container } = render(
      <RundownContentRSC
        sections={[
          wrapper,
          makeWrapperChildSection(child, "Wrapper Title"),
          makeStandaloneSection(standalone),
        ]}
      />
    );
    const allDetails = container.querySelectorAll("details");
    expect(allDetails.length).toBe(3);
    for (const d of allDetails) {
      expect(d.classList.contains("gantt-charts-details")).toBe(true);
      // Default-open stays wired so users see content on first paint.
      expect(d.hasAttribute("open")).toBe(true);
    }
  });

  it("renders a hidden chevron span as the first child of every <summary>", () => {
    const standalone = makeProject({ id: "solo", name: "Solo Project" });
    const { container } = render(
      <RundownContentRSC sections={[makeStandaloneSection(standalone)]} />
    );
    const summary = container.querySelector("summary");
    expect(summary).not.toBeNull();
    const firstChild = summary!.firstElementChild;
    expect(firstChild).not.toBeNull();
    expect(firstChild!.tagName.toLowerCase()).toBe("span");
    expect(firstChild!.classList.contains("gantt-charts-chevron")).toBe(true);
    expect(firstChild!.getAttribute("aria-hidden")).toBe("true");
    expect(firstChild!.textContent).toBe("▶");
  });
});
