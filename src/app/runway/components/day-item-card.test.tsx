import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DayItemCard } from "./day-item-card";
import type { DayItemEntry } from "../types";

function createEntry(overrides: Partial<DayItemEntry> = {}): DayItemEntry {
  return {
    title: "CDS Review",
    account: "Convergix",
    type: "review",
    ...overrides,
  };
}

describe("DayItemCard", () => {
  it("renders title, account, and type", () => {
    render(<DayItemCard item={createEntry()} />);
    expect(screen.getByText("CDS Review")).toBeInTheDocument();
    expect(screen.getByText("Convergix")).toBeInTheDocument();
    expect(screen.getByText("review")).toBeInTheDocument();
  });

  it("renders owner when present", () => {
    render(<DayItemCard item={createEntry({ owner: "Kathy" })} />);
    expect(screen.getByText("Kathy")).toBeInTheDocument();
  });

  it("does not render owner separator when owner absent", () => {
    const { container } = render(<DayItemCard item={createEntry()} />);
    const slashSpans = Array.from(container.querySelectorAll("span")).filter(
      (s) => s.textContent === "/"
    );
    expect(slashSpans).toHaveLength(0);
  });

  it("renders notes when present", () => {
    render(
      <DayItemCard item={createEntry({ notes: "Important note" })} />
    );
    expect(screen.getByText("Important note")).toBeInTheDocument();
  });

  it("does not render notes when absent", () => {
    render(<DayItemCard item={createEntry()} />);
    expect(screen.queryByText(/note/i)).not.toBeInTheDocument();
  });

  it("applies sm size styling by default", () => {
    const { container } = render(<DayItemCard item={createEntry()} />);
    const card = container.firstElementChild!;
    expect(card.className).toContain("rounded-lg");
    expect(card.className).toContain("border-border/50");
  });

  it("applies lg size styling when specified", () => {
    const { container } = render(
      <DayItemCard item={createEntry()} size="lg" />
    );
    const card = container.firstElementChild!;
    expect(card.className).toContain("rounded-xl");
    expect(card.className).toContain("border-sky-500/30");
  });

  it("applies type indicator color for delivery", () => {
    const { container } = render(
      <DayItemCard item={createEntry({ type: "delivery" })} />
    );
    const typeSpan = screen.getByText("delivery");
    expect(typeSpan.className).toContain("text-emerald-400");
  });

  it("applies type indicator color for deadline", () => {
    render(<DayItemCard item={createEntry({ type: "deadline" })} />);
    const typeSpan = screen.getByText("deadline");
    expect(typeSpan.className).toContain("text-amber-400");
  });

  it("falls back to muted color for unknown type", () => {
    render(
      <DayItemCard
        item={createEntry({ type: "unknown" as DayItemEntry["type"] })}
      />
    );
    const typeSpan = screen.getByText("unknown");
    expect(typeSpan.className).toContain("text-muted-foreground");
  });
});
