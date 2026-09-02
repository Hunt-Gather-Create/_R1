/**
 * _R1#104 layer 1 — By Account hides accounts with no active project and
 * no pipeline item. Gantt Charts is untouched: it keeps reading the full,
 * unfiltered accounts array via its own filterActiveRundown pipeline.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RunwayBoard } from "./runway-board";
import { thisWeek, upcoming, pipeline as basePipeline } from "./runway-board-test-fixtures";
import type { Account, PipelineItem } from "./types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("./actions", () => ({
  toggleInFlightAction: vi.fn(async (next: boolean) => ({ inFlightToggle: next })),
  toggleNeedsUpdateAction: vi.fn(async (next: boolean) => ({ needsUpdateToggle: next })),
}));
vi.mock("./components/gantt-charts-section", () => ({
  GanttChartsSection: ({ accounts }: { accounts: { slug: string }[] }) => (
    <div data-testid="gantt-charts-section-stub" data-account-count={accounts.length} />
  ),
}));

// Mirrors the _R1#104 dispatch's named scenario:
//   Bonterra, Dave Asprey, Wilsonart, Merit — 0 active projects, 0 pipeline
//   Jenkins, NFM                            — 0 projects, 1 pipeline item each
//   Convergix                               — 1 active project, 0 pipeline
function account(
  slug: string,
  name: string,
  overrides: Partial<Account> & { hasNoOpenWork?: boolean } = {},
) {
  return {
    name,
    slug,
    contractStatus: "signed" as const,
    items: [],
    ...overrides,
  };
}

const scenarioAccounts = [
  account("bonterra", "Bonterra", { hasNoOpenWork: true }),
  account("dave-asprey", "Dave Asprey", { hasNoOpenWork: true }),
  account("wilsonart", "Wilsonart", { hasNoOpenWork: true }),
  account("merit", "Merit", { hasNoOpenWork: true }),
  account("jenkins", "Jenkins", { hasNoOpenWork: false }),
  account("nfm", "NFM", { hasNoOpenWork: false }),
  account("convergix", "Convergix", {
    hasNoOpenWork: false,
    items: [
      { id: "p1", title: "CDS Messaging", status: "in-production", category: "active" },
    ],
  }),
];

const scenarioPipeline: PipelineItem[] = [
  ...basePipeline,
  { account: "Jenkins", title: "Inbound Lead", value: "TBD", status: "scoping" },
  { account: "NFM", title: "Renewal Talks", value: "TBD", status: "verbal" },
];

const scenarioProps = {
  thisWeek,
  upcoming,
  accounts: scenarioAccounts,
  pipeline: scenarioPipeline,
  inFlightSource: [],
};

describe("RunwayBoard — By Account hides accounts with no open work (_R1#104)", () => {
  it("hides exactly the four no-active-project/no-pipeline accounts", () => {
    render(<RunwayBoard {...scenarioProps} />);
    fireEvent.click(screen.getByText("By Account"));

    for (const hidden of ["Bonterra", "Dave Asprey", "Wilsonart", "Merit"]) {
      expect(screen.queryByText(hidden)).not.toBeInTheDocument();
    }
  });

  it("keeps Jenkins and NFM visible — zero projects but one pipeline item each", () => {
    render(<RunwayBoard {...scenarioProps} />);
    fireEvent.click(screen.getByText("By Account"));

    expect(screen.getByText("Jenkins")).toBeInTheDocument();
    expect(screen.getByText("NFM")).toBeInTheDocument();
  });

  it("keeps an account with an active project visible", () => {
    render(<RunwayBoard {...scenarioProps} />);
    fireEvent.click(screen.getByText("By Account"));

    expect(screen.getByText("Convergix")).toBeInTheDocument();
  });

  it("shows the hidden count and reveals hidden accounts via the toggle, no silent disappearance", () => {
    render(<RunwayBoard {...scenarioProps} />);
    fireEvent.click(screen.getByText("By Account"));

    expect(screen.getByText("4 accounts hidden, no open work")).toBeInTheDocument();
    expect(screen.queryByText("Bonterra")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Show hidden accounts"));

    expect(screen.getByText("Bonterra")).toBeInTheDocument();
    expect(screen.getByText("Dave Asprey")).toBeInTheDocument();
    expect(screen.getByText("Wilsonart")).toBeInTheDocument();
    expect(screen.getByText("Merit")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Hide them again"));
    expect(screen.queryByText("Bonterra")).not.toBeInTheDocument();
  });

  it("Gantt Charts keeps the full unfiltered account count — its own filtering is untouched", () => {
    render(<RunwayBoard {...scenarioProps} />);
    fireEvent.click(screen.getByText("Gantt Charts"));

    const stub = screen.getByTestId("gantt-charts-section-stub");
    expect(Number(stub.getAttribute("data-account-count"))).toBe(scenarioAccounts.length);
  });

  it("does not show the hidden-count banner when nothing is hidden", () => {
    render(<RunwayBoard {...scenarioProps} accounts={[scenarioAccounts[6]]} />);
    fireEvent.click(screen.getByText("By Account"));

    expect(screen.queryByText(/accounts? hidden, no open work/)).not.toBeInTheDocument();
  });
});
