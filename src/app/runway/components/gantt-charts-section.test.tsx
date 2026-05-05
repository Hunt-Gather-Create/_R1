import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GanttChartsSection } from "./gantt-charts-section";
import type { Account } from "../types";
import type { SeverityCounts } from "@/lib/runway/gantt/types";

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
