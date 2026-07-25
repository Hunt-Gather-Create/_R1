import { describe, expect, it } from "vitest";
import { WEEK_ITEM_CATEGORIES } from "../../src/lib/runway/week-item-categories";
import { WEEK_ITEM_STATUSES } from "../../src/lib/runway/week-item-statuses";
import { composeNotes, deriveCategory, deriveStatus, disambiguateTitles } from "./derive";
import type { LeafTask } from "./types";

describe("deriveStatus (§2.4 CREATE branch)", () => {
  it("maps checkbox to completed/scheduled only", () => {
    expect(deriveStatus(true)).toBe("completed");
    expect(deriveStatus(false)).toBe("scheduled");
  });

  it("only emits values in the live L2 enum", () => {
    expect(WEEK_ITEM_STATUSES).toContain(deriveStatus(true));
    expect(WEEK_ITEM_STATUSES).toContain(deriveStatus(false));
  });
});

describe("deriveCategory (Q1.12)", () => {
  it("matches leaf title keywords first", () => {
    expect(deriveCategory("Phase 2.1 Kickoff", null)).toBe("kickoff");
    expect(deriveCategory("Phase 2.1 launch", null)).toBe("launch");
    expect(deriveCategory("Publish LIVE on example.org", null)).toBe("launch");
    expect(deriveCategory("Accessibility QA", null)).toBe("review");
    expect(deriveCategory("Client Review Round 1", null)).toBe("review");
    expect(deriveCategory("LPPC reviews + selects treatment", null)).toBe("review");
    expect(deriveCategory("Pre-launch review", null)).toBe("launch"); // launch outranks review (rule order)
  });

  it("falls back to section context, then delivery", () => {
    expect(deriveCategory("Cross-browser + Lighthouse", "Internal QA")).toBe("review");
    expect(deriveCategory("Homepage Carousel build", "Dev Sprint")).toBe("delivery");
    expect(deriveCategory("Asset population", null)).toBe("delivery");
  });

  it("only emits values in the live category enum", () => {
    for (const [title, section] of [
      ["Kickoff", null],
      ["Ship it", "Launch"],
      ["Whatever", null],
    ] as const) {
      expect(WEEK_ITEM_CATEGORIES).toContain(deriveCategory(title, section));
    }
  });
});

describe("composeNotes (§2.5)", () => {
  it("composes in contract order with sheet-row anchor", () => {
    const { notes, truncated } = composeNotes({
      taskNo: "2.1",
      resource: "Civ Design",
      predecessorRow: 12,
      lag: 1,
      priority: "High",
    });
    expect(notes).toBe("[Sheet 2.1] Resource: Civ Design | Predecessor row 12, lag 1 | Priority: High");
    expect(truncated).toBe(false);
  });

  it("omits empty segments", () => {
    expect(composeNotes({ taskNo: null, resource: null, predecessorRow: null, lag: null, priority: null }).notes).toBe("");
    expect(
      composeNotes({ taskNo: "1.1", resource: "LPPC", predecessorRow: null, lag: null, priority: null }).notes
    ).toBe("[Sheet 1.1] Resource: LPPC");
  });

  it("truncates at the 280 L2 cap with ellipsis", () => {
    const { notes, truncated } = composeNotes({
      taskNo: "1.1",
      resource: "X".repeat(400),
      predecessorRow: 12,
      lag: 1,
      priority: "High",
    });
    expect(notes.length).toBe(280);
    expect(notes.endsWith("...")).toBe(true);
    expect(truncated).toBe(true);
  });
});

function leaf(over: Partial<LeafTask>): LeafTask {
  return {
    rowNumber: 1,
    taskNo: "1.1",
    rawLabel: "   1.1 X",
    title: "X",
    resolvedTitle: "X",
    startDate: "2026-06-22",
    endDate: "2026-06-22",
    weekOf: "2026-06-22",
    completed: false,
    derivedStatus: "scheduled",
    category: "delivery",
    section: null,
    priority: null,
    predecessorRow: null,
    lag: null,
    resource: null,
    notes: "",
    notesTruncated: false,
    sortOrder: 0,
    ...over,
  };
}

describe("disambiguateTitles (§2.7 create-side dedupe guard)", () => {
  it("suffixes duplicated (title, weekOf) pairs with section context", () => {
    const tasks = [
      leaf({ rowNumber: 5, title: "Client review", resolvedTitle: "Client review", section: "Design Sprint" }),
      leaf({ rowNumber: 9, title: "Client review", resolvedTitle: "Client review", section: "Client UAT" }),
      leaf({ rowNumber: 12, title: "Unique task", resolvedTitle: "Unique task", section: "Launch" }),
    ];
    const n = disambiguateTitles(tasks);
    expect(n).toBe(2);
    expect(tasks[0].resolvedTitle).toBe("Client review [Design Sprint]");
    expect(tasks[1].resolvedTitle).toBe("Client review [Client UAT]");
    expect(tasks[2].resolvedTitle).toBe("Unique task");
  });

  it("does not suffix same titles in different weeks", () => {
    const tasks = [
      leaf({ title: "QA pass", resolvedTitle: "QA pass", weekOf: "2026-06-22" }),
      leaf({ title: "QA pass", resolvedTitle: "QA pass", weekOf: "2026-06-29" }),
    ];
    expect(disambiguateTitles(tasks)).toBe(0);
    expect(tasks[0].resolvedTitle).toBe("QA pass");
  });

  it("falls back to row number when duplicates share a section", () => {
    const tasks = [
      leaf({ rowNumber: 5, title: "QA", resolvedTitle: "QA", section: null }),
      leaf({ rowNumber: 9, title: "QA", resolvedTitle: "QA", section: null }),
    ];
    disambiguateTitles(tasks);
    expect(tasks[0].resolvedTitle).toBe("QA [row 5]");
    expect(tasks[1].resolvedTitle).toBe("QA [row 9]");
  });

  it("falls back to row number when duplicates share the SAME section (still-colliding suffix)", () => {
    const tasks = [
      leaf({ rowNumber: 5, title: "QA", resolvedTitle: "QA", section: "Dev Sprint" }),
      leaf({ rowNumber: 9, title: "QA", resolvedTitle: "QA", section: "Dev Sprint" }),
    ];
    disambiguateTitles(tasks);
    expect(tasks[0].resolvedTitle).toBe("QA [row 5]");
    expect(tasks[1].resolvedTitle).toBe("QA [row 9]");
    // resolvedTitles must be globally unique or createWeekItem silently dedupes
    expect(new Set(tasks.map((t) => t.resolvedTitle)).size).toBe(2);
  });
});
