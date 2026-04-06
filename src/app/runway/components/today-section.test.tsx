import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TodaySection } from "./today-section";
import type { DayItem } from "../types";

// Use a fixed "today" string to control matching
const TODAY_STR = new Date("2026-04-06T12:00:00").toDateString();

const thisWeek: DayItem[] = [
  {
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
  },
  {
    date: "2026-04-07",
    label: "Tue 4/7",
    items: [
      { title: "Tomorrow Item", account: "Test", type: "delivery" },
    ],
  },
];

describe("TodaySection", () => {
  it("renders the Today heading", () => {
    render(<TodaySection thisWeek={thisWeek} todayStr={TODAY_STR} />);
    expect(screen.getByText("Today")).toBeInTheDocument();
  });

  it("renders items matching today's date", () => {
    render(<TodaySection thisWeek={thisWeek} todayStr={TODAY_STR} />);
    expect(screen.getByText("CDS Review")).toBeInTheDocument();
    expect(screen.getByText("LPPC Kickoff")).toBeInTheDocument();
  });

  it("does not render items from other days", () => {
    render(<TodaySection thisWeek={thisWeek} todayStr={TODAY_STR} />);
    expect(screen.queryByText("Tomorrow Item")).not.toBeInTheDocument();
  });

  it("renders item details (account, owner, notes)", () => {
    render(<TodaySection thisWeek={thisWeek} todayStr={TODAY_STR} />);
    expect(screen.getByText("Convergix")).toBeInTheDocument();
    expect(screen.getByText("Kathy")).toBeInTheDocument();
    expect(screen.getByText("Copy ready")).toBeInTheDocument();
  });

  it("renders nothing when no items match today", () => {
    const futureStr = new Date("2030-01-01T12:00:00").toDateString();
    const { container } = render(
      <TodaySection thisWeek={thisWeek} todayStr={futureStr} />
    );
    // Heading should still render
    expect(screen.getByText("Today")).toBeInTheDocument();
    // But no items
    expect(screen.queryByText("CDS Review")).not.toBeInTheDocument();
    expect(screen.queryByText("Tomorrow Item")).not.toBeInTheDocument();
  });

  it("handles empty thisWeek array", () => {
    render(<TodaySection thisWeek={[]} todayStr={TODAY_STR} />);
    expect(screen.getByText("Today")).toBeInTheDocument();
  });

  it("renders the formatted date string", () => {
    render(<TodaySection thisWeek={thisWeek} todayStr={TODAY_STR} />);
    // The component formats "today" using toLocaleDateString — we can verify
    // it renders some date text (weekday, month, day, year)
    const section = screen.getByText("Today").closest("section")!;
    // textContent concatenates without spaces, so match without \s+
    expect(section.textContent).toMatch(
      /Today\w+,\s+\w+\s+\d+,\s+\d{4}/
    );
  });

  it("uses large card size for today items", () => {
    const { container } = render(
      <TodaySection thisWeek={thisWeek} todayStr={TODAY_STR} />
    );
    // Today items use "lg" size which has sky-500 border
    const cards = container.querySelectorAll(".border-sky-500\\/30");
    expect(cards.length).toBeGreaterThan(0);
  });
});
