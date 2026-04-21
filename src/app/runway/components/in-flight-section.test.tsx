import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InFlightSection } from "./in-flight-section";
import type { DayItem, DayItemEntry } from "../types";

function makeEntry(overrides: Partial<DayItemEntry> = {}): DayItemEntry {
  return {
    title: "Test",
    account: "Convergix",
    type: "delivery",
    ...overrides,
  };
}

function makeDay(items: DayItemEntry[]): DayItem {
  return { date: "2026-04-20", label: "Mon 4/20", items };
}

describe("InFlightSection", () => {
  it("renders items in-progress whose today falls in their start/end window", () => {
    const day = makeDay([
      makeEntry({
        title: "Active Retainer Work",
        status: "in-progress",
        startDate: "2026-04-10",
        endDate: "2026-04-30",
      }),
    ]);

    render(<InFlightSection weekItems={[day]} enabled nowISO="2026-04-20" />);

    expect(screen.getByTestId("in-flight-section")).toBeInTheDocument();
    expect(screen.getByText("Active Retainer Work")).toBeInTheDocument();
    expect(screen.getByText("In Flight")).toBeInTheDocument();
  });

  it("returns null when disabled", () => {
    const day = makeDay([
      makeEntry({
        status: "in-progress",
        startDate: "2026-04-10",
        endDate: "2026-04-30",
      }),
    ]);

    const { container } = render(
      <InFlightSection weekItems={[day]} enabled={false} nowISO="2026-04-20" />
    );
    expect(container.firstChild).toBeNull();
  });

  it("returns null when no items match the in-flight filter", () => {
    const day = makeDay([
      makeEntry({
        status: "completed",
        startDate: "2026-04-10",
        endDate: "2026-04-30",
      }),
    ]);
    const { container } = render(
      <InFlightSection weekItems={[day]} enabled nowISO="2026-04-20" />
    );
    expect(container.firstChild).toBeNull();
  });

  it("filters out items whose window does not include today", () => {
    const day = makeDay([
      makeEntry({
        title: "Future Item",
        status: "in-progress",
        startDate: "2026-05-01",
        endDate: "2026-05-10",
      }),
      makeEntry({
        title: "Active Now",
        status: "in-progress",
        startDate: "2026-04-15",
        endDate: "2026-04-25",
      }),
    ]);

    render(<InFlightSection weekItems={[day]} enabled nowISO="2026-04-20" />);
    expect(screen.getByText("Active Now")).toBeInTheDocument();
    expect(screen.queryByText("Future Item")).not.toBeInTheDocument();
  });

  it("renders count badge reflecting matched items", () => {
    const day = makeDay([
      makeEntry({
        title: "A",
        status: "in-progress",
        startDate: "2026-04-10",
        endDate: "2026-04-30",
      }),
      makeEntry({
        title: "B",
        status: "in-progress",
        startDate: "2026-04-10",
        endDate: "2026-04-30",
      }),
    ]);

    render(<InFlightSection weekItems={[day]} enabled nowISO="2026-04-20" />);
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});
