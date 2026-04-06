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

  it("calculates pipeline total correctly, skipping TBD", () => {
    const mixedPipeline = [
      { account: "A", title: "SOW 1", value: "$50,000", status: "sow-sent" as const },
      { account: "B", title: "SOW 2", value: "TBD", status: "drafting" as const },
      { account: "C", title: "SOW 3", value: "$25,000", status: "verbal" as const },
    ];
    render(<RunwayBoard {...defaultProps} pipeline={mixedPipeline} />);
    fireEvent.click(screen.getByText("Pipeline"));
    expect(screen.getByText("$75,000+")).toBeInTheDocument();
  });

  it("shows $0+ when all pipeline values are TBD", () => {
    const tbdPipeline = [
      { account: "A", title: "SOW 1", value: "TBD", status: "no-sow" as const },
    ];
    render(<RunwayBoard {...defaultProps} pipeline={tbdPipeline} />);
    fireEvent.click(screen.getByText("Pipeline"));
    expect(screen.getByText("$0+")).toBeInTheDocument();
  });

  it("handles pipeline values with non-numeric characters", () => {
    const oddPipeline = [
      { account: "A", title: "SOW 1", value: "$100,000", status: "sow-sent" as const },
      { account: "B", title: "SOW 2", value: "Approx $50K", status: "verbal" as const },
    ];
    render(<RunwayBoard {...defaultProps} pipeline={oddPipeline} />);
    fireEvent.click(screen.getByText("Pipeline"));
    // "Approx $50K" → parseInt on "50" after removing $ and , = NaN → treated as 0
    expect(screen.getByText("$100,000+")).toBeInTheDocument();
  });

  it("hides This Week section when restOfWeek is empty", () => {
    // Only today's items, no other days
    const todayOnly: typeof thisWeek = [
      {
        date: new Date().toISOString().split("T")[0],
        label: "Mon 4/6",
        items: [{ title: "Today Thing", account: "Test", type: "delivery" }],
      },
    ];
    const { container } = render(
      <RunwayBoard {...defaultProps} thisWeek={todayOnly} />
    );
    // "This Week" heading should not appear (only Today and Upcoming)
    const headings = Array.from(container.querySelectorAll("h2")).map(
      (h) => h.textContent
    );
    expect(headings).not.toContain("This Week");
  });

  it("applies active styling to selected tab", () => {
    render(<RunwayBoard {...defaultProps} />);
    const buttons = screen.getAllByRole("button");
    const thisWeekButton = buttons.find((b) => b.textContent === "This Week")!;
    expect(thisWeekButton.className).toContain("bg-foreground/10");
    const pipelineButton = buttons.find((b) => b.textContent === "Pipeline")!;
    expect(pipelineButton.className).not.toContain("bg-foreground/10");
  });

  it("renders empty pipeline view with no items", () => {
    render(<RunwayBoard {...defaultProps} pipeline={[]} />);
    fireEvent.click(screen.getByText("Pipeline"));
    expect(screen.getByText("$0+")).toBeInTheDocument();
  });

  it("renders empty accounts view with no accounts", () => {
    render(<RunwayBoard {...defaultProps} accounts={[]} />);
    fireEvent.click(screen.getByText("By Account"));
    // Should not crash, just render empty
    expect(screen.queryByText("Convergix")).not.toBeInTheDocument();
  });
});
