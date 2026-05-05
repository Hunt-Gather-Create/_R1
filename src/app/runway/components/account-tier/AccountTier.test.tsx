import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
  severity: "critical" | "warning" | "ok" | null;
  sowSigned: boolean | null;
  contractStart: string | null;
  contractEnd: string | null;
  ganttSeverity?: "critical" | "warning" | null;
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
          orphanWeekItems: [] as { id: string; title: string }[],
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
    expect(screen.getByText("Acme Corp")).toBeTruthy();
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

  it("renders a wrapper section with wrapper title and WRAPPER tag", () => {
    const account = mockAccount();
    const rundown = mockRundown([
      makeSection("wrapper", "Q2 Retainer", [], undefined, "wrap-1"),
      makeSection("wrapper-child", "L1 Sub A", [makeWeekItemRow()], "Q2 Retainer", "l1-a"),
    ]);
    render(
      <AccountTier
        account={account}
        rundown={rundown}
        readyToCloseIds={new Set()}
      />,
    );
    expect(screen.getByText("Q2 Retainer")).toBeTruthy();
    const tags = screen.getAllByTestId("wrapper-tag");
    expect(tags.length).toBeGreaterThan(0);
    expect(tags[0].textContent).toContain("WRAPPER");
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

  it("tags wrapper-child L1s with WRAPPER-CHILD label", () => {
    const account = mockAccount();
    const rundown = mockRundown([
      makeSection("wrapper", "Q2 Retainer", [], undefined, "wrap-1"),
      makeSection("wrapper-child", "L1 Sub A", [makeWeekItemRow()], "Q2 Retainer", "l1-a"),
    ]);
    render(
      <AccountTier
        account={account}
        rundown={rundown}
        readyToCloseIds={new Set()}
      />,
    );
    const tags = screen.getAllByTestId("l1-tag");
    expect(tags.some((t) => t.textContent?.includes("WRAPPER-CHILD"))).toBe(true);
  });

  it("tags standalone L1s with STANDALONE L1 label", () => {
    const account = mockAccount();
    const rundown = mockRundown([
      makeSection("standalone", "Solo L1", [makeWeekItemRow()], undefined, "l1-solo"),
    ]);
    render(
      <AccountTier
        account={account}
        rundown={rundown}
        readyToCloseIds={new Set()}
      />,
    );
    const tags = screen.getAllByTestId("l1-tag");
    expect(tags.some((t) => t.textContent?.includes("STANDALONE L1"))).toBe(
      true,
    );
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

  it("renders empty L1 with '(no scheduled L2s)' annotation and NO collapse details", () => {
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
    expect(screen.getByText(/no scheduled L2s/i)).toBeTruthy();
    // The empty L1 should NOT be wrapped in its own <details>; there will
    // still be the outer client <details> but no inner collapse section
    // for the empty L1.
    const allDetails = container.querySelectorAll("details");
    // 1 outer client details only; no inner L1 details for empty L1.
    expect(allDetails.length).toBe(1);
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

  it("threads dark theme down to L2MiniCard", () => {
    const account = mockAccount();
    const rundown = mockRundown([
      makeSection("standalone", "Solo L1", [makeWeekItemRow()], undefined, "l1-solo"),
    ]);
    render(
      <AccountTier
        account={account}
        rundown={rundown}
        readyToCloseIds={new Set()}
        theme="dark"
      />,
    );
    const card = screen.getByTestId("l2-mini-card");
    // Dark theme uses bg-slate-900/60 on the outer card.
    expect(card.className).toContain("slate-900");
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

    // Note: within() not strictly needed; using it here as a sanity smoke
    // for one wrapper's child containment.
    const wrapperAlphaText = within(container).getByText("Wrapper Alpha");
    expect(wrapperAlphaText).toBeTruthy();
  });
});
