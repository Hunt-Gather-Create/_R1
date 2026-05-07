import { describe, it, expect } from "vitest";
import { mergeWeekendDays, groupByWeek, isActivelySpanning, filterSpanningFromDayCells } from "./runway-board-utils";
import type { DayItem, DayItemEntry } from "./types";

function day(date: string, label: string, itemCount = 0): DayItem {
  return {
    date,
    label,
    items: Array.from({ length: itemCount }, (_, i) => ({
      title: `Item ${i + 1}`,
      account: "Test",
      type: "delivery" as const,
    })),
  };
}

describe("mergeWeekendDays", () => {
  it("merges adjacent Saturday and Sunday into a Weekend column", () => {
    const days = [
      day("2026-04-06", "Mon"),
      day("2026-04-11", "Sat", 1),
      day("2026-04-12", "Sun", 2),
    ];
    const result = mergeWeekendDays(days);
    expect(result).toHaveLength(2);
    expect(result[1].label).toBe("Weekend");
    expect(result[1].items).toHaveLength(3);
    expect(result[1].date).toBe("2026-04-11");
  });

  it("passes through Saturday-only without merging", () => {
    const days = [
      day("2026-04-06", "Mon"),
      day("2026-04-11", "Sat", 1),
    ];
    const result = mergeWeekendDays(days);
    expect(result).toHaveLength(2);
    expect(result[1].label).toBe("Sat");
  });

  it("passes through Sunday-only without merging", () => {
    const days = [
      day("2026-04-12", "Sun", 1),
      day("2026-04-13", "Mon"),
    ];
    const result = mergeWeekendDays(days);
    expect(result).toHaveLength(2);
    expect(result[0].label).toBe("Sun");
  });

  it("returns empty array for empty input", () => {
    expect(mergeWeekendDays([])).toEqual([]);
  });

  it("leaves weekdays unchanged", () => {
    const days = [
      day("2026-04-06", "Mon"),
      day("2026-04-07", "Tue"),
      day("2026-04-08", "Wed"),
    ];
    const result = mergeWeekendDays(days);
    expect(result).toHaveLength(3);
    expect(result.map((d) => d.label)).toEqual(["Mon", "Tue", "Wed"]);
  });

  it("handles non-adjacent Saturday and Sunday (not merged)", () => {
    const days = [
      day("2026-04-11", "Sat", 1),
      day("2026-04-06", "Mon"),
      day("2026-04-12", "Sun", 1),
    ];
    const result = mergeWeekendDays(days);
    // Sat followed by Mon, not Sun — no merge
    expect(result).toHaveLength(3);
  });
});

describe("groupByWeek", () => {
  it("groups days by their Monday", () => {
    const days = [
      day("2026-04-06", "Mon"),
      day("2026-04-07", "Tue"),
      day("2026-04-08", "Wed"),
    ];
    const result = groupByWeek(days);
    expect(result).toHaveLength(1);
    expect(result[0].mondayDate).toBe("2026-04-06");
    expect(result[0].days).toHaveLength(3);
  });

  it("produces w/o M/D label", () => {
    const days = [day("2026-04-06", "Mon")];
    const result = groupByWeek(days);
    expect(result[0].label).toBe("w/o 4/6");
  });

  it("separates days from different weeks", () => {
    const days = [
      day("2026-04-08", "Wed"),
      day("2026-04-13", "Mon"),
      day("2026-04-14", "Tue"),
    ];
    const result = groupByWeek(days);
    expect(result).toHaveLength(2);
    expect(result[0].mondayDate).toBe("2026-04-06");
    expect(result[0].days).toHaveLength(1);
    expect(result[1].mondayDate).toBe("2026-04-13");
    expect(result[1].days).toHaveLength(2);
  });

  it("returns empty array for empty input", () => {
    expect(groupByWeek([])).toEqual([]);
  });

  it("groups weekend days with their week's Monday", () => {
    const days = [
      day("2026-04-10", "Fri"),
      day("2026-04-11", "Sat"),
    ];
    const result = groupByWeek(days);
    expect(result).toHaveLength(1);
    expect(result[0].mondayDate).toBe("2026-04-06");
    expect(result[0].days).toHaveLength(2);
  });
});

// ── dashboard-cleanup item 4: multi-day placement predicates ─────────────

function makeEntry(overrides: Partial<DayItemEntry> = {}): DayItemEntry {
  return {
    title: "Multi-day Task",
    account: "Convergix",
    type: "delivery",
    ...overrides,
  };
}

describe("isActivelySpanning (item 4)", () => {
  const TODAY = "2026-05-07";

  it("returns true when today falls strictly between start and end", () => {
    const item = makeEntry({ startDate: "2026-05-01", endDate: "2026-05-15" });
    expect(isActivelySpanning(item, TODAY)).toBe(true);
  });

  it("returns true when startDate = today (inclusive)", () => {
    const item = makeEntry({ startDate: TODAY, endDate: "2026-05-15" });
    expect(isActivelySpanning(item, TODAY)).toBe(true);
  });

  it("returns true when endDate = today (inclusive)", () => {
    const item = makeEntry({ startDate: "2026-05-01", endDate: TODAY });
    expect(isActivelySpanning(item, TODAY)).toBe(true);
  });

  it("returns false when startDate > today (not yet started -- forecast anchor stays in day cell)", () => {
    const item = makeEntry({ startDate: "2026-05-10", endDate: "2026-05-20" });
    expect(isActivelySpanning(item, TODAY)).toBe(false);
  });

  it("returns false when endDate < today (already ended)", () => {
    const item = makeEntry({ startDate: "2026-04-01", endDate: "2026-05-01" });
    expect(isActivelySpanning(item, TODAY)).toBe(false);
  });

  it("returns false for single-day items (start == end)", () => {
    const item = makeEntry({ startDate: TODAY, endDate: TODAY });
    expect(isActivelySpanning(item, TODAY)).toBe(false);
  });

  it("returns false when startDate is null", () => {
    const item = makeEntry({ startDate: null, endDate: "2026-05-15" });
    expect(isActivelySpanning(item, TODAY)).toBe(false);
  });

  it("returns false when endDate is null", () => {
    const item = makeEntry({ startDate: "2026-05-01", endDate: null });
    expect(isActivelySpanning(item, TODAY)).toBe(false);
  });

  it("returns false when status is completed (terminal)", () => {
    const item = makeEntry({ startDate: "2026-05-01", endDate: "2026-05-15", status: "completed" });
    expect(isActivelySpanning(item, TODAY)).toBe(false);
  });

  it("returns false when status is canceled (terminal)", () => {
    const item = makeEntry({ startDate: "2026-05-01", endDate: "2026-05-15", status: "canceled" });
    expect(isActivelySpanning(item, TODAY)).toBe(false);
  });

  it("returns true when status is in-progress and spanning", () => {
    const item = makeEntry({ startDate: "2026-05-01", endDate: "2026-05-15", status: "in-progress" });
    expect(isActivelySpanning(item, TODAY)).toBe(true);
  });
});

describe("filterSpanningFromDayCells (item 4)", () => {
  const TODAY = "2026-05-07";

  it("removes actively-spanning items from their day-cell column", () => {
    const spanning = makeEntry({ startDate: "2026-05-01", endDate: "2026-05-15", status: "in-progress", title: "Spanning" });
    const singleDay = makeEntry({ startDate: TODAY, endDate: TODAY, title: "Single Day" });
    const dayBucket: DayItem = {
      date: "2026-05-01",
      label: "Mon 5/1",
      items: [spanning, singleDay],
    };

    const result = filterSpanningFromDayCells([dayBucket], TODAY);
    expect(result[0].items).toHaveLength(1);
    expect(result[0].items[0].title).toBe("Single Day");
  });

  it("preserves future-starting multi-day items (startDate > today)", () => {
    const future = makeEntry({ startDate: "2026-05-10", endDate: "2026-05-20", title: "Future" });
    const dayBucket: DayItem = { date: "2026-05-10", label: "Mon 5/10", items: [future] };
    const result = filterSpanningFromDayCells([dayBucket], TODAY);
    expect(result[0].items).toHaveLength(1);
  });

  it("returns the same object reference when no items are filtered", () => {
    const single = makeEntry({ startDate: TODAY, endDate: TODAY, title: "Single" });
    const dayBucket: DayItem = { date: TODAY, label: "Wed 5/7", items: [single] };
    const result = filterSpanningFromDayCells([dayBucket], TODAY);
    expect(result[0]).toBe(dayBucket); // identity preserved -- no allocation
  });

  it("handles empty days array", () => {
    expect(filterSpanningFromDayCells([], TODAY)).toEqual([]);
  });
});
