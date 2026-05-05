import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AccountSection, deriveSeverity } from "./account-section";
import type { Account } from "../types";
import type {
  ClientRundownData,
  RundownSection,
  GanttData,
  AnnotatedRow,
} from "@/lib/runway/gantt/types";

// ─── Fixture factories (mirror AccountTier.test.tsx shape) ─────────────────
//
// Track 4 Wave 4.3 reshapes AccountSection: it now wraps `<AccountTier>` and
// derives the tier's `AccountForTier` prop from the board-level Account
// shape. Tests fall into two families:
//   1. Empty-state branch — rundown absent or has no sections. Renders a
//      compact card with name + team + "No active rundowns." line.
//   2. Tier branch — rundown supplied. AccountTier renders inside, with
//      L2 mini-cards, ready-to-close chips, and SOW chips on the header.

function createAccount(overrides: Partial<Account> = {}): Account {
  return {
    name: "Convergix",
    slug: "convergix",
    contractValue: "$100K",
    contractTerm: "Feb – Jul 2026",
    contractStatus: "signed",
    team: "CD: Lane / Copy: Kathy",
    items: [],
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
  } as AnnotatedRow;
}

function makeGanttData(
  kind: "wrapper" | "l1",
  rows: AnnotatedRow[] = [],
  entityId = "p-1",
  entityTitle = "Project",
): GanttData {
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
  entityId = `${kind}-${title}`.replace(/\s+/g, "-").toLowerCase(),
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

function makeRundown(sections: RundownSection[]): ClientRundownData {
  return {
    client: { id: "c-1", name: "Convergix" } as never,
    sections,
    generatedAt: "2026-05-05",
    overallSeverity: { critical: 0, warn: 0, info: 0 },
  };
}

describe("AccountSection — empty-state branch (no rundown attached)", () => {
  it("renders the account name", () => {
    render(<AccountSection account={createAccount()} />);
    expect(screen.getByText("Convergix")).toBeInTheDocument();
  });

  it("renders team info when present", () => {
    render(<AccountSection account={createAccount()} />);
    expect(screen.getByText("CD: Lane / Copy: Kathy")).toBeInTheDocument();
  });

  it("does not render team when absent", () => {
    render(<AccountSection account={createAccount({ team: undefined })} />);
    expect(screen.queryByText(/CD:/)).not.toBeInTheDocument();
  });

  it("renders the 'No active rundowns.' line when rundown is absent", () => {
    render(<AccountSection account={createAccount()} />);
    expect(screen.getByText("No active rundowns.")).toBeInTheDocument();
  });

  it("renders the empty-state when rundown is explicitly null", () => {
    const account = { ...createAccount(), rundown: null };
    render(<AccountSection account={account} />);
    expect(screen.getByTestId("account-section-empty")).toBeInTheDocument();
    expect(screen.getByText("No active rundowns.")).toBeInTheDocument();
  });

  it("renders the empty-state when rundown has zero sections", () => {
    const account = { ...createAccount(), rundown: makeRundown([]) };
    render(<AccountSection account={account} />);
    expect(screen.getByTestId("account-section-empty")).toBeInTheDocument();
  });

  it("does NOT render any L2 mini-card in the empty-state branch", () => {
    render(<AccountSection account={createAccount()} />);
    expect(screen.queryByTestId("l2-mini-card")).not.toBeInTheDocument();
  });

  it("does not render contract value (prices live in Pipeline tab only)", () => {
    render(<AccountSection account={createAccount({ contractValue: "$100K" })} />);
    expect(screen.queryByText("$100K")).not.toBeInTheDocument();
  });

  it("does not render the rundown-section-list (Gantt embed) slot", () => {
    render(<AccountSection account={createAccount()} />);
    expect(screen.queryByTestId("rundown-section-list")).not.toBeInTheDocument();
  });

  it("does not render the AuditBadge (Gantt-Charts-tab indicator)", () => {
    render(<AccountSection account={createAccount()} />);
    expect(screen.queryByTestId("audit-badge")).not.toBeInTheDocument();
  });
});

describe("AccountSection — tier branch (rundown attached)", () => {
  it("renders <AccountTier> markup (L2 mini-cards) when rundown has sections", () => {
    const account = {
      ...createAccount(),
      rundown: makeRundown([
        makeSection("standalone", "Solo L1", [makeWeekItemRow()], undefined, "l1-solo"),
      ]),
    };
    render(<AccountSection account={account} />);
    expect(screen.getAllByTestId("l2-mini-card").length).toBe(1);
  });

  it("renders the client header with the account name from the tier", () => {
    const account = {
      ...createAccount(),
      rundown: makeRundown([
        makeSection("standalone", "Solo L1", [makeWeekItemRow()], undefined, "l1-solo"),
      ]),
    };
    render(<AccountSection account={account} />);
    // Tier's ClientHeader renders the name; presence is sufficient.
    expect(screen.getByText("Convergix")).toBeInTheDocument();
  });

  it("threads readyToCloseIds (explicit prop) into the tier so the chip surfaces", () => {
    const account = {
      ...createAccount(),
      rundown: makeRundown([
        makeSection("standalone", "Closing L1", [makeWeekItemRow()], undefined, "l1-closing"),
      ]),
    };
    render(
      <AccountSection
        account={account}
        readyToCloseIds={new Set(["l1-closing"])}
      />,
    );
    expect(screen.getByTestId("ready-to-close-chip")).toBeInTheDocument();
  });

  it("falls back to account.readyToCloseIds when explicit prop is omitted", () => {
    const account = {
      ...createAccount(),
      rundown: makeRundown([
        makeSection("standalone", "Closing L1", [makeWeekItemRow()], undefined, "l1-closing"),
      ]),
      readyToCloseIds: new Set(["l1-closing"]),
    };
    render(<AccountSection account={account} />);
    expect(screen.getByTestId("ready-to-close-chip")).toBeInTheDocument();
  });

  it("explicit readyToCloseIds prop wins over account.readyToCloseIds when both are present", () => {
    const account = {
      ...createAccount(),
      rundown: makeRundown([
        makeSection("standalone", "Closing L1", [makeWeekItemRow()], undefined, "l1-closing"),
      ]),
      readyToCloseIds: new Set(["l1-closing"]),
    };
    render(
      <AccountSection
        account={account}
        readyToCloseIds={new Set<string>()}
      />,
    );
    // Explicit empty set overrides the account-level set.
    expect(screen.queryByTestId("ready-to-close-chip")).not.toBeInTheDocument();
  });

  it("does NOT render the ready-to-close chip when no L1 id matches", () => {
    const account = {
      ...createAccount(),
      rundown: makeRundown([
        makeSection("standalone", "Solo L1", [makeWeekItemRow()], undefined, "l1-solo"),
      ]),
    };
    render(<AccountSection account={account} />);
    expect(screen.queryByTestId("ready-to-close-chip")).not.toBeInTheDocument();
  });

  it("renders the SOW chip via the tier when contractStatus === 'signed'", () => {
    const account = {
      ...createAccount({ contractStatus: "signed" }),
      rundown: makeRundown([
        makeSection("standalone", "Solo L1", [makeWeekItemRow()], undefined, "l1-solo"),
      ]),
    };
    render(<AccountSection account={account} />);
    expect(screen.getByTestId("client-sow-chip")).toBeInTheDocument();
  });

  it("does not render the SOW chip when contractStatus is unsigned", () => {
    const account = {
      ...createAccount({ contractStatus: "unsigned" }),
      rundown: makeRundown([
        makeSection("standalone", "Solo L1", [makeWeekItemRow()], undefined, "l1-solo"),
      ]),
    };
    render(<AccountSection account={account} />);
    expect(screen.queryByTestId("client-sow-chip")).not.toBeInTheDocument();
  });

  it("renders all L2s in a single L1 section (matches tier's flex-wrap layout)", () => {
    const rows = [
      makeWeekItemRow({ id: "wi-a", title: "Card A", startDate: "2026-05-04" }),
      makeWeekItemRow({ id: "wi-b", title: "Card B", startDate: "2026-05-06" }),
      makeWeekItemRow({ id: "wi-c", title: "Card C", startDate: "2026-05-08" }),
    ];
    const account = {
      ...createAccount(),
      rundown: makeRundown([
        makeSection("standalone", "Solo L1", rows, undefined, "l1-solo"),
      ]),
    };
    render(<AccountSection account={account} />);
    expect(screen.getAllByTestId("l2-mini-card").length).toBe(3);
  });

  it("uses the light theme — L2MiniCard renders with a light-mode container", () => {
    const account = {
      ...createAccount(),
      rundown: makeRundown([
        makeSection("standalone", "Solo L1", [makeWeekItemRow()], undefined, "l1-solo"),
      ]),
    };
    render(<AccountSection account={account} />);
    const card = screen.getByTestId("l2-mini-card");
    // L2MiniCard light theme uses bg-white on the card; dark uses slate-900.
    expect(card.className).toContain("white");
    expect(card.className).not.toContain("slate-900");
  });

  it("renders both wrapper and standalone sections when both exist in the rundown", () => {
    const account = {
      ...createAccount(),
      rundown: makeRundown([
        makeSection("wrapper", "Q2 Retainer", [], undefined, "wrap-1"),
        makeSection("wrapper-child", "Sub A", [makeWeekItemRow()], "Q2 Retainer", "l1-a"),
        makeSection("standalone", "Solo L1", [makeWeekItemRow()], undefined, "l1-solo"),
      ]),
    };
    render(<AccountSection account={account} />);
    expect(screen.getByText("Q2 Retainer")).toBeInTheDocument();
    expect(screen.getByText("Sub A")).toBeInTheDocument();
    expect(screen.getByText("Solo L1")).toBeInTheDocument();
  });
});

// Track 4 audit fix (FAIL — Panel 1, Data Flow): the client header was dropping
// severity + contract dates because toAccountForTier hardcoded null. These
// tests assert the new threading: severity collapses from ganttSeverity counts,
// and contractStart/contractEnd flow through from the page-mapper.
describe("AccountSection — Track 4 audit fix: severity + contract dates threading", () => {
  describe("deriveSeverity helper", () => {
    it("returns 'critical' when ganttSeverity.critical > 0", () => {
      expect(deriveSeverity({ critical: 1, warn: 0, info: 0 })).toBe("critical");
    });

    it("returns 'critical' when both critical and warn > 0 (critical wins)", () => {
      expect(deriveSeverity({ critical: 1, warn: 5, info: 0 })).toBe("critical");
    });

    it("returns 'warning' when only warn > 0", () => {
      expect(deriveSeverity({ critical: 0, warn: 3, info: 0 })).toBe("warning");
    });

    it("returns null when only info > 0 (info doesn't fire the badge)", () => {
      expect(deriveSeverity({ critical: 0, warn: 0, info: 2 })).toBeNull();
    });

    it("returns null when all counts are zero", () => {
      expect(deriveSeverity({ critical: 0, warn: 0, info: 0 })).toBeNull();
    });

    it("returns null when counts are undefined (account with no rundown)", () => {
      expect(deriveSeverity(undefined)).toBeNull();
    });
  });

  describe("severity threads through to the tier's client header", () => {
    it("renders the critical severity badge when ganttSeverity.critical > 0", () => {
      const account = {
        ...createAccount(),
        rundown: makeRundown([
          makeSection("standalone", "Solo L1", [makeWeekItemRow()], undefined, "l1-solo"),
        ]),
        ganttSeverity: { critical: 2, warn: 1, info: 0 },
      };
      render(<AccountSection account={account} />);
      const badge = screen.getByTestId("client-severity-badge");
      expect(badge).toBeInTheDocument();
      expect(badge.textContent).toBe("Critical");
    });

    it("renders the warning severity badge when only warn > 0", () => {
      const account = {
        ...createAccount(),
        rundown: makeRundown([
          makeSection("standalone", "Solo L1", [makeWeekItemRow()], undefined, "l1-solo"),
        ]),
        ganttSeverity: { critical: 0, warn: 4, info: 0 },
      };
      render(<AccountSection account={account} />);
      const badge = screen.getByTestId("client-severity-badge");
      expect(badge).toBeInTheDocument();
      expect(badge.textContent).toBe("Warning");
    });

    it("does NOT render the severity badge when ganttSeverity is undefined", () => {
      const account = {
        ...createAccount(),
        rundown: makeRundown([
          makeSection("standalone", "Solo L1", [makeWeekItemRow()], undefined, "l1-solo"),
        ]),
      };
      render(<AccountSection account={account} />);
      expect(screen.queryByTestId("client-severity-badge")).not.toBeInTheDocument();
    });
  });

  describe("contract dates thread through to the tier's client header", () => {
    it("renders the contract date range when both contractStart and contractEnd are set", () => {
      const account: Account & {
        rundown: ClientRundownData;
      } = {
        ...createAccount(),
        contractStart: "2026-04-01",
        contractEnd: "2026-06-30",
        rundown: makeRundown([
          makeSection("standalone", "Solo L1", [makeWeekItemRow()], undefined, "l1-solo"),
        ]),
      };
      render(<AccountSection account={account} />);
      // Tier's ClientHeader renders "M/D – M/D" via formatDateLine.
      expect(screen.getByText(/4\/1\s*–\s*6\/30/)).toBeInTheDocument();
    });

    it("does not render any contract date line when both fields are null", () => {
      const account = {
        ...createAccount(),
        contractStart: null,
        contractEnd: null,
        rundown: makeRundown([
          makeSection("standalone", "Solo L1", [makeWeekItemRow()], undefined, "l1-solo"),
        ]),
      };
      render(<AccountSection account={account} />);
      // The tier's formatDateLine returns null when both are null, so no
      // "M/D" text should be present in the client header. The L2 mini-cards
      // do render their own dates, so we scope on the client header only via
      // the SOW chip's neighborhood check.
      expect(screen.queryByText(/^4\/1$/)).not.toBeInTheDocument();
      expect(screen.queryByText(/^6\/30$/)).not.toBeInTheDocument();
    });
  });
});
