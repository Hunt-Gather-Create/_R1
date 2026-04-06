import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RunwayBoard } from "./runway-board";
import { thisWeek, upcoming, accounts, pipeline } from "./runway-board-test-fixtures";

const defaultProps = { thisWeek, upcoming, accounts, pipeline };

describe("RunwayBoard", () => {
  it("renders the header", () => {
    render(<RunwayBoard {...defaultProps} />);
    expect(screen.getByText("Civilization Runway")).toBeInTheDocument();
  });

  it("shows This Week view by default", () => {
    render(<RunwayBoard {...defaultProps} />);
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("Upcoming")).toBeInTheDocument();
  });

  it("switches to accounts view when tab is clicked", () => {
    render(<RunwayBoard {...defaultProps} />);
    fireEvent.click(screen.getByText("By Account"));
    expect(screen.getByText("Convergix")).toBeInTheDocument();
    expect(screen.getByText("CDS Messaging")).toBeInTheDocument();
  });

  it("switches to pipeline view when tab is clicked", () => {
    render(<RunwayBoard {...defaultProps} />);
    fireEvent.click(screen.getByText("Pipeline"));
    expect(screen.getByText("Unsigned SOWs & New Business")).toBeInTheDocument();
    expect(screen.getByText("New SOW")).toBeInTheDocument();
    expect(screen.getByText("$50,000+")).toBeInTheDocument();
  });

  it("renders upcoming day columns", () => {
    render(<RunwayBoard {...defaultProps} />);
    expect(screen.getByText("Future Item")).toBeInTheDocument();
  });

  it("renders all three tab buttons", () => {
    render(<RunwayBoard {...defaultProps} />);
    const buttons = screen.getAllByRole("button");
    const buttonLabels = buttons.map((b) => b.textContent);
    expect(buttonLabels).toContain("This Week");
    expect(buttonLabels).toContain("By Account");
    expect(buttonLabels).toContain("Pipeline");
  });

  it("switches back to triage view from another tab", () => {
    render(<RunwayBoard {...defaultProps} />);
    fireEvent.click(screen.getByText("Pipeline"));
    expect(screen.getByText("Unsigned SOWs & New Business")).toBeInTheDocument();

    fireEvent.click(screen.getByText("This Week"));
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("Upcoming")).toBeInTheDocument();
  });
});
