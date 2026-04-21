import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DayItemCard, getEffectiveType, parseNotes } from "./day-item-card";
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

  it("renders owner as resources when no resources field", () => {
    render(<DayItemCard item={createEntry({ owner: "Kathy" })} />);
    expect(screen.getByText("Resources: Kathy")).toBeInTheDocument();
  });

  it("does not render resources or owner when both absent", () => {
    render(<DayItemCard item={createEntry()} />);
    expect(screen.queryByText(/Resources:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Owner:/)).not.toBeInTheDocument();
  });

  it("shows resources prominently and owner muted when they differ", () => {
    render(
      <DayItemCard
        item={createEntry({ owner: "Kathy", resources: "Kathy + Lane" })}
      />
    );
    expect(screen.getByText("Resources: Kathy + Lane")).toBeInTheDocument();
    expect(screen.getByText("Owner: Kathy")).toBeInTheDocument();
  });

  it("shows only resources when resources equals owner", () => {
    render(
      <DayItemCard
        item={createEntry({ owner: "Kathy", resources: "Kathy" })}
      />
    );
    expect(screen.getByText("Resources: Kathy")).toBeInTheDocument();
    expect(screen.queryByText("Owner: Kathy")).not.toBeInTheDocument();
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

  // v4 chunk 3 #3: past-end red note on in-progress L2s that slipped
  it("renders past-end inline note for in-progress item past its end_date", () => {
    // Compute relative dates so the test is not bound to a wall-clock year.
    const past = new Date();
    past.setUTCDate(past.getUTCDate() - 5);
    const pastISO = past.toISOString().slice(0, 10);

    render(
      <DayItemCard
        item={createEntry({
          status: "in-progress",
          endDate: pastISO,
          startDate: pastISO,
          updatedAtMs: past.getTime(),
        })}
      />
    );
    const note = screen.getByTestId("past-end-note");
    expect(note).toHaveTextContent(/status unchanged past end_date/);
    expect(note).toHaveTextContent(/days ago/);
  });

  it("does not render past-end note for completed items", () => {
    const past = new Date();
    past.setUTCDate(past.getUTCDate() - 5);
    const pastISO = past.toISOString().slice(0, 10);

    render(
      <DayItemCard
        item={createEntry({
          status: "completed",
          endDate: pastISO,
        })}
      />
    );
    expect(screen.queryByTestId("past-end-note")).not.toBeInTheDocument();
  });

  // v4 chunk 3 #7: blocked_by visual cue
  it("renders blocked_by cue with blocker title and status", () => {
    render(
      <DayItemCard
        item={createEntry({
          blockedBy: [
            { id: "wi-1", title: "Copy Ready", status: "in-progress" },
          ],
        })}
      />
    );
    const cue = screen.getByTestId("blocked-by-cue");
    expect(cue).toHaveTextContent("blocked by: Copy Ready");
    expect(cue).toHaveTextContent("(in-progress)");
  });

  it("does not render blocked_by cue when list is empty", () => {
    render(<DayItemCard item={createEntry({ blockedBy: [] })} />);
    expect(screen.queryByTestId("blocked-by-cue")).not.toBeInTheDocument();
  });

  it("renders blocked_by cue without status parens when status is missing", () => {
    render(
      <DayItemCard
        item={createEntry({
          blockedBy: [{ id: "wi-1", title: "Upstream Task" }],
        })}
      />
    );
    const cue = screen.getByTestId("blocked-by-cue");
    expect(cue).toHaveTextContent("blocked by: Upstream Task");
    expect(cue).not.toHaveTextContent("(");
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

describe("parseNotes", () => {
  it("returns plain notes unchanged with no risk and isNextStep false", () => {
    const result = parseNotes("Regular update on the project");
    expect(result.main).toBe("Regular update on the project");
    expect(result.risk).toBeUndefined();
    expect(result.isNextStep).toBe(false);
  });

  it("detects Next Step prefix and strips it from main", () => {
    const result = parseNotes("Next Step: Send the draft to client");
    expect(result.main).toBe("Send the draft to client");
    expect(result.isNextStep).toBe(true);
    expect(result.risk).toBeUndefined();
  });

  it("extracts risk text and removes it from main", () => {
    const result = parseNotes("Waiting on assets (Risk: May miss deadline)");
    expect(result.main).toBe("Waiting on assets");
    expect(result.risk).toBe("May miss deadline");
    expect(result.isNextStep).toBe(false);
  });

  it("handles both Next Step prefix and risk together", () => {
    const result = parseNotes("Next Step: Send SOW (Risk: Client unresponsive)");
    expect(result.main).toBe("Send SOW");
    expect(result.risk).toBe("Client unresponsive");
    expect(result.isNextStep).toBe(true);
  });

  it("returns empty main for empty string", () => {
    const result = parseNotes("");
    expect(result.main).toBe("");
    expect(result.risk).toBeUndefined();
    expect(result.isNextStep).toBe(false);
  });

  it("extracts risk when it appears in the middle of text", () => {
    const result = parseNotes("Design phase (Risk: Scope creep) starting Monday");
    // Risk is removed but internal whitespace is not collapsed (trim only applies to edges)
    expect(result.main).toBe("Design phase  starting Monday");
    expect(result.risk).toBe("Scope creep");
  });

  it("extracts risk at the beginning of text", () => {
    const result = parseNotes("(Risk: Budget overrun) Need approval");
    expect(result.main).toBe("Need approval");
    expect(result.risk).toBe("Budget overrun");
  });

  it("handles risk text with special characters", () => {
    const result = parseNotes("Update (Risk: Client's Q2 budget @ 50% — tight)");
    expect(result.main).toBe("Update");
    expect(result.risk).toBe("Client's Q2 budget @ 50% — tight");
  });

  it("handles risk text with commas and numbers", () => {
    const result = parseNotes("Review (Risk: 3 revisions pending, $2,000 over)");
    expect(result.main).toBe("Review");
    expect(result.risk).toBe("3 revisions pending, $2,000 over");
  });

  it("does not treat Next Step in the middle of text as a prefix", () => {
    const result = parseNotes("Discussed Next Step: options with team");
    expect(result.isNextStep).toBe(false);
    expect(result.main).toBe("Discussed Next Step: options with team");
  });
});
