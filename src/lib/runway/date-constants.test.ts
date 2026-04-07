import { describe, it, expect } from "vitest";
import { DAY_NAMES, MONTH_NAMES, MONTH_NAMES_SHORT } from "./date-constants";

describe("DAY_NAMES", () => {
  it("has 7 entries starting with Sunday", () => {
    expect(DAY_NAMES).toHaveLength(7);
    expect(DAY_NAMES[0]).toBe("Sunday");
    expect(DAY_NAMES[6]).toBe("Saturday");
  });

  it("matches JavaScript Date.getDay() indexing", () => {
    // Date.getDay() returns 0 for Sunday
    const sunday = new Date("2026-04-05T12:00:00");
    expect(DAY_NAMES[sunday.getDay()]).toBe("Sunday");
  });
});

describe("MONTH_NAMES", () => {
  it("has 12 entries starting with January", () => {
    expect(MONTH_NAMES).toHaveLength(12);
    expect(MONTH_NAMES[0]).toBe("January");
    expect(MONTH_NAMES[11]).toBe("December");
  });

  it("matches JavaScript Date.getMonth() indexing", () => {
    const april = new Date("2026-04-07T12:00:00");
    expect(MONTH_NAMES[april.getMonth()]).toBe("April");
  });
});

describe("MONTH_NAMES_SHORT", () => {
  it("has 12 entries", () => {
    expect(MONTH_NAMES_SHORT).toHaveLength(12);
  });

  it("uses abbreviated forms with periods (except May)", () => {
    expect(MONTH_NAMES_SHORT[0]).toBe("Jan.");
    expect(MONTH_NAMES_SHORT[4]).toBe("May"); // No period for May
    expect(MONTH_NAMES_SHORT[11]).toBe("Dec.");
  });

  it("corresponds to MONTH_NAMES by index", () => {
    for (let i = 0; i < 12; i++) {
      const shortForm = MONTH_NAMES_SHORT[i].replace(".", "");
      expect(MONTH_NAMES[i].startsWith(shortForm)).toBe(true);
    }
  });
});
