import { describe, it, expect, afterEach } from "vitest";
import { vi } from "vitest";
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
    expect(screen.getByText("Resources: Kathy")).toBeInTheDocument();
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

/**
 * The header date must be the CHICAGO day, not the viewer's local day (issue #43).
 *
 * The pre-fix call site formatted with `toLocaleDateString` and no `timeZone`,
 * which silently uses whatever zone the runtime is in. On a Chicago-local
 * machine that is indistinguishable from correct, which is exactly why the
 * regression could sit here untested: the developer's own clock hides it.
 *
 * So this test forces a non-Chicago runtime zone and picks an instant where
 * the two zones disagree about the date. `process.env.TZ` is honored by V8 at
 * runtime, verified on this Node.
 */
describe("TodaySection header date, across a timezone boundary", () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
    vi.useRealTimers();
  });

  it("shows the Chicago day, not the viewer's local day", () => {
    // 02:30 UTC on Apr 6 is 21:30 on Apr 5 in Chicago (CDT, UTC-5).
    // The two zones disagree about which day it is.
    process.env.TZ = "UTC";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-06T02:30:00Z"));

    render(<TodaySection todayColumn={todayColumn} />);
    const section = screen.getByText("Today").closest("section")!;

    expect(section.textContent).toContain("Sunday, April 5, 2026");
    // The viewer-local rendering of the same instant. Asserted explicitly so
    // the test fails loudly if the call site ever drops its timeZone again.
    expect(section.textContent).not.toContain("Monday, April 6, 2026");
  });
});
