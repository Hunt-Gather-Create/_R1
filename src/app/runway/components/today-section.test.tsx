import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TodaySection } from "./today-section";
import type { DayItem } from "../types";

const todayColumn: DayItem = {
  date: "2026-04-06",
  label: "Mon 4/6",
  items: [
    { title: "CDS Review", account: "Convergix", type: "review" },
    {
      title: "LPPC Kickoff",
      account: "LPPC",
      owner: "Kathy",
      type: "kickoff",
      notes: "Copy ready",
    },
  ],
};

describe("TodaySection", () => {
  it("renders the Today heading", () => {
    render(<TodaySection todayColumn={todayColumn} />);
    expect(screen.getByText("Today")).toBeInTheDocument();
  });

  it("renders items from today column", () => {
    render(<TodaySection todayColumn={todayColumn} />);
    expect(screen.getByText("CDS Review")).toBeInTheDocument();
    expect(screen.getByText("LPPC Kickoff")).toBeInTheDocument();
  });

  it("renders item details (account, owner, notes)", () => {
    render(<TodaySection todayColumn={todayColumn} />);
    expect(screen.getByText("Convergix")).toBeInTheDocument();
    expect(screen.getByText("Kathy")).toBeInTheDocument();
    expect(screen.getByText("Copy ready")).toBeInTheDocument();
  });

  it("renders nothing when todayColumn is null", () => {
    render(<TodaySection todayColumn={null} />);
    // Heading should still render
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.queryByText("CDS Review")).not.toBeInTheDocument();
  });

  it("handles todayColumn with empty items array", () => {
    const emptyColumn: DayItem = { date: "2026-04-06", label: "Mon 4/6", items: [] };
    render(<TodaySection todayColumn={emptyColumn} />);
    expect(screen.getByText("Today")).toBeInTheDocument();
    const section = screen.getByText("Today").closest("section")!;
    expect(section.querySelectorAll(".grid")).toHaveLength(0);
  });

  it("renders the formatted date string", () => {
    render(<TodaySection todayColumn={todayColumn} />);
    const section = screen.getByText("Today").closest("section")!;
    expect(section.textContent).toMatch(
      /Today\w+,\s+\w+\s+\d+,\s+\d{4}/
    );
  });

  it("uses large card size for today items", () => {
    const { container } = render(
      <TodaySection todayColumn={todayColumn} />
    );
    const cards = container.querySelectorAll(".border-sky-500\\/30");
    expect(cards.length).toBeGreaterThan(0);
  });
});
