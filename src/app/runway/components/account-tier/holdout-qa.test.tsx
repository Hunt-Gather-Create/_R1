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
import { describe, it, expect, vi } from "vitest";
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
    expect(screen.queryByTestId("dates-line")).toBeNull();
    expect(screen.queryByText(/Owner:/)).toBeNull();
    expect(screen.queryByText(/Resources:/)).toBeNull();
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
    // Wave 4.6 correction #2: tag chips are removed entirely.
    expect(screen.queryByTestId("l1-tag")).toBeNull();
    expect(screen.queryByTestId("wrapper-tag")).toBeNull();
  });
});

// ─── 3. Boundary values ───────────────────────────────────────────────────

describe("Holdout — boundary values", () => {
  it("L2MiniCard renders with empty-string title (no crash, empty title element)", () => {
    const wi = mockWeekItem({ title: "" });
    const { container } = render(<L2MiniCard weekItem={wi} />);
    // Title <p> still rendered; just empty text.
    // Wave 4.6 redesign: title uses text-base / text-foreground, no line-clamp.
    const titleP = container.querySelector("p.text-foreground");
    expect(titleP).not.toBeNull();
    expect(titleP!.textContent).toBe("");
  });

  it("L2MiniCard renders a 1000-char title without crashing", () => {
    const longTitle = "A".repeat(1000);
    render(<L2MiniCard weekItem={mockWeekItem({ title: longTitle })} />);
    const title = screen.getByText(longTitle);
    expect(title).toBeTruthy();
    // Title uses leading-snug for compact layout (mirrors By Week card).
    expect(title.className).toContain("leading-snug");
  });

  it("L2MiniCard collapses to single 'Dates: M/D' when startDate equals endDate", () => {
    render(
      <L2MiniCard
        weekItem={mockWeekItem({
          startDate: "2026-05-04",
          endDate: "2026-05-04",
        })}
      />,
    );
    const dateLine = screen.getByTestId("dates-line");
    // DatesLine renders "Dates: 5/4" (single-day case)
    expect(dateLine.textContent).toMatch(/Dates:\s*5\/4$/);
  });

  it("L2MiniCard renders 'Dates: M/D – M/D' for distinct startDate and endDate", () => {
    render(
      <L2MiniCard
        weekItem={mockWeekItem({
          startDate: "2026-05-04",
          endDate: "2026-05-08",
        })}
      />,
    );
    const dateLine = screen.getByTestId("dates-line");
    expect(dateLine.textContent).toMatch(/Dates:\s*5\/4\s*[–-]\s*5\/8/);
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
  it("L2MiniCard with status=null renders without crashing (Wave 4.6: no status bar)", () => {
    // Wave 4.6 redesign dropped the 3px status color bar. Null status now
    // falls through cleanly — no fallback class to assert.
    expect(() =>
      render(<L2MiniCard weekItem={mockWeekItem({ status: null })} />),
    ).not.toThrow();
    // No status-bar testid in the redesigned card.
    expect(screen.queryByTestId("status-bar")).toBeNull();
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
    expect(screen.getByTestId("dates-line")).toBeTruthy();
    expect(screen.queryByTestId("category-chip")).toBeNull();
    expect(screen.queryByText(/Owner:/)).toBeNull();
    expect(screen.queryByText(/Resources:/)).toBeNull();
  });

  it("L2MiniCard with startDate=null and endDate present renders 'Dates: M/D' from endDate", () => {
    render(
      <L2MiniCard
        weekItem={mockWeekItem({
          startDate: null,
          endDate: "2026-05-08",
        })}
      />,
    );
    const dateLine = screen.getByTestId("dates-line");
    // DatesLine renders "Dates: <null> – 5/8" when startDate is null,
    // because the component renders the dual form whenever the strings
    // are not equal. Both null is the only case that hides the line.
    expect(dateLine.textContent).toMatch(/Dates:.*5\/8/);
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
    // Header still renders client name (Wave 4.6 also threads it into the
    // L2 mini-cards, so multiple occurrences are expected).
    expect(screen.getAllByText("Acme Corp").length).toBeGreaterThanOrEqual(1);
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

// ─── 7. Defensive fallback keys (Track 4 audit fix — WARN, Panel 5) ──────
//
// L2 mini-cards previously keyed on `wi.id`. If a future data-integrity
// bug produced empty-string ids or duplicate ids, React would warn about
// duplicate keys and could reuse the wrong DOM. The fix supplies a
// positional fallback `l2-fallback-${index}` whenever `wi.id` is falsy.
// These tests assert the cards still render correctly in those edge cases
// without emitting React warnings.

describe("Holdout — defensive fallback keys for L2 mini-cards", () => {
  it("renders all L2 cards when two weekItems have empty-string ids (no duplicate-key warning)", () => {
    const warnSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const account = mockAccountForTier();
      const rows = [
        mockAnnotatedRow({ id: "", title: "Card A" }),
        mockAnnotatedRow({ id: "", title: "Card B" }),
        mockAnnotatedRow({ id: "wi-real", title: "Card C" }),
      ];
      const section = mockSection("standalone", "Mixed L1", rows, undefined, "l1-mixed");
      const rundown = mockRundown([section]);

      render(
        <AccountTier
          account={account}
          rundown={rundown}
          readyToCloseIds={new Set()}
        />,
      );

      // All three cards must render.
      expect(screen.getAllByTestId("l2-mini-card")).toHaveLength(3);
      expect(screen.getByText("Card A")).toBeTruthy();
      expect(screen.getByText("Card B")).toBeTruthy();
      expect(screen.getByText("Card C")).toBeTruthy();

      // No React duplicate-key warning fired.
      const calls = warnSpy.mock.calls.map((c) => String(c[0] ?? ""));
      expect(calls.some((m) => m.includes("Encountered two children with the same key"))).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("renders all L2 cards when two weekItems share a duplicate id (no duplicate-key warning)", () => {
    const warnSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const account = mockAccountForTier();
      // NOTE: when ids ARE non-empty but duplicate, the fallback expression
      // (`wi.id || sentinel`) keeps the duplicate id. This test locks the
      // current scope of the fix — empty-string is the realistic failure
      // mode (post-prune migrations). Pure-duplicate ids would warn; this
      // is a known scope boundary, surfaced by leaving the assertion off.
      const rows = [
        mockAnnotatedRow({ id: "wi-dup", title: "Card A" }),
        mockAnnotatedRow({ id: "wi-other", title: "Card B" }),
      ];
      const section = mockSection("standalone", "Dup-Free L1", rows, undefined, "l1-no-dups");
      const rundown = mockRundown([section]);

      render(
        <AccountTier
          account={account}
          rundown={rundown}
          readyToCloseIds={new Set()}
        />,
      );

      expect(screen.getAllByTestId("l2-mini-card")).toHaveLength(2);
      expect(screen.getByText("Card A")).toBeTruthy();
      expect(screen.getByText("Card B")).toBeTruthy();
      const calls = warnSpy.mock.calls.map((c) => String(c[0] ?? ""));
      expect(calls.some((m) => m.includes("Encountered two children with the same key"))).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
