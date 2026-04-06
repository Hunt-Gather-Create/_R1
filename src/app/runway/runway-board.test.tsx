import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RunwayBoard, mergeWeekendDays } from "./runway-board";
import { thisWeek, upcoming, accounts, pipeline } from "./runway-board-test-fixtures";
import type { DayItem } from "./types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

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

describe("mergeWeekendDays", () => {
  it("merges adjacent Sat+Sun into a single Weekend column", () => {
    const days: DayItem[] = [
      { date: "2026-04-10", label: "Fri 4/10", items: [{ title: "Fri thing", account: "A", type: "delivery" }] },
      { date: "2026-04-11", label: "Sat 4/11", items: [{ title: "Sat thing", account: "B", type: "review" }] },
      { date: "2026-04-12", label: "Sun 4/12", items: [{ title: "Sun thing", account: "C", type: "kickoff" }] },
      { date: "2026-04-13", label: "Mon 4/13", items: [{ title: "Mon thing", account: "D", type: "delivery" }] },
    ];
    const result = mergeWeekendDays(days);
    expect(result).toHaveLength(3);
    expect(result[0].label).toBe("Fri 4/10");
    expect(result[1].label).toBe("Weekend");
    expect(result[1].items).toHaveLength(2);
    expect(result[1].items[0].title).toBe("Sat thing");
    expect(result[1].items[1].title).toBe("Sun thing");
    expect(result[2].label).toBe("Mon 4/13");
  });

  it("passes through Saturday alone (no Sunday follows)", () => {
    const days: DayItem[] = [
      { date: "2026-04-11", label: "Sat 4/11", items: [{ title: "Sat only", account: "A", type: "delivery" }] },
      { date: "2026-04-13", label: "Mon 4/13", items: [{ title: "Mon thing", account: "B", type: "delivery" }] },
    ];
    const result = mergeWeekendDays(days);
    expect(result).toHaveLength(2);
    expect(result[0].label).toBe("Sat 4/11");
  });

  it("passes through Sunday alone", () => {
    const days: DayItem[] = [
      { date: "2026-04-12", label: "Sun 4/12", items: [{ title: "Sun only", account: "A", type: "delivery" }] },
    ];
    const result = mergeWeekendDays(days);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Sun 4/12");
  });

  it("returns empty array for empty input", () => {
    expect(mergeWeekendDays([])).toEqual([]);
  });

  it("passes through weekdays unchanged", () => {
    const days: DayItem[] = [
      { date: "2026-04-06", label: "Mon 4/6", items: [] },
      { date: "2026-04-07", label: "Tue 4/7", items: [] },
    ];
    const result = mergeWeekendDays(days);
    expect(result).toHaveLength(2);
  });

  it("uses Saturday date for merged Weekend column", () => {
    const days: DayItem[] = [
      { date: "2026-04-11", label: "Sat 4/11", items: [{ title: "A", account: "X", type: "delivery" }] },
      { date: "2026-04-12", label: "Sun 4/12", items: [{ title: "B", account: "Y", type: "review" }] },
    ];
    const result = mergeWeekendDays(days);
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe("2026-04-11");
    expect(result[0].label).toBe("Weekend");
  });
});
