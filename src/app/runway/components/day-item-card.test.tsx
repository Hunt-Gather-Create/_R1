import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DayItemCard, getEffectiveType } from "./day-item-card";
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

  it("does not render owner when absent", () => {
    render(<DayItemCard item={createEntry()} />);
    expect(screen.queryByText("Kathy")).not.toBeInTheDocument();
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
    render(
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

  it("overrides type to blocked when notes contain 'Holds until'", () => {
    render(
      <DayItemCard
        item={createEntry({ type: "kickoff", notes: "Holds until SOW signed" })}
      />
    );
    expect(screen.getByText("blocked")).toBeInTheDocument();
    expect(screen.queryByText("kickoff")).not.toBeInTheDocument();
    const typeSpan = screen.getByText("blocked");
    expect(typeSpan.className).toContain("text-red-400");
  });

  it("overrides type to blocked when notes contain 'NOT STARTING until'", () => {
    render(
      <DayItemCard
        item={createEntry({ type: "kickoff", notes: "NOT STARTING until SOW signed. Launch 7/15." })}
      />
    );
    expect(screen.getByText("blocked")).toBeInTheDocument();
  });

  it("does not override type when notes have no hold language", () => {
    render(
      <DayItemCard
        item={createEntry({ type: "delivery", notes: "On track for Tuesday" })}
      />
    );
    expect(screen.getByText("delivery")).toBeInTheDocument();
    expect(screen.queryByText("blocked")).not.toBeInTheDocument();
  });

  it("renders blocked type directly without notes", () => {
    render(
      <DayItemCard item={createEntry({ type: "blocked" })} />
    );
    expect(screen.getByText("blocked")).toBeInTheDocument();
    const typeSpan = screen.getByText("blocked");
    expect(typeSpan.className).toContain("text-red-400");
  });
});

describe("getEffectiveType", () => {
  it("returns blocked for 'Holds until' in notes", () => {
    expect(getEffectiveType(createEntry({ type: "kickoff", notes: "Holds until SOW signed" }))).toBe("blocked");
  });

  it("returns blocked for 'hold until' (lowercase)", () => {
    expect(getEffectiveType(createEntry({ type: "delivery", notes: "On hold until client responds" }))).toBe("blocked");
  });

  it("returns blocked for 'on hold' in notes", () => {
    expect(getEffectiveType(createEntry({ type: "review", notes: "Project is on hold" }))).toBe("blocked");
  });

  it("returns blocked for 'blocked' in notes", () => {
    expect(getEffectiveType(createEntry({ type: "delivery", notes: "Blocked by copywriter" }))).toBe("blocked");
  });

  it("returns blocked for 'NOT STARTING until' in notes", () => {
    expect(getEffectiveType(createEntry({ type: "kickoff", notes: "NOT STARTING until SOW signed" }))).toBe("blocked");
  });

  it("returns original type when notes have no hold language", () => {
    expect(getEffectiveType(createEntry({ type: "delivery", notes: "Ready to ship" }))).toBe("delivery");
  });

  it("returns original type when no notes", () => {
    expect(getEffectiveType(createEntry({ type: "review" }))).toBe("review");
  });

  it("returns blocked when type is already blocked", () => {
    expect(getEffectiveType(createEntry({ type: "blocked" }))).toBe("blocked");
  });

  it("is case insensitive", () => {
    expect(getEffectiveType(createEntry({ type: "kickoff", notes: "HOLDS UNTIL approval" }))).toBe("blocked");
  });
});
