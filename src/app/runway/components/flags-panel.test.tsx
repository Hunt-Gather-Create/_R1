import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FlagsPanel } from "./flags-panel";
import type { RunwayFlag } from "@/lib/runway/flags";

const criticalFlag: RunwayFlag = {
  id: "f1",
  type: "stale",
  severity: "critical",
  title: "Very Old Project",
  detail: "Convergix -- stale 45 days",
  relatedClient: "convergix",
};

const warningFlag: RunwayFlag = {
  id: "f2",
  type: "bottleneck",
  severity: "warning",
  title: "Daniel has 4 items in their inbox",
  detail: "Across: Convergix, LPPC",
  relatedPerson: "Daniel",
};

const infoFlag: RunwayFlag = {
  id: "f3",
  type: "deadline",
  severity: "info",
  title: "LPPC: Report Due",
  detail: "Due tomorrow",
};

describe("FlagsPanel", () => {
  it("renders nothing when flags array is empty", () => {
    const { container } = render(<FlagsPanel flags={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders flags count badge", () => {
    render(<FlagsPanel flags={[criticalFlag, warningFlag]} />);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders the Flags heading", () => {
    render(<FlagsPanel flags={[warningFlag]} />);
    expect(screen.getByText("Flags")).toBeInTheDocument();
  });

  it("groups flags by severity with labels", () => {
    render(<FlagsPanel flags={[criticalFlag, warningFlag, infoFlag]} />);
    expect(screen.getByText("Critical (1)")).toBeInTheDocument();
    expect(screen.getByText("Warning (1)")).toBeInTheDocument();
    expect(screen.getByText("Info (1)")).toBeInTheDocument();
  });

  it("renders flag titles and details", () => {
    render(<FlagsPanel flags={[criticalFlag]} />);
    expect(screen.getByText("Very Old Project")).toBeInTheDocument();
    expect(screen.getByText("Convergix -- stale 45 days")).toBeInTheDocument();
  });

  it("shows multiple flags in the same severity group", () => {
    const anotherWarning: RunwayFlag = {
      id: "f4",
      type: "resource-conflict",
      severity: "warning",
      title: "Leslie overloaded",
      detail: "3 clients in 10 days",
    };
    render(<FlagsPanel flags={[warningFlag, anotherWarning]} />);
    expect(screen.getByText("Warning (2)")).toBeInTheDocument();
    expect(screen.getByText("Daniel has 4 items in their inbox")).toBeInTheDocument();
    expect(screen.getByText("Leslie overloaded")).toBeInTheDocument();
  });

  it("omits severity sections with no flags", () => {
    render(<FlagsPanel flags={[infoFlag]} />);
    expect(screen.queryByText(/Critical/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Warning/)).not.toBeInTheDocument();
    expect(screen.getByText("Info (1)")).toBeInTheDocument();
  });

  it("renders retainer-renewal flags in the warning group", () => {
    const renewal: RunwayFlag = {
      id: "renewal-1",
      type: "retainer-renewal",
      severity: "warning",
      title: "Retainer renewal: Convergix / Retainer Wrapper",
      detail: "expires 2026-05-10 (15 days)",
      relatedClient: "convergix",
    };
    render(<FlagsPanel flags={[renewal]} />);
    expect(screen.getByText("Warning (1)")).toBeInTheDocument();
    expect(
      screen.getByText("Retainer renewal: Convergix / Retainer Wrapper"),
    ).toBeInTheDocument();
    expect(screen.getByText("expires 2026-05-10 (15 days)")).toBeInTheDocument();
  });

  it("renders contract-expired flags in the warning group", () => {
    const expired: RunwayFlag = {
      id: "expired-1",
      type: "contract-expired",
      severity: "warning",
      title: "Contract expired: High Desert Law",
      detail: "2 active L1s still in flight",
      relatedClient: "high-desert-law",
    };
    render(<FlagsPanel flags={[expired]} />);
    expect(screen.getByText("Warning (1)")).toBeInTheDocument();
    expect(
      screen.getByText("Contract expired: High Desert Law"),
    ).toBeInTheDocument();
  });
});
