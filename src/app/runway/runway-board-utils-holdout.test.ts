/**
 * Holdout QA tests for runway-board-utils (dashboard-cleanup item 4).
 * Focus: boundary values, missing data, edge cases the implementer did not
 * explicitly verify.
 */
import { describe, it, expect } from "vitest";
import { isActivelySpanning, filterSpanningFromDayCells } from "./runway-board-utils";
import type { DayItem, DayItemEntry } from "./types";

function makeEntry(overrides: Partial<DayItemEntry> = {}): DayItemEntry {
  return {
    title: "Test Item",
    account: "TestCo",
    type: "delivery",
    ...overrides,
  };
}

function makeDay(items: DayItemEntry[]): DayItem {
  return { date: "2026-05-01", label: "Mon 5/1", items };
}

const TODAY = "2026-05-07";

describe("isActivelySpanning holdout: missing data edge cases", () => {
  it("returns false when both startDate and endDate are absent", () => {
    expect(isActivelySpanning(makeEntry({}), TODAY)).toBe(false);
  });

  it("returns false when status is undefined (no status field)", () => {
    // status absent = non-terminal, so spanning rule applies
    const item = makeEntry({ startDate: "2026-05-01", endDate: "2026-05-15" });
    // status is absent (not set) -- should NOT be treated as terminal
    expect(isActivelySpanning(item, TODAY)).toBe(true);
  });

  it("returns false when status is null (null = non-terminal per convention)", () => {
    const item = makeEntry({ startDate: "2026-05-01", endDate: "2026-05-15", status: null });
    // null status is NOT terminal -- item is still considered spanning
    expect(isActivelySpanning(item, TODAY)).toBe(true);
  });

  it("returns false when startDate empty string", () => {
    const item = makeEntry({ startDate: "", endDate: "2026-05-15" });
    expect(isActivelySpanning(item, TODAY)).toBe(false);
  });

  it("returns false when endDate empty string", () => {
    const item = makeEntry({ startDate: "2026-05-01", endDate: "" });
    expect(isActivelySpanning(item, TODAY)).toBe(false);
  });

  it("handles item with blocked status (non-terminal, actively spans)", () => {
    const item = makeEntry({ startDate: "2026-05-01", endDate: "2026-05-15", status: "blocked" });
    expect(isActivelySpanning(item, TODAY)).toBe(true);
  });
});

describe("filterSpanningFromDayCells holdout: boundary + failure injection", () => {
  it("all items spanning -- day bucket becomes empty items array, not dropped", () => {
    const spanning = makeEntry({ startDate: "2026-05-01", endDate: "2026-05-15" });
    const day = makeDay([spanning]);
    const result = filterSpanningFromDayCells([day], TODAY);
    expect(result).toHaveLength(1); // day still present
    expect(result[0].items).toHaveLength(0); // all items filtered out
  });

  it("preserves day identity (same date/label) when filtering items", () => {
    const spanning = makeEntry({ startDate: "2026-05-01", endDate: "2026-05-15" });
    const day: DayItem = { date: "2026-05-01", label: "Mon 5/1", items: [spanning] };
    const result = filterSpanningFromDayCells([day], TODAY);
    expect(result[0].date).toBe("2026-05-01");
    expect(result[0].label).toBe("Mon 5/1");
  });

  it("processes multiple days independently", () => {
    const spanning = makeEntry({ startDate: "2026-05-01", endDate: "2026-05-15", title: "Spanning" });
    const future = makeEntry({ startDate: "2026-05-10", endDate: "2026-05-20", title: "Future" });
    const day1: DayItem = { date: "2026-05-01", label: "Thu 5/1", items: [spanning] };
    const day2: DayItem = { date: "2026-05-10", label: "Sat 5/10", items: [future] };
    const result = filterSpanningFromDayCells([day1, day2], TODAY);
    expect(result[0].items).toHaveLength(0); // spanning removed from day1
    expect(result[1].items).toHaveLength(1); // future stays in day2
  });
});
