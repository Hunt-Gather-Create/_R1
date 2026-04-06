import { describe, it, expect } from "vitest";
import { formatTimestamp } from "./updates-channel";

describe("formatTimestamp", () => {
  it("formats a morning time correctly", () => {
    // April 5, 2026 at 10:14 AM
    const date = new Date(2026, 3, 5, 10, 14, 0);
    expect(formatTimestamp(date)).toBe("Apr. 5 2026 at 10:14 AM");
  });

  it("formats a PM time correctly", () => {
    // April 5, 2026 at 3:05 PM
    const date = new Date(2026, 3, 5, 15, 5, 0);
    expect(formatTimestamp(date)).toBe("Apr. 5 2026 at 3:05 PM");
  });

  it("formats midnight as 12:00 AM", () => {
    const date = new Date(2026, 0, 1, 0, 0, 0);
    expect(formatTimestamp(date)).toBe("Jan. 1 2026 at 12:00 AM");
  });

  it("formats noon as 12:00 PM", () => {
    const date = new Date(2026, 0, 1, 12, 0, 0);
    expect(formatTimestamp(date)).toBe("Jan. 1 2026 at 12:00 PM");
  });

  it("uses May without a period", () => {
    const date = new Date(2026, 4, 11, 9, 30, 0);
    expect(formatTimestamp(date)).toBe("May 11 2026 at 9:30 AM");
  });

  it("pads minutes to two digits", () => {
    const date = new Date(2026, 5, 15, 8, 3, 0);
    expect(formatTimestamp(date)).toBe("Jun. 15 2026 at 8:03 AM");
  });

  it("formats December correctly", () => {
    const date = new Date(2026, 11, 25, 23, 59, 0);
    expect(formatTimestamp(date)).toBe("Dec. 25 2026 at 11:59 PM");
  });
});
