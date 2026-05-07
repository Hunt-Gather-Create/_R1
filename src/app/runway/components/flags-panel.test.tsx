import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FlagsPanel } from "./flags-panel";
import type { RunwayFlag } from "@/lib/runway/flags";

// ── Fixtures ─────────────────────────────────────────────────────────────

// Client Warnings section
const staleFlag: RunwayFlag = {
  id: "f1",
  type: "stale",
  severity: "critical",
  title: "Very Old Project",
  detail: "Convergix -- stale 45 days",
  relatedClient: "convergix",
};

// Resourcing Warnings section
const bottleneckFlag: RunwayFlag = {
  id: "f2",
  type: "bottleneck",
  severity: "warning",
  title: "Daniel has 4 items in their inbox",
  detail: "Across: Convergix, LPPC",
  relatedPerson: "Daniel",
};

// Delivery Flags section (info deadline). Title shape mirrors the
// production detector output ("Account: Item title"); the "tomorrow"
// signal lives in severity=info + detail, NOT the title.
const deadlineFlag: RunwayFlag = {
  id: "f3",
  type: "deadline",
  severity: "info",
  title: "LPPC: Quarterly Report",
  detail: "Due tomorrow",
};

// Delivery Flags section (today deadline). Title shape mirrors the
// production detector output ("Account: Item title"); the "today" signal
// lives in severity=warning + detail, NOT the title -- the prior fixture
// had "today" in the title, which masked the deliveryEmoji predicate bug
// fixed 2026-05-07.
const deadlineTodayFlag: RunwayFlag = {
  id: "f4",
  type: "deadline",
  severity: "warning",
  title: "Convergix: Status Report",
  detail: "Due today",
};

// ── Core panel tests ──────────────────────────────────────────────────────

describe("FlagsPanel", () => {
  it("renders nothing when flags array is empty", () => {
    const { container } = render(<FlagsPanel flags={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders flags count badge", () => {
    render(<FlagsPanel flags={[staleFlag, bottleneckFlag]} />);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders the Flags heading", () => {
    render(<FlagsPanel flags={[bottleneckFlag]} />);
    expect(screen.getByText("Flags")).toBeInTheDocument();
  });

  it("renders flag titles and details", () => {
    render(<FlagsPanel flags={[staleFlag]} />);
    expect(screen.getByText("Very Old Project")).toBeInTheDocument();
    expect(screen.getByText("Convergix -- stale 45 days")).toBeInTheDocument();
  });
});

// ── dashboard-cleanup item 2: 3-section reorg ─────────────────────────────

describe("FlagsPanel (item 2 section reorg)", () => {
  it("routes deadline flags into Delivery Flags section", () => {
    render(<FlagsPanel flags={[deadlineFlag]} />);
    expect(screen.getByTestId("flag-section-delivery")).toBeInTheDocument();
    expect(screen.getByText(/Delivery Flags \(1\)/)).toBeInTheDocument();
    expect(screen.queryByTestId("flag-section-client")).not.toBeInTheDocument();
    expect(screen.queryByTestId("flag-section-resourcing")).not.toBeInTheDocument();
  });

  it("routes past-end-l2 flags into Delivery Flags section", () => {
    const pastEnd: RunwayFlag = {
      id: "pe1",
      type: "past-end-l2",
      severity: "warning",
      title: "Past-due: LPPC Writeup",
      detail: "3 days overdue",
    };
    render(<FlagsPanel flags={[pastEnd]} />);
    expect(screen.getByTestId("flag-section-delivery")).toBeInTheDocument();
  });

  it("routes stale flags into Client Warnings section", () => {
    render(<FlagsPanel flags={[staleFlag]} />);
    expect(screen.getByTestId("flag-section-client")).toBeInTheDocument();
    expect(screen.getByText(/Client Warnings \(1\)/)).toBeInTheDocument();
    expect(screen.queryByTestId("flag-section-delivery")).not.toBeInTheDocument();
    expect(screen.queryByTestId("flag-section-resourcing")).not.toBeInTheDocument();
  });

  it("routes retainer-renewal flags into Client Warnings section", () => {
    const renewal: RunwayFlag = {
      id: "renewal-1",
      type: "retainer-renewal",
      severity: "warning",
      title: "Retainer renewal: Convergix / Retainer Wrapper",
      detail: "expires 2026-05-10 (15 days)",
      relatedClient: "convergix",
    };
    render(<FlagsPanel flags={[renewal]} />);
    expect(screen.getByTestId("flag-section-client")).toBeInTheDocument();
    expect(
      screen.getByText("Retainer renewal: Convergix / Retainer Wrapper"),
    ).toBeInTheDocument();
  });

  it("routes contract-expired flags into Client Warnings section", () => {
    const expired: RunwayFlag = {
      id: "expired-1",
      type: "contract-expired",
      severity: "warning",
      title: "Contract expired: High Desert Law",
      detail: "2 active L1s still in flight",
      relatedClient: "high-desert-law",
    };
    render(<FlagsPanel flags={[expired]} />);
    expect(screen.getByTestId("flag-section-client")).toBeInTheDocument();
    expect(screen.getByText("Contract expired: High Desert Law")).toBeInTheDocument();
  });

  it("routes resource-conflict into Resourcing Warnings section", () => {
    const conflict: RunwayFlag = {
      id: "rc1",
      type: "resource-conflict",
      severity: "warning",
      title: "Leslie overloaded: 4 deliverables in 10 days",
      detail: "Across 3 clients",
      relatedPerson: "Leslie",
    };
    render(<FlagsPanel flags={[conflict]} />);
    expect(screen.getByTestId("flag-section-resourcing")).toBeInTheDocument();
    expect(screen.getByText(/Resourcing Warnings \(1\)/)).toBeInTheDocument();
  });

  it("routes bottleneck flags into Resourcing Warnings section", () => {
    render(<FlagsPanel flags={[bottleneckFlag]} />);
    expect(screen.getByTestId("flag-section-resourcing")).toBeInTheDocument();
  });

  it("renders all 3 sections when each has a flag", () => {
    render(<FlagsPanel flags={[staleFlag, bottleneckFlag, deadlineFlag]} />);
    expect(screen.getByTestId("flag-section-delivery")).toBeInTheDocument();
    expect(screen.getByTestId("flag-section-client")).toBeInTheDocument();
    expect(screen.getByTestId("flag-section-resourcing")).toBeInTheDocument();
  });

  it("omits empty sections (no zombie headers)", () => {
    render(<FlagsPanel flags={[deadlineFlag]} />);
    expect(screen.queryByTestId("flag-section-client")).not.toBeInTheDocument();
    expect(screen.queryByTestId("flag-section-resourcing")).not.toBeInTheDocument();
  });

  it("sections appear in order: Delivery -> Client -> Resourcing", () => {
    render(<FlagsPanel flags={[bottleneckFlag, staleFlag, deadlineFlag]} />);
    const deliveryEl = screen.getByTestId("flag-section-delivery");
    const clientEl = screen.getByTestId("flag-section-client");
    const resourcingEl = screen.getByTestId("flag-section-resourcing");
    // compareDocumentPosition: DOCUMENT_POSITION_FOLLOWING = 4
    expect(deliveryEl.compareDocumentPosition(clientEl) & 4).toBeTruthy();
    expect(clientEl.compareDocumentPosition(resourcingEl) & 4).toBeTruthy();
  });

  it("deadline 'today' flags get fire emoji (🔥)", () => {
    render(<FlagsPanel flags={[deadlineTodayFlag]} />);
    expect(screen.getByText("🔥")).toBeInTheDocument();
  });

  it("deadline 'tomorrow/upcoming' flags get clock emoji (⏰)", () => {
    render(<FlagsPanel flags={[deadlineFlag]} />);
    expect(screen.getByText("⏰")).toBeInTheDocument();
  });

  it("multiple flags in one section show correct count", () => {
    const conflict: RunwayFlag = {
      id: "rc2",
      type: "resource-conflict",
      severity: "warning",
      title: "Kathy overloaded",
      detail: "3 clients",
      relatedPerson: "Kathy",
    };
    render(<FlagsPanel flags={[bottleneckFlag, conflict]} />);
    expect(screen.getByText(/Resourcing Warnings \(2\)/)).toBeInTheDocument();
  });
});
