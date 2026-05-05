/**
 * Track 4 — Holdout QA tests.
 *
 * These tests target edge cases and failure scenarios the dev-tier tests
 * (CollapsibleSection / L2MiniCard / AccountTier / runway-board.cross-tab)
 * never explicitly verified. Each describe block maps to a holdout
 * category from the QA brief: rapid interaction, failure injection,
 * boundary values, state transitions, missing-data null handling, and
 * render-load.
 *
 * Helper factories (`mockWeekItem`, `mockAccountForTier`, `mockSection`,
 * `mockRundown`) mirror the AccountTier.test.tsx fixtures but stay local
 * so this file stands on its own.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { L2MiniCard } from "./L2MiniCard";
import { AccountTier, type AccountForTier } from "./AccountTier";
import { CollapsibleSection } from "./CollapsibleSection";
import type {
  ClientRundownData,
  RundownSection,
  GanttData,
  AnnotatedRow,
} from "@/lib/runway/gantt/types";

// ─── Fixtures ─────────────────────────────────────────────────────────────

type WeekItemForCard = {
  id: string;
  title: string;
  owner: string | null;
  resources: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string | null;
  category: string | null;
};

function mockWeekItem(
  overrides: Partial<WeekItemForCard> = {},
): WeekItemForCard {
  return {
    id: "wi-default",
    title: "Default item",
    owner: "Lane",
    resources: "CD: Lane",
    startDate: "2026-05-04",
    endDate: "2026-05-08",
    status: "in-progress",
    category: "delivery",
    ...overrides,
  };
}

function mockAccountForTier(
  overrides: Partial<AccountForTier> = {},
): AccountForTier {
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

function mockAnnotatedRow(
  overrides: Partial<AnnotatedRow> = {},
): AnnotatedRow {
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

function mockGanttData(
  kind: "wrapper" | "l1",
  rows: AnnotatedRow[] = [],
  entityId: string = "p-1",
  entityTitle: string = "Project",
  entityExtras: Record<string, unknown> = {},
): GanttData {
  const raw =
    kind === "wrapper"
      ? {
          kind: "wrapper" as const,
          entity: { id: entityId, title: entityTitle, ...entityExtras } as never,
          client: {} as never,
          children: [] as never[],
          orphanWeekItems: [] as { id: string; title: string }[],
        }
      : {
          kind: "l1" as const,
          entity: { id: entityId, title: entityTitle, ...entityExtras } as never,
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

function mockSection(
  kind: "wrapper" | "wrapper-child" | "standalone",
  title: string,
  rows: AnnotatedRow[] = [],
  parentTitle?: string,
  entityId?: string,
  entityExtras: Record<string, unknown> = {},
): RundownSection {
  const dataKind = kind === "wrapper" ? "wrapper" : "l1";
  const id =
    entityId ?? `${kind}-${title}`.replace(/\s+/g, "-").toLowerCase();
  return {
    anchor: title.toLowerCase().replace(/\s+/g, "-"),
    kind,
    title,
    parentTitle,
    data: mockGanttData(dataKind, rows, id, title, entityExtras),
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

// ─── 1. Double-trigger / rapid interaction ────────────────────────────────

describe("Holdout — rapid interaction", () => {
  it("rapid double-click on <summary> ends in toggled state (parity with click count)", () => {
    // Two summary clicks should leave details closed (started open).
    // Native <details> handles this — the test locks the contract that
    // CollapsibleSection doesn't intercept and break it.
    const { container } = render(
      <CollapsibleSection header={<span>Hdr</span>} defaultOpen>
        <p>body</p>
      </CollapsibleSection>,
    );
    const details = container.querySelector("details") as HTMLDetailsElement;
    const summary = details.querySelector("summary") as HTMLElement;
    expect(details.open).toBe(true);

    fireEvent.click(summary);
    fireEvent.click(summary);

    // Two toggles -> back to open. Open boolean reflects the underlying
    // attribute; native <details> mutates `open` on click in jsdom/happy-dom.
    expect(details.open).toBe(true);
  });

  it("three rapid clicks land on closed (odd parity)", () => {
    const { container } = render(
      <CollapsibleSection header={<span>Hdr</span>} defaultOpen>
        <p>body</p>
      </CollapsibleSection>,
    );
    const details = container.querySelector("details") as HTMLDetailsElement;
    const summary = details.querySelector("summary") as HTMLElement;

    fireEvent.click(summary);
    fireEvent.click(summary);
    fireEvent.click(summary);

    expect(details.open).toBe(false);
  });
});

// ─── 2. Failure injection ─────────────────────────────────────────────────

describe("Holdout — failure injection", () => {
  it("L2MiniCard renders without crashing when every nullable field is null", () => {
    const wi: WeekItemForCard = {
      id: "wi-bare",
      title: "Bare title",
      owner: null,
      resources: null,
      startDate: null,
      endDate: null,
      status: null,
      category: null,
    };
    expect(() => render(<L2MiniCard weekItem={wi} />)).not.toThrow();
    expect(screen.getByText("Bare title")).toBeTruthy();
    // No date / owner / resources / category lines should render.
    expect(screen.queryByTestId("date-line")).toBeNull();
    expect(screen.queryByTestId("owner-line")).toBeNull();
    expect(screen.queryByTestId("resources-line")).toBeNull();
    expect(screen.queryByTestId("category-chip")).toBeNull();
  });

  it("AccountTier renders zero-section rundown without crashing (empty client)", () => {
    const account = mockAccountForTier();
    const empty = mockRundown([]);
    expect(() =>
      render(
        <AccountTier
          account={account}
          rundown={empty}
          readyToCloseIds={new Set()}
        />,
      ),
    ).not.toThrow();
    // Client header still renders.
    expect(screen.getByText("Acme Corp")).toBeTruthy();
  });

  it("AccountTier handles a wrapper with zero child L1s without throwing", () => {
    // Per spec, filterActiveRundown drops empty wrappers upstream. This test
    // verifies the AccountTier code path is still safe if one slips through.
    const account = mockAccountForTier();
    const rundown = mockRundown([
      mockSection("wrapper", "Lonely Wrapper", [], undefined, "wrap-empty"),
    ]);
    expect(() =>
      render(
        <AccountTier
          account={account}
          rundown={rundown}
          readyToCloseIds={new Set()}
        />,
      ),
    ).not.toThrow();
    expect(screen.getByText("Lonely Wrapper")).toBeTruthy();
    // Wrapper renders, but no L1 sections inside.
    expect(screen.queryByTestId("l1-tag")).toBeNull();
  });
});

// ─── 3. Boundary values ───────────────────────────────────────────────────

describe("Holdout — boundary values", () => {
  it("L2MiniCard renders with empty-string title (no crash, empty title element)", () => {
    const wi = mockWeekItem({ title: "" });
    const { container } = render(<L2MiniCard weekItem={wi} />);
    // Title <p> still rendered; just empty text.
    const titleP = container.querySelector("p.text-\\[13px\\]");
    expect(titleP).not.toBeNull();
    expect(titleP!.textContent).toBe("");
  });

  it("L2MiniCard preserves line-clamp-2 class on a 1000-char title (overflow contained)", () => {
    const longTitle = "A".repeat(1000);
    render(<L2MiniCard weekItem={mockWeekItem({ title: longTitle })} />);
    const title = screen.getByText(longTitle);
    expect(title.className).toContain("line-clamp-2");
  });

  it("L2MiniCard collapses to single 'M/D' when startDate equals endDate (UTC midnight)", () => {
    render(
      <L2MiniCard
        weekItem={mockWeekItem({
          startDate: "2026-05-04T00:00:00Z",
          endDate: "2026-05-04T00:00:00Z",
        })}
      />,
    );
    const dateLine = screen.getByTestId("date-line");
    expect(dateLine.textContent).toBe("5/4");
  });

  it("L2MiniCard renders M/D – M/D when timestamps differ but resolve to same UTC date", () => {
    // Same calendar day, different timestamps. The component currently
    // compares the raw ISO strings — non-equal strings render as a range.
    // This test locks that behavior so any future "smart" date-equality
    // shift is caught.
    render(
      <L2MiniCard
        weekItem={mockWeekItem({
          startDate: "2026-05-04T00:00:00Z",
          endDate: "2026-05-04T23:59:59Z",
        })}
      />,
    );
    const dateLine = screen.getByTestId("date-line");
    // Both timestamps fall on 5/4 UTC, but strings differ → renders as range.
    expect(dateLine.textContent).toBe("5/4 – 5/4");
  });

  it("AccountTier renders 100 L2 mini-cards with flex-wrap on the parent", () => {
    const rows = Array.from({ length: 100 }, (_, i) =>
      mockAnnotatedRow({
        id: `wi-${i}`,
        title: `Card ${i}`,
        startDate: "2026-05-04",
      }),
    );
    const rundown = mockRundown([
      mockSection("standalone", "Big L1", rows, undefined, "l1-big"),
    ]);
    const { container } = render(
      <AccountTier
        account={mockAccountForTier()}
        rundown={rundown}
        readyToCloseIds={new Set()}
      />,
    );
    const cards = screen.getAllByTestId("l2-mini-card");
    expect(cards.length).toBe(100);
    // The flex-wrap container is the immediate parent of all 100 cards.
    const parent = cards[0].parentElement;
    expect(parent).not.toBeNull();
    expect(parent!.className).toContain("flex");
    expect(parent!.className).toContain("flex-wrap");
  });
});

// ─── 4. State transition ──────────────────────────────────────────────────

describe("Holdout — state transition", () => {
  it("CollapsibleSection re-mounts at defaultOpen after unmount (no closed-state leak)", () => {
    const { container, unmount } = render(
      <CollapsibleSection header={<span>H</span>} defaultOpen>
        <p>body</p>
      </CollapsibleSection>,
    );
    const details = container.querySelector("details") as HTMLDetailsElement;
    fireEvent.click(details.querySelector("summary")!);
    expect(details.open).toBe(false);
    unmount();

    // Fresh mount — defaultOpen wins. This is the "navigate away, navigate
    // back" path that locks Track 4's tab-switch contract.
    const { container: c2 } = render(
      <CollapsibleSection header={<span>H</span>} defaultOpen>
        <p>body</p>
      </CollapsibleSection>,
    );
    const detailsRemounted = c2.querySelector(
      "details",
    ) as HTMLDetailsElement;
    expect(detailsRemounted.open).toBe(true);
  });

  it("CollapsibleSection rerender (same React tree) preserves user-toggled DOM state", () => {
    // When React re-renders the same component (props change but tree
    // identity is preserved), native <details> keeps its current open
    // state — defaultOpen does NOT re-apply. This locks the contract:
    // tab-switch must unmount, not just rerender.
    const { container, rerender } = render(
      <CollapsibleSection header={<span>H1</span>} defaultOpen>
        <p>body</p>
      </CollapsibleSection>,
    );
    const details = container.querySelector("details") as HTMLDetailsElement;
    fireEvent.click(details.querySelector("summary")!);
    expect(details.open).toBe(false);

    // Re-render with a different header but defaultOpen still true.
    rerender(
      <CollapsibleSection header={<span>H2</span>} defaultOpen>
        <p>body</p>
      </CollapsibleSection>,
    );
    const detailsAfterRerender = container.querySelector(
      "details",
    ) as HTMLDetailsElement;
    // Closed stays closed — defaultOpen is initial-mount-only.
    expect(detailsAfterRerender.open).toBe(false);
  });

  it("AccountTier rerenders cleanly when rundown prop changes between two states", () => {
    const account = mockAccountForTier();
    const rundownA = mockRundown([
      mockSection(
        "standalone",
        "L1 A",
        [mockAnnotatedRow({ id: "a", title: "Card A" })],
        undefined,
        "l1-a",
      ),
    ]);
    const rundownB = mockRundown([
      mockSection(
        "standalone",
        "L1 B",
        [mockAnnotatedRow({ id: "b", title: "Card B" })],
        undefined,
        "l1-b",
      ),
    ]);
    const { rerender } = render(
      <AccountTier
        account={account}
        rundown={rundownA}
        readyToCloseIds={new Set()}
      />,
    );
    expect(screen.getByText("L1 A")).toBeTruthy();
    expect(screen.queryByText("L1 B")).toBeNull();

    rerender(
      <AccountTier
        account={account}
        rundown={rundownB}
        readyToCloseIds={new Set()}
      />,
    );
    expect(screen.getByText("L1 B")).toBeTruthy();
    expect(screen.queryByText("L1 A")).toBeNull();
  });
});

// ─── 5. Missing data / null handling ──────────────────────────────────────

describe("Holdout — null handling", () => {
  it("L2MiniCard with status=null renders the slate scheduled fallback bar", () => {
    const { container } = render(
      <L2MiniCard weekItem={mockWeekItem({ status: null })} theme="light" />,
    );
    const bar = container.querySelector('[data-testid="status-bar"]');
    expect(bar).not.toBeNull();
    // null → "scheduled" fallback → bg-slate-300 in light theme.
    expect(bar!.className).toContain("bg-slate-300");
  });

  it("L2MiniCard with category=null AND owner=null AND resources=null still renders title + dates", () => {
    render(
      <L2MiniCard
        weekItem={mockWeekItem({
          category: null,
          owner: null,
          resources: null,
        })}
      />,
    );
    expect(screen.getByText("Default item")).toBeTruthy();
    expect(screen.getByTestId("date-line")).toBeTruthy();
    expect(screen.queryByTestId("category-chip")).toBeNull();
    expect(screen.queryByTestId("owner-line")).toBeNull();
    expect(screen.queryByTestId("resources-line")).toBeNull();
  });

  it("L2MiniCard with startDate=null and endDate present renders the M/D of endDate alone", () => {
    render(
      <L2MiniCard
        weekItem={mockWeekItem({
          startDate: null,
          endDate: "2026-05-08",
        })}
      />,
    );
    const dateLine = screen.getByTestId("date-line");
    expect(dateLine.textContent).toBe("5/8");
  });

  it("AccountTier client header with severity=null AND sowSigned=null renders without empty badge containers", () => {
    const account = mockAccountForTier({
      severity: null,
      sowSigned: null,
    });
    const rundown = mockRundown([
      mockSection(
        "standalone",
        "L1 A",
        [mockAnnotatedRow()],
        undefined,
        "l1-a",
      ),
    ]);
    render(
      <AccountTier
        account={account}
        rundown={rundown}
        readyToCloseIds={new Set()}
      />,
    );
    expect(screen.queryByTestId("client-severity-badge")).toBeNull();
    expect(screen.queryByTestId("client-sow-chip")).toBeNull();
    // Header still renders client name.
    expect(screen.getByText("Acme Corp")).toBeTruthy();
  });

  it("AccountTier renders L1 header cleanly when entity owner/resources are null", () => {
    // Pass entity extras with explicit null owner/resources — L1Header should
    // skip those spans without rendering "O: null" or empty-string output.
    const account = mockAccountForTier();
    const section = mockSection(
      "standalone",
      "Null-Owner L1",
      [mockAnnotatedRow()],
      undefined,
      "l1-null",
      { owner: null, resources: null },
    );
    const rundown = mockRundown([section]);
    const { container } = render(
      <AccountTier
        account={account}
        rundown={rundown}
        readyToCloseIds={new Set()}
      />,
    );
    expect(screen.getByText("Null-Owner L1")).toBeTruthy();
    // No "O:" line should leak from the L1 header.
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/O:\s*(null|undefined)/);
  });
});
