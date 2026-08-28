import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AccountTier } from "./AccountTier";
import type {
  ClientRundownData,
  RundownSection,
  GanttData,
  AnnotatedRow,
} from "@/lib/runway/gantt/types";

// ─── Test fixture factories ───────────────────────────────────────────────

type AccountForTier = {
  name: string;
  slug: string;
  team: string | null;
  severity: "critical" | "warning" | null;
  sowSigned: boolean | null;
  contractStart: string | null;
  contractEnd: string | null;
  // #78 — schema mirrors src AccountForTier; tests don't exercise these
  // fields directly (account-section.test.tsx covers the AuditBadge path).
  ganttSeverity?: { critical: number; warn: number; info: number };
  ganttAuditIssues?: import("../audit-badge").AuditIssue[];
};

function mockAccount(overrides: Partial<AccountForTier> = {}): AccountForTier {
  return {
    name: "Acme Corp",
    slug: "acme-corp",
    team: "Lane / Leslie",
    severity: null,
    sowSigned: true,
    contractStart: "2026-04-01",
    contractEnd: "2026-06-30",
    ...overrides,
  };
}

function makeWeekItemRow(overrides: Partial<AnnotatedRow> = {}): AnnotatedRow {
  return {
    kind: "weekitem",
    id: `wi-${Math.random().toString(36).slice(2, 8)}`,
    title: "Weekly deliverable",
    owner: "Lane",
    resources: "CD: Lane",
    startDate: "2026-05-04",
    endDate: "2026-05-08",
    status: "in-progress",
    category: "delivery",
    weekOf: "2026-05-04",
    inline: [],
    subRow: [],
    ...overrides,
  } as AnnotatedRow;
}

function makeGanttData(
  kind: "wrapper" | "l1",
  rows: AnnotatedRow[] = [],
  entityId: string = "p-1",
  entityTitle: string = "Project",
): GanttData {
  // Cast through unknown — tests only consume `raw.kind`, `raw.entity.id`,
  // and `rows`. Building the full DB shape would balloon the fixture.
  const raw =
    kind === "wrapper"
      ? {
          kind: "wrapper" as const,
          entity: { id: entityId, title: entityTitle } as never,
          client: {} as never,
          children: [] as never[],
          directWeekItems: [] as never[],
        }
      : {
          kind: "l1" as const,
          entity: { id: entityId, title: entityTitle } as never,
          client: {} as never,
          children: [] as never[],
        };

  return {
    raw,
    rows,
    chartIssues: [],
    axis: { kind: "no-axis", today: "2026-05-05" },
    headerRange: "5/4 – 5/8",
    generatedAt: "2026-05-05",
    summary: {
      rowsWithGaps: 0,
      totalRows: rows.length,
      chartIssueCount: 0,
      byCode: {},
      codeSeverity: {},
      severity: { critical: 0, warn: 0, info: 0 },
      chartIssues: [],
    },
  };
}

function makeSection(
  kind: "wrapper" | "wrapper-child" | "standalone",
  title: string,
  rows: AnnotatedRow[] = [],
  parentTitle?: string,
  entityId: string = `${kind}-${title}`.replace(/\s+/g, "-").toLowerCase(),
): RundownSection {
  const dataKind = kind === "wrapper" ? "wrapper" : "l1";
  return {
    anchor: title.toLowerCase().replace(/\s+/g, "-"),
    kind,
    title,
    parentTitle,
    data: makeGanttData(dataKind, rows, entityId, title),
  };
}

function mockRundown(sections: RundownSection[]): ClientRundownData {
  return {
    client: { id: "c-1", name: "Acme Corp" } as never,
    sections,
    generatedAt: "2026-05-05",
    overallSeverity: { critical: 0, warn: 0, info: 0 },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("AccountTier", () => {
  it("renders the client header with name, team, and contract date range", () => {
    const account = mockAccount();
    const rundown = mockRundown([
      makeSection("standalone", "L1 Project", [makeWeekItemRow()], undefined, "l1-a"),
    ]);
    render(
      <AccountTier
        account={account}
        rundown={rundown}
        readyToCloseIds={new Set()}
      />,
    );
    // "Acme Corp" appears in both the client header AND in each L2 mini-card
    // (Wave 4.6 correction #6 threads accountName into the cards). Both are
    // expected — assert presence of both occurrences.
    const occurrences = screen.getAllByText("Acme Corp");
    expect(occurrences.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Lane \/ Leslie/)).toBeTruthy();
    // 2026-04-01 -> 4/1 ; 2026-06-30 -> 6/30
    expect(screen.getByText(/4\/1\s*[–-]\s*6\/30/)).toBeTruthy();
  });

  it("renders a critical severity badge when account.severity === 'critical'", () => {
    const account = mockAccount({ severity: "critical" });
    const rundown = mockRundown([
      makeSection("standalone", "L1 A", [makeWeekItemRow()], undefined, "l1-a"),
    ]);
    render(
      <AccountTier
        account={account}
        rundown={rundown}
        readyToCloseIds={new Set()}
      />,
    );
    expect(screen.getByTestId("client-severity-badge")).toBeTruthy();
  });

  it("renders the SOW chip when account.sowSigned === true", () => {
    const account = mockAccount({ sowSigned: true });
    const rundown = mockRundown([
      makeSection("standalone", "L1 A", [makeWeekItemRow()], undefined, "l1-a"),
    ]);
    render(
      <AccountTier
        account={account}
        rundown={rundown}
        readyToCloseIds={new Set()}
      />,
    );
    expect(screen.getByTestId("client-sow-chip")).toBeTruthy();
  });

  it("renders a wrapper section with wrapper title (no chip)", () => {
    const account = mockAccount();
    const rundown = mockRundown([
      makeSection("wrapper", "Q2 Retainer", [], undefined, "wrap-1"),
      makeSection("wrapper-child", "L1 Sub A", [makeWeekItemRow()], "Q2 Retainer", "l1-a"),
    ]);
    const { container } = render(
      <AccountTier
        account={account}
        rundown={rundown}
        readyToCloseIds={new Set()}
      />,
    );
    expect(screen.getByText("Q2 Retainer")).toBeTruthy();
    // Wave 4.6 correction #2: no WRAPPER chip should render
    expect(container.querySelector('[data-testid="wrapper-tag"]')).toBeNull();
  });

  it("renders all wrapper-children L1s under their parent wrapper in order", () => {
    const account = mockAccount();
    const rundown = mockRundown([
      makeSection("wrapper", "Q2 Retainer", [], undefined, "wrap-1"),
      makeSection("wrapper-child", "L1 Sub A", [makeWeekItemRow()], "Q2 Retainer", "l1-a"),
      makeSection("wrapper-child", "L1 Sub B", [makeWeekItemRow()], "Q2 Retainer", "l1-b"),
    ]);
    render(
      <AccountTier
        account={account}
        rundown={rundown}
        readyToCloseIds={new Set()}
      />,
    );
    expect(screen.getByText("L1 Sub A")).toBeTruthy();
    expect(screen.getByText("L1 Sub B")).toBeTruthy();
  });

  it("does NOT render WRAPPER-CHILD or STANDALONE L1 chips (Wave 4.6 correction #2)", () => {
    const account = mockAccount();
    const rundown = mockRundown([
      makeSection("wrapper", "Q2 Retainer", [], undefined, "wrap-1"),
      makeSection("wrapper-child", "L1 Sub A", [makeWeekItemRow()], "Q2 Retainer", "l1-a"),
      makeSection("standalone", "Solo L1", [makeWeekItemRow()], undefined, "l1-solo"),
    ]);
    const { container } = render(
      <AccountTier
        account={account}
        rundown={rundown}
        readyToCloseIds={new Set()}
      />,
    );
    expect(container.querySelector('[data-testid="l1-tag"]')).toBeNull();
    expect(container.textContent).not.toContain("WRAPPER-CHILD");
    expect(container.textContent).not.toContain("STANDALONE L1");
  });

  it("renders L2 mini-cards inside an L1 section's flex-wrap container", () => {
    const account = mockAccount();
    const rows = [
      makeWeekItemRow({ id: "wi-a", title: "Card A", startDate: "2026-05-04" }),
      makeWeekItemRow({ id: "wi-b", title: "Card B", startDate: "2026-05-06" }),
    ];
    const rundown = mockRundown([
      makeSection("standalone", "Solo L1", rows, undefined, "l1-solo"),
    ]);
    render(
      <AccountTier
        account={account}
        rundown={rundown}
        readyToCloseIds={new Set()}
      />,
    );
    const cards = screen.getAllByTestId("l2-mini-card");
    expect(cards.length).toBe(2);
  });

  it("threads accountName into each L2 mini-card (Wave 4.6 correction #6)", () => {
    const account = mockAccount({ name: "Acme Corp" });
    const rundown = mockRundown([
      makeSection(
        "standalone",
        "Solo L1",
        [makeWeekItemRow({ id: "wi-a", title: "Card A" })],
        undefined,
        "l1-solo",
      ),
    ]);
    render(
      <AccountTier
        account={account}
        rundown={rundown}
        readyToCloseIds={new Set()}
      />,
    );
    // The account name renders both in the client header AND inside each
    // L2 mini-card. Two occurrences total.
    const occurrences = screen.getAllByText("Acme Corp");
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  it("filters out completed L2 cards from the By Account view (Wave 4.6 correction #1)", () => {
    const account = mockAccount();
    const rows = [
      makeWeekItemRow({ id: "wi-active", title: "Active Task", status: "in-progress" }),
      makeWeekItemRow({ id: "wi-done", title: "Done Task", status: "completed" }),
    ];
    const rundown = mockRundown([
      makeSection("standalone", "Solo L1", rows, undefined, "l1-solo"),
    ]);
    render(
      <AccountTier
        account={account}
        rundown={rundown}
        readyToCloseIds={new Set()}
      />,
    );
    expect(screen.getByText("Active Task")).toBeTruthy();
    expect(screen.queryByText("Done Task")).toBeNull();
  });

  it("filters out canceled L2 cards from the By Account view (Wave 4.6 correction #1)", () => {
    const account = mockAccount();
    const rows = [
      makeWeekItemRow({ id: "wi-active", title: "Active Task", status: "in-progress" }),
      makeWeekItemRow({ id: "wi-canc", title: "Canceled Task", status: "canceled" }),
    ];
    const rundown = mockRundown([
      makeSection("standalone", "Solo L1", rows, undefined, "l1-solo"),
    ]);
    render(
      <AccountTier
        account={account}
        rundown={rundown}
        readyToCloseIds={new Set()}
      />,
    );
    expect(screen.getByText("Active Task")).toBeTruthy();
    expect(screen.queryByText("Canceled Task")).toBeNull();
  });

  it("renders L1 as empty (No Scheduled Tasks chip) when all its L2s are completed", () => {
    const account = mockAccount();
    const rows = [
      makeWeekItemRow({ id: "wi-1", title: "Done A", status: "completed" }),
      makeWeekItemRow({ id: "wi-2", title: "Done B", status: "canceled" }),
    ];
    const rundown = mockRundown([
      makeSection("standalone", "Solo L1", rows, undefined, "l1-solo"),
    ]);
    render(
      <AccountTier
        account={account}
        rundown={rundown}
        readyToCloseIds={new Set()}
      />,
    );
    expect(screen.queryByText("Done A")).toBeNull();
    expect(screen.queryByText("Done B")).toBeNull();
    expect(screen.getByTestId("no-scheduled-tasks-chip")).toBeTruthy();
  });

  it("sorts L2 cards by startDate ascending with nulls last", () => {
    const account = mockAccount();
    const rows = [
      makeWeekItemRow({ id: "wi-late", title: "Late Card", startDate: "2026-05-10" }),
      makeWeekItemRow({ id: "wi-null", title: "Null Card", startDate: null }),
      makeWeekItemRow({ id: "wi-early", title: "Early Card", startDate: "2026-05-01" }),
    ];
    const rundown = mockRundown([
      makeSection("standalone", "Solo L1", rows, undefined, "l1-solo"),
    ]);
    render(
      <AccountTier
        account={account}
        rundown={rundown}
        readyToCloseIds={new Set()}
      />,
    );
    const cards = screen.getAllByTestId("l2-mini-card");
    // Sort order: Early (5/1), Late (5/10), Null (last)
    expect(cards[0].textContent).toContain("Early Card");
    expect(cards[1].textContent).toContain("Late Card");
    expect(cards[2].textContent).toContain("Null Card");
  });

  it("renders empty L1 with inline 'No Scheduled Tasks' chip and NO collapse details", () => {
    const account = mockAccount();
    const rundown = mockRundown([
      makeSection("standalone", "Empty L1", [], undefined, "l1-empty"),
    ]);
    const { container } = render(
      <AccountTier
        account={account}
        rundown={rundown}
        readyToCloseIds={new Set()}
      />,
    );
    expect(screen.getByTestId("no-scheduled-tasks-chip")).toBeTruthy();
    expect(container.textContent).toContain("No Scheduled Tasks");
    // The empty L1 should NOT be wrapped in its own <details>; there will
    // still be the outer client <details> but no inner collapse section
    // for the empty L1.
    const allDetails = container.querySelectorAll("details");
    // 1 outer client details only; no inner L1 details for empty L1.
    expect(allDetails.length).toBe(1);
  });

  it("does NOT render the legacy '(no scheduled L2s)' annotation (Wave 4.6 correction #4)", () => {
    const account = mockAccount();
    const rundown = mockRundown([
      makeSection("standalone", "Empty L1", [], undefined, "l1-empty"),
    ]);
    const { container } = render(
      <AccountTier
        account={account}
        rundown={rundown}
        readyToCloseIds={new Set()}
      />,
    );
    expect(container.textContent).not.toMatch(/no scheduled L2s/i);
  });

  it("hides the contract date range when both contractStart and contractEnd are null (Wave 4.6 correction #7)", () => {
    const account = mockAccount({
      contractStart: null,
      contractEnd: null,
    });
    const rundown = mockRundown([
      makeSection("standalone", "L1 A", [makeWeekItemRow()], undefined, "l1-a"),
    ]);
    const { container } = render(
      <AccountTier
        account={account}
        rundown={rundown}
        readyToCloseIds={new Set()}
      />,
    );
    // No literal "null – null" or "null" string in the client header span.
    // The L2 cards' DatesLine is unaffected because makeWeekItemRow has dates set.
    expect(container.textContent).not.toContain("null – null");
    expect(container.textContent).not.toContain("null");
  });

  it("surfaces 'Ready to close?' chip on an L1 whose id is in readyToCloseIds", () => {
    const account = mockAccount();
    const rundown = mockRundown([
      makeSection("standalone", "Closing L1", [makeWeekItemRow()], undefined, "l1-closing"),
    ]);
    render(
      <AccountTier
        account={account}
        rundown={rundown}
        readyToCloseIds={new Set(["l1-closing"])}
      />,
    );
    expect(screen.getByTestId("ready-to-close-chip")).toBeTruthy();
  });

  it("does NOT surface 'Ready to close?' chip when L1 id is not in the set", () => {
    const account = mockAccount();
    const rundown = mockRundown([
      makeSection("standalone", "Closing L1", [makeWeekItemRow()], undefined, "l1-closing"),
    ]);
    render(
      <AccountTier
        account={account}
        rundown={rundown}
        readyToCloseIds={new Set(["different-id"])}
      />,
    );
    expect(screen.queryByTestId("ready-to-close-chip")).toBeNull();
  });

  // Issue #41: an L1 with zero scheduled items has nothing to be ready-to-close
  // on. The ReadyToClose chip is suppressed in the empty branch so the empty
  // state shows only "No Scheduled Tasks", never both chips at once.
  it("suppresses ReadyToClose chip on an empty L1 even when its id is in readyToCloseIds (Issue #41)", () => {
    const account = mockAccount();
    // Empty L1 section — no weekItems at all.
    const rundown = mockRundown([
      makeSection("standalone", "Empty L1", [], undefined, "l1-empty-closing"),
    ]);
    render(
      <AccountTier
        account={account}
        rundown={rundown}
        readyToCloseIds={new Set(["l1-empty-closing"])}
      />,
    );
    // Empty branch still renders the NoScheduledTasks chip.
    expect(screen.getByTestId("l1-empty")).toBeTruthy();
    expect(screen.getByTestId("no-scheduled-tasks-chip")).toBeTruthy();
    // But NOT the ReadyToClose chip — that would contradict the empty state.
    expect(screen.queryByTestId("ready-to-close-chip")).toBeNull();
  });

  it("renders all CollapsibleSections expanded by default", () => {
    const account = mockAccount();
    const rundown = mockRundown([
      makeSection("wrapper", "Q2 Retainer", [], undefined, "wrap-1"),
      makeSection("wrapper-child", "L1 Sub A", [makeWeekItemRow()], "Q2 Retainer", "l1-a"),
      makeSection("standalone", "Solo L1", [makeWeekItemRow()], undefined, "l1-solo"),
    ]);
    const { container } = render(
      <AccountTier
        account={account}
        rundown={rundown}
        readyToCloseIds={new Set()}
      />,
    );
    const detailsEls = container.querySelectorAll("details");
    expect(detailsEls.length).toBeGreaterThan(0);
    detailsEls.forEach((d) => {
      expect(d.hasAttribute("open")).toBe(true);
    });
  });

  it("uses design tokens (text-foreground) for the L1 title (Wave 4.6 correction #5)", () => {
    const account = mockAccount();
    const rundown = mockRundown([
      makeSection("standalone", "Solo L1", [makeWeekItemRow()], undefined, "l1-solo"),
    ]);
    const { container } = render(
      <AccountTier
        account={account}
        rundown={rundown}
        readyToCloseIds={new Set()}
      />,
    );
    // The L1 title span uses `text-foreground` — no explicit slate scale.
    expect(container.innerHTML).toContain("text-foreground");
    expect(container.innerHTML).not.toContain("text-slate-100");
  });

  it("renders multiple wrappers and standalone L1s in one rundown in correct order", () => {
    const account = mockAccount();
    const rundown = mockRundown([
      makeSection("wrapper", "Wrapper Alpha", [], undefined, "wrap-a"),
      makeSection("wrapper-child", "Sub A1", [makeWeekItemRow()], "Wrapper Alpha", "l1-a1"),
      makeSection("standalone", "Standalone X", [makeWeekItemRow()], undefined, "l1-x"),
      makeSection("wrapper", "Wrapper Beta", [], undefined, "wrap-b"),
      makeSection("wrapper-child", "Sub B1", [makeWeekItemRow()], "Wrapper Beta", "l1-b1"),
    ]);
    const { container } = render(
      <AccountTier
        account={account}
        rundown={rundown}
        readyToCloseIds={new Set()}
      />,
    );
    expect(screen.getByText("Wrapper Alpha")).toBeTruthy();
    expect(screen.getByText("Wrapper Beta")).toBeTruthy();
    expect(screen.getByText("Standalone X")).toBeTruthy();
    expect(screen.getByText("Sub A1")).toBeTruthy();
    expect(screen.getByText("Sub B1")).toBeTruthy();

    // Verify ordering: Wrapper Alpha block precedes Standalone X precedes Wrapper Beta
    const text = container.textContent ?? "";
    const idxAlpha = text.indexOf("Wrapper Alpha");
    const idxStandalone = text.indexOf("Standalone X");
    const idxBeta = text.indexOf("Wrapper Beta");
    expect(idxAlpha).toBeLessThan(idxStandalone);
    expect(idxStandalone).toBeLessThan(idxBeta);
  });

  it("hides a wrapper block whose children all filtered out, alongside live siblings (#42)", () => {
    const account = mockAccount();
    // Wrapper Alpha has zero surviving children (dead zone). Wrapper Beta
    // has one live child. Standalone X is unrelated. AccountTier should
    // render Beta + Standalone but suppress Alpha entirely.
    const rundown = mockRundown([
      makeSection("wrapper", "Wrapper Alpha", [], undefined, "wrap-a"),
      makeSection("wrapper", "Wrapper Beta", [], undefined, "wrap-b"),
      makeSection("wrapper-child", "Sub B1", [makeWeekItemRow()], "Wrapper Beta", "l1-b1"),
      makeSection("standalone", "Standalone X", [makeWeekItemRow()], undefined, "l1-x"),
    ]);
    render(
      <AccountTier
        account={account}
        rundown={rundown}
        readyToCloseIds={new Set()}
      />,
    );
    expect(screen.queryByText("Wrapper Alpha")).toBeNull();
    expect(screen.getByText("Wrapper Beta")).toBeTruthy();
    expect(screen.getByText("Sub B1")).toBeTruthy();
    expect(screen.getByText("Standalone X")).toBeTruthy();
  });
});

// ─── 4-level hierarchy: §3.3 render contract (L3 bands + one-off card) ────

import type { L3SectionDisplay } from "@/lib/runway/gantt/types";

function makeL3(overrides: Partial<L3SectionDisplay> = {}): L3SectionDisplay {
  return {
    id: "l3-1",
    title: "Design Phase",
    sortOrder: 0,
    notes: null,
    status: null,
    owner: null,
    resources: null,
    startDate: null,
    endDate: null,
    actionable: false,
    derivedStartDate: "2026-05-04",
    derivedEndDate: "2026-05-08",
    ...overrides,
  };
}

describe("AccountTier — L3 section bands (§3.3)", () => {
  function renderWithL3(
    l3Sections: L3SectionDisplay[],
    rows: AnnotatedRow[],
  ) {
    const section = makeSection("standalone", "L1 Project", rows, undefined, "l1-a");
    section.l3Sections = l3Sections;
    return render(
      <AccountTier
        account={mockAccount()}
        rundown={mockRundown([section])}
        readyToCloseIds={new Set()}
      />,
    );
  }

  it("D8: all-null section renders as a pure grouping band with grayed derived range", () => {
    renderWithL3(
      [makeL3()],
      [makeWeekItemRow({ sectionId: "l3-1" } as Partial<AnnotatedRow>)],
    );
    expect(screen.getByTestId("l3-band-grouping")).toBeTruthy();
    expect(screen.queryByTestId("l3-band-actionable")).toBeNull();
    // Derived dates render grayed, never solid.
    expect(screen.getByTestId("l3-dates-derived")).toBeTruthy();
    expect(screen.queryByTestId("l3-dates-own")).toBeNull();
    // _R1#105 — open-work count reads "N open", not the old bare "N task(s)".
    expect(screen.getByText("1 open")).toBeTruthy();
  });

  it("actionable section renders ONE band with its own solid chips — never a phantom child card", () => {
    renderWithL3(
      [
        makeL3({
          id: "l3-2",
          title: "Development",
          status: "in-progress",
          owner: "Lane",
          startDate: "2026-05-01",
          endDate: "2026-05-20",
          actionable: true,
        }),
      ],
      [makeWeekItemRow({ sectionId: "l3-2" } as Partial<AnnotatedRow>)],
    );
    const bands = screen.getAllByTestId("l3-band-actionable");
    expect(bands).toHaveLength(1);
    expect(screen.getByTestId("section-status-chip").textContent).toBe("in-progress");
    expect(screen.getByTestId("l3-dates-own")).toBeTruthy();
    expect(screen.queryByTestId("l3-dates-derived")).toBeNull();
    // The section title appears exactly once — the band. No phantom task
    // card carries the section's own title.
    expect(screen.getAllByText("Development")).toHaveLength(1);
  });

  it("per-field own-value-wins: actionable section with null dates shows derived grayed", () => {
    renderWithL3(
      [
        makeL3({
          id: "l3-3",
          title: "QA",
          status: "blocked",
          actionable: true,
          derivedStartDate: "2026-06-01",
          derivedEndDate: "2026-06-05",
        }),
      ],
      [makeWeekItemRow({ sectionId: "l3-3" } as Partial<AnnotatedRow>)],
    );
    expect(screen.getByTestId("l3-band-actionable")).toBeTruthy();
    expect(screen.getByTestId("l3-dates-derived")).toBeTruthy();
    expect(screen.queryByTestId("l3-dates-own")).toBeNull();
  });

  it("renders sections in order with loose tasks LAST, never interleaved", () => {
    const { container } = renderWithL3(
      [
        makeL3({ id: "l3-a", title: "Phase One", sortOrder: 0 }),
        makeL3({ id: "l3-b", title: "Phase Two", sortOrder: 1 }),
      ],
      [
        makeWeekItemRow({ id: "wi-loose", title: "Loose Task", startDate: "2026-05-01" } as Partial<AnnotatedRow>),
        makeWeekItemRow({ id: "wi-a", title: "Task In One", sectionId: "l3-a" } as Partial<AnnotatedRow>),
        makeWeekItemRow({ id: "wi-b", title: "Task In Two", sectionId: "l3-b" } as Partial<AnnotatedRow>),
      ],
    );
    const text = container.textContent ?? "";
    const idxOne = text.indexOf("Task In One");
    const idxTwo = text.indexOf("Task In Two");
    const idxLoose = text.indexOf("Loose Task");
    expect(idxOne).toBeGreaterThan(-1);
    expect(idxTwo).toBeGreaterThan(idxOne);
    expect(idxLoose).toBeGreaterThan(idxTwo);
    expect(screen.getByTestId("l3-loose-tasks")).toBeTruthy();
  });

  it("falls back to the flat list when the project has zero sections", () => {
    renderWithL3([], [makeWeekItemRow({ title: "Flat Task" } as Partial<AnnotatedRow>)]);
    expect(screen.queryByTestId("l3-band-grouping")).toBeNull();
    expect(screen.queryByTestId("l3-band-actionable")).toBeNull();
    expect(screen.getByText("Flat Task")).toBeTruthy();
  });

  // _R1#105 — the count and the label must agree about what they mean.
  // `weekItemsForSection` correctly drops completed/canceled rows for the
  // active view (that filter is NOT the bug). The bug is that a section
  // whose rows are ALL terminal renders the raw filtered count ("0 tasks"),
  // which reads as a failed import instead of finished work.
  describe("_R1#105 — section task-count label", () => {
    it("open tasks: shows an open-work count, e.g. '1 open'", () => {
      renderWithL3(
        [makeL3({ id: "l3-open" })],
        [makeWeekItemRow({ sectionId: "l3-open", status: "in-progress" } as Partial<AnnotatedRow>)],
      );
      expect(screen.getByText("1 open")).toBeTruthy();
      expect(screen.queryByText("0 tasks")).toBeNull();
    });

    it("a MIXED section counts only the OPEN rows, not every row", () => {
      // Every other case here has openCount === totalCount (l3-open is a
      // single in-progress row) or takes the all-terminal/empty branch
      // (l3-done, l3-empty), so none of them can tell "count the open rows"
      // apart from "count every row". A mixed section — one open row plus
      // one terminal row — is the only fixture where the two numbers
      // differ, which is the only way this test can fail if the label ever
      // regresses to the total count.
      renderWithL3(
        [makeL3({ id: "l3-mixed" })],
        [
          makeWeekItemRow({ sectionId: "l3-mixed", status: "in-progress" } as Partial<AnnotatedRow>),
          makeWeekItemRow({ sectionId: "l3-mixed", status: "completed" } as Partial<AnnotatedRow>),
        ],
      );
      expect(screen.getByText("1 open")).toBeTruthy();
      expect(screen.queryByText("2 open")).toBeNull();
    });

    it("all-terminal section reads as finished work ('all done'), not a failed import ('0 tasks')", () => {
      // The L1 overall is NOT empty (a sibling L3 has an open task) — so
      // this exercises the L3-band "all rows terminal" case, not the
      // whole-L1 "No Scheduled Tasks" empty state.
      renderWithL3(
        [makeL3({ id: "l3-has-work", sortOrder: 0 }), makeL3({ id: "l3-done", sortOrder: 1 })],
        [
          makeWeekItemRow({ sectionId: "l3-has-work", status: "in-progress" } as Partial<AnnotatedRow>),
          makeWeekItemRow({ sectionId: "l3-done", status: "completed" } as Partial<AnnotatedRow>),
        ],
      );
      // The l3-done section HAS a row — it is finished, not empty. It must
      // never render the same "0 tasks" text a genuinely empty section would.
      expect(screen.queryByText("0 tasks")).toBeNull();
      expect(screen.getByText("all done")).toBeTruthy();
    });

    it("genuinely empty section: distinct wording from both open and all-done", () => {
      // The L1 overall is NOT empty (it has an open task in a sibling L3
      // section) — so this exercises the L3-band "zero rows at all" case,
      // not the whole-L1 "No Scheduled Tasks" empty state.
      renderWithL3(
        [makeL3({ id: "l3-has-work", sortOrder: 0 }), makeL3({ id: "l3-empty", sortOrder: 1 })],
        [makeWeekItemRow({ sectionId: "l3-has-work", status: "in-progress" } as Partial<AnnotatedRow>)],
      );
      expect(screen.queryByText("0 tasks")).toBeNull();
      expect(screen.queryByText("all done")).toBeNull();
      expect(screen.getByText("no tasks")).toBeTruthy();
    });
  });
});

describe("AccountTier — one-off L1 card (§3.3)", () => {
  it("renders a childless one-off L1 as a first-class card, not empty-project UI", () => {
    const section = makeSection("standalone", "Father's Day Page", [], undefined, "l1-oneoff");
    (section.data.raw as { entity: Record<string, unknown> }).entity = {
      id: "l1-oneoff",
      title: "Father's Day Page",
      engagementType: "one-off",
      status: "in-production",
      owner: "Kaci",
      resources: null,
      startDate: "2026-06-10",
      endDate: "2026-06-17",
    };
    render(
      <AccountTier
        account={mockAccount()}
        rundown={mockRundown([section])}
        readyToCloseIds={new Set()}
      />,
    );
    expect(screen.getByTestId("l1-one-off-card")).toBeTruthy();
    expect(screen.getByTestId("one-off-chip")).toBeTruthy();
    expect(screen.queryByText("No Scheduled Tasks")).toBeNull();
    expect(screen.queryByTestId("l1-empty")).toBeNull();
  });

  it("keeps the standard empty state for non-one-off L1s", () => {
    const section = makeSection("standalone", "Regular Empty", [], undefined, "l1-reg");
    render(
      <AccountTier
        account={mockAccount()}
        rundown={mockRundown([section])}
        readyToCloseIds={new Set()}
      />,
    );
    expect(screen.getByTestId("l1-empty")).toBeTruthy();
    expect(screen.queryByTestId("l1-one-off-card")).toBeNull();
  });
});
