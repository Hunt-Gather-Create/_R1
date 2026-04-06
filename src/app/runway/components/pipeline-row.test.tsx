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

  it("renders no-sow status as Drafting", () => {
    render(<PipelineRow item={createItem({ status: "no-sow" })} />);
    expect(screen.getByText("Drafting")).toBeInTheDocument();
  });

  it("renders verbal status", () => {
    render(<PipelineRow item={createItem({ status: "verbal" })} />);
    expect(screen.getByText("Verbal")).toBeInTheDocument();
  });

  it("renders waitingOn with person name when present", () => {
    render(
      <PipelineRow item={createItem({ waitingOn: "Daniel" })} />
    );
    expect(screen.getByText("Waiting on: Daniel")).toBeInTheDocument();
  });

  it("falls back to 'Client' for sow-sent without waitingOn", () => {
    render(<PipelineRow item={createItem({ status: "sow-sent" })} />);
    expect(screen.getByText("Waiting on: Client")).toBeInTheDocument();
  });

  it("falls back to 'Client' for verbal without waitingOn", () => {
    render(<PipelineRow item={createItem({ status: "verbal" })} />);
    expect(screen.getByText("Waiting on: Client")).toBeInTheDocument();
  });

  it("does not show waiting on for drafting status without waitingOn", () => {
    render(<PipelineRow item={createItem({ status: "drafting", waitingOn: undefined })} />);
    expect(screen.queryByText(/Waiting on/)).not.toBeInTheDocument();
  });

  it("shows waitingOn for drafting when explicitly set", () => {
    render(<PipelineRow item={createItem({ status: "drafting", waitingOn: "Jill" })} />);
    expect(screen.getByText("Waiting on: Jill")).toBeInTheDocument();
  });

  it("renders notes with Next Steps label", () => {
    render(
      <PipelineRow item={createItem({ notes: "Follow up Monday" })} />
    );
    expect(screen.getByText("Next Steps: Follow up Monday")).toBeInTheDocument();
  });

  it("does not render notes when absent", () => {
    const { container } = render(<PipelineRow item={createItem()} />);
    expect(container.textContent).not.toContain("Next Steps");
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
    expect(screen.getByText("$50,000")).toBeInTheDocument();
    expect(screen.getByText("New SOW")).toBeInTheDocument();
    expect(screen.queryByText("SOW Sent")).not.toBeInTheDocument();
    expect(screen.queryByText("Drafting")).not.toBeInTheDocument();
    expect(screen.queryByText("Verbal")).not.toBeInTheDocument();
  });

  it("renders both waitingOn and notes together", () => {
    render(
      <PipelineRow
        item={createItem({ waitingOn: "Daniel", notes: "Follow up Monday" })}
      />
    );
    expect(screen.getByText("Waiting on: Daniel")).toBeInTheDocument();
    expect(screen.getByText("Next Steps: Follow up Monday")).toBeInTheDocument();
  });

  it("renders empty account gracefully", () => {
    render(<PipelineRow item={createItem({ account: "" })} />);
    expect(screen.getByText("New SOW")).toBeInTheDocument();
  });

  it("shows explicit waitingOn for no-sow status instead of fallback", () => {
    render(
      <PipelineRow item={createItem({ status: "no-sow", waitingOn: "Soundly to sign" })} />
    );
    expect(screen.getByText("Waiting on: Soundly to sign")).toBeInTheDocument();
    expect(screen.queryByText("Waiting on: Client")).not.toBeInTheDocument();
  });

  it("does not show waiting on fallback for no-sow without waitingOn", () => {
    render(
      <PipelineRow item={createItem({ status: "no-sow", waitingOn: undefined })} />
    );
    expect(screen.queryByText(/Waiting on/)).not.toBeInTheDocument();
  });
});
