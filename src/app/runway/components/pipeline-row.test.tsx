import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PipelineRow } from "./pipeline-row";
import type { PipelineItem } from "../types";

function createItem(overrides: Partial<PipelineItem> = {}): PipelineItem {
  return {
    account: "Convergix",
    title: "New SOW",
    value: "$50,000",
    status: "sow-sent",
    ...overrides,
  };
}

describe("PipelineRow", () => {
  it("renders account, title, and value", () => {
    render(<PipelineRow item={createItem()} />);
    expect(screen.getByText("Convergix")).toBeInTheDocument();
    expect(screen.getByText("New SOW")).toBeInTheDocument();
    expect(screen.getByText("$50,000")).toBeInTheDocument();
  });

  it("renders status badge with correct label", () => {
    render(<PipelineRow item={createItem({ status: "sow-sent" })} />);
    expect(screen.getByText("SOW Sent")).toBeInTheDocument();
  });

  it("renders drafting status", () => {
    render(<PipelineRow item={createItem({ status: "drafting" })} />);
    expect(screen.getByText("Drafting")).toBeInTheDocument();
  });

  it("renders no-sow status", () => {
    render(<PipelineRow item={createItem({ status: "no-sow" })} />);
    expect(screen.getByText("No SOW")).toBeInTheDocument();
  });

  it("renders verbal status", () => {
    render(<PipelineRow item={createItem({ status: "verbal" })} />);
    expect(screen.getByText("Verbal")).toBeInTheDocument();
  });

  it("renders waitingOn when present", () => {
    render(
      <PipelineRow item={createItem({ waitingOn: "Daniel" })} />
    );
    expect(screen.getByText("Waiting on: Daniel")).toBeInTheDocument();
  });

  it("does not render waitingOn when absent", () => {
    render(<PipelineRow item={createItem()} />);
    expect(screen.queryByText(/Waiting on/)).not.toBeInTheDocument();
  });

  it("renders notes when present", () => {
    render(
      <PipelineRow item={createItem({ notes: "Work active" })} />
    );
    expect(screen.getByText("Work active")).toBeInTheDocument();
  });

  it("does not render notes when absent", () => {
    const { container } = render(<PipelineRow item={createItem()} />);
    // Only account, title, status badge, and value should render
    const textContent = container.textContent!;
    expect(textContent).toContain("Convergix");
    expect(textContent).toContain("New SOW");
    expect(textContent).toContain("$50,000");
  });

  it("applies correct color class for sow-sent badge", () => {
    render(
      <PipelineRow item={createItem({ status: "sow-sent" })} />
    );
    const badge = screen.getByText("SOW Sent");
    expect(badge.className).toContain("bg-amber-500/20");
    expect(badge.className).toContain("text-amber-400");
  });

  it("applies correct color class for verbal badge", () => {
    render(<PipelineRow item={createItem({ status: "verbal" })} />);
    const badge = screen.getByText("Verbal");
    expect(badge.className).toContain("bg-emerald-500/20");
  });

  it("renders TBD value correctly", () => {
    render(<PipelineRow item={createItem({ value: "TBD" })} />);
    expect(screen.getByText("TBD")).toBeInTheDocument();
  });

  it("renders no badge for unknown status", () => {
    render(
      <PipelineRow
        item={createItem({ status: "unknown" as PipelineItem["status"] })}
      />
    );
    // Value and title still render
    expect(screen.getByText("$50,000")).toBeInTheDocument();
    expect(screen.getByText("New SOW")).toBeInTheDocument();
    // No badge text from known statuses
    expect(screen.queryByText("SOW Sent")).not.toBeInTheDocument();
    expect(screen.queryByText("Drafting")).not.toBeInTheDocument();
    expect(screen.queryByText("No SOW")).not.toBeInTheDocument();
    expect(screen.queryByText("Verbal")).not.toBeInTheDocument();
  });

  it("renders both waitingOn and notes together", () => {
    render(
      <PipelineRow
        item={createItem({ waitingOn: "Daniel", notes: "Follow up Monday" })}
      />
    );
    expect(screen.getByText("Waiting on: Daniel")).toBeInTheDocument();
    expect(screen.getByText("Follow up Monday")).toBeInTheDocument();
  });

  it("renders empty account gracefully", () => {
    render(<PipelineRow item={createItem({ account: "" })} />);
    // Title still visible, separator still renders
    expect(screen.getByText("New SOW")).toBeInTheDocument();
  });
});
