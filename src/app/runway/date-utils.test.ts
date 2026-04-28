import { describe, it, expect } from "vitest";
import { getMonday, getMondayISODate, parseISODate, toISODateString, toShortDateString } from "./date-utils";

describe("parseISODate", () => {
  it("returns a Date object at noon", () => {
    const d = parseISODate("2026-04-06");
    expect(d.getHours()).toBe(12);
    expect(d.getMinutes()).toBe(0);
  });

  it("parses the correct year, month, and day", () => {
    const d = parseISODate("2026-04-06");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(3); // April = 3 (zero-indexed)
    expect(d.getDate()).toBe(6);
  });

  it("handles year boundaries", () => {
    const d = parseISODate("2025-12-31");
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(11);
    expect(d.getDate()).toBe(31);
  });
});

describe("getMonday", () => {
  it("returns a Date object (not a string)", () => {
    const result = getMonday(new Date("2026-04-08T12:00:00"));
    expect(result).toBeInstanceOf(Date);
  });

  it("returns Monday for a Wednesday input", () => {
    const result = getMonday(new Date("2026-04-08T12:00:00"));
    expect(result.getDay()).toBe(1); // Monday
    expect(result.getDate()).toBe(6);
  });

  it("returns same day for a Monday input", () => {
    const result = getMonday(new Date("2026-04-06T12:00:00"));
    expect(result.getDate()).toBe(6);
  });

  it("returns previous Monday for a Sunday", () => {
    const result = getMonday(new Date("2026-04-12T12:00:00"));
    expect(result.getDate()).toBe(6);
  });
});

describe("getMondayISODate", () => {
  it("returns the same date for a Monday", () => {
    // April 6, 2026 is a Monday
    expect(getMondayISODate(new Date("2026-04-06T12:00:00"))).toBe("2026-04-06");
  });

  it("returns the previous Monday for a Wednesday", () => {
    // April 8, 2026 is a Wednesday
    expect(getMondayISODate(new Date("2026-04-08T12:00:00"))).toBe("2026-04-06");
  });

  it("returns the previous Monday for a Friday", () => {
    // April 10, 2026 is a Friday
    expect(getMondayISODate(new Date("2026-04-10T12:00:00"))).toBe("2026-04-06");
  });

  it("returns the previous Monday for a Sunday", () => {
    // April 12, 2026 is a Sunday
    expect(getMondayISODate(new Date("2026-04-12T12:00:00"))).toBe("2026-04-06");
  });

  it("returns the previous Monday for a Saturday", () => {
    // April 11, 2026 is a Saturday
    expect(getMondayISODate(new Date("2026-04-11T12:00:00"))).toBe("2026-04-06");
  });

  it("handles week boundaries across months", () => {
    // March 31, 2026 is a Tuesday → Monday is March 30
    expect(getMondayISODate(new Date("2026-03-31T12:00:00"))).toBe("2026-03-30");
  });

  it("handles week boundaries across years", () => {
    // January 1, 2026 is a Thursday → Monday is December 29, 2025
    expect(getMondayISODate(new Date("2026-01-01T12:00:00"))).toBe("2025-12-29");
  });
});

describe("toISODateString", () => {
  it("formats a date as YYYY-MM-DD", () => {
    expect(toISODateString(new Date("2026-04-07T12:00:00"))).toBe("2026-04-07");
  });

  it("zero-pads single-digit months and days", () => {
    expect(toISODateString(new Date("2026-01-05T12:00:00"))).toBe("2026-01-05");
  });

  it("handles December 31", () => {
    expect(toISODateString(new Date("2025-12-31T12:00:00"))).toBe("2025-12-31");
  });

  it("uses local time, not UTC", () => {
    // Create a date at noon local time — should reflect local date
    const d = new Date(2026, 3, 7, 12, 0, 0); // April 7
    expect(toISODateString(d)).toBe("2026-04-07");
  });
});

describe("toShortDateString", () => {
  it("formats a YYYY-MM-DD string as M/D with no zero-padding", () => {
    expect(toShortDateString("2026-04-07")).toBe("4/7");
    expect(toShortDateString("2026-09-03")).toBe("9/3");
  });

  it("formats double-digit month and day without padding changes", () => {
    expect(toShortDateString("2026-12-31")).toBe("12/31");
  });

  it("returns null for null and undefined", () => {
    expect(toShortDateString(null)).toBeNull();
    expect(toShortDateString(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(toShortDateString("")).toBeNull();
  });

  it("returns null for malformed input missing separators", () => {
    expect(toShortDateString("20260407")).toBeNull();
  });

  it("returns null when month or day is non-numeric", () => {
    expect(toShortDateString("2026-XX-07")).toBeNull();
    expect(toShortDateString("2026-04-DD")).toBeNull();
  });
});
