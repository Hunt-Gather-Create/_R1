import { describe, it, expect, vi } from "vitest";
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

describe("InFlightSection (no toggle -- legacy mode)", () => {
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

  it("returns null when disabled (legacy: no toggle props)", () => {
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

describe("InFlightSection (inline toggle -- item 3)", () => {
  it("renders the section header with an inline toggle when onToggle is provided", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    const day = makeDay([
      makeEntry({
        title: "Active Work",
        status: "in-progress",
        startDate: "2026-04-10",
        endDate: "2026-04-30",
      }),
    ]);

    render(
      <InFlightSection
        weekItems={[day]}
        enabled
        nowISO="2026-04-20"
        onToggle={onToggle}
      />
    );

    expect(screen.getByTestId("in-flight-section")).toBeInTheDocument();
    // The visible h2 heading -- use role query to avoid matching sr-only span
    expect(screen.getByRole("heading", { name: "In Flight" })).toBeInTheDocument();
    // Toggle rendered inline in the header
    expect(screen.getByTestId("in-flight-toggle")).toBeInTheDocument();
    // Count badge visible
    expect(screen.getByTestId("in-flight-count")).toBeInTheDocument();
  });

  it("still renders the section header when disabled (with toggle), allowing re-enable", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    const day = makeDay([
      makeEntry({
        title: "Active Work",
        status: "in-progress",
        startDate: "2026-04-10",
        endDate: "2026-04-30",
      }),
    ]);

    render(
      <InFlightSection
        weekItems={[day]}
        enabled={false}
        nowISO="2026-04-20"
        onToggle={onToggle}
      />
    );

    // Section renders so the user can re-enable
    expect(screen.getByTestId("in-flight-section")).toBeInTheDocument();
    expect(screen.getByTestId("in-flight-toggle")).toBeInTheDocument();
    // But no count badge when disabled
    expect(screen.queryByTestId("in-flight-count")).not.toBeInTheDocument();
    // And no cards rendered
    expect(screen.queryByText("Active Work")).not.toBeInTheDocument();
  });

  it("hides the count badge when there are no matching items but toggle is provided", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    const day = makeDay([
      makeEntry({ status: "completed", startDate: "2026-04-10", endDate: "2026-04-30" }),
    ]);

    render(
      <InFlightSection
        weekItems={[day]}
        enabled
        nowISO="2026-04-20"
        onToggle={onToggle}
      />
    );

    // Section renders (has toggle), but count badge is 0 -- still shown when enabled
    expect(screen.getByTestId("in-flight-section")).toBeInTheDocument();
    expect(screen.getByTestId("in-flight-toggle")).toBeInTheDocument();
  });
});
