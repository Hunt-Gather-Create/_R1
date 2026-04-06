import { describe, it, expect } from "vitest";
import { thisWeek, upcoming, pipeline, accounts } from "./data";
import { parseISODate } from "./date-utils";

describe("thisWeek seed data", () => {
  it("has Monday 4/6 as the first day", () => {
    expect(thisWeek[0].date).toBe("2026-04-06");
    const d = parseISODate(thisWeek[0].date);
    expect(d.getDay()).toBe(1); // Monday = 1
  });

  it("has correct day-of-week for all entries", () => {
    const expectedDays = [
      { date: "2026-04-06", day: 1 }, // Monday
      { date: "2026-04-07", day: 2 }, // Tuesday
      { date: "2026-04-08", day: 3 }, // Wednesday
      { date: "2026-04-09", day: 4 }, // Thursday
      { date: "2026-04-10", day: 5 }, // Friday
    ];
    for (let i = 0; i < thisWeek.length; i++) {
      const d = parseISODate(thisWeek[i].date);
      expect(d.getDay()).toBe(expectedDays[i].day);
      expect(thisWeek[i].date).toBe(expectedDays[i].date);
    }
  });

  it("has items for each day", () => {
    for (const day of thisWeek) {
      expect(day.items.length).toBeGreaterThan(0);
    }
  });
});

describe("upcoming seed data", () => {
  it("all dates are after the current week", () => {
    for (const day of upcoming) {
      expect(day.date >= "2026-04-14").toBe(true);
    }
  });
});

describe("pipeline seed data", () => {
  it("every pipeline item has an account that matches a client name", () => {
    const clientNames = new Set(accounts.map((a) => a.name.toLowerCase()));
    for (const item of pipeline) {
      expect(clientNames.has(item.account.toLowerCase())).toBe(true);
    }
  });

  it("has 7 pipeline items", () => {
    expect(pipeline).toHaveLength(7);
  });
});

describe("accounts seed data", () => {
  it("has unique slugs", () => {
    const slugs = accounts.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
