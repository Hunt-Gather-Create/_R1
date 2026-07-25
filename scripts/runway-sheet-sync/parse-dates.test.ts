import { describe, expect, it } from "vitest";
import { getMondayIso, isParseableDate, parseSheetDate } from "./parse-dates";

describe("parseSheetDate", () => {
  it("parses d-MMM-yyyy (LPPC/Soundly format)", () => {
    expect(parseSheetDate("22-Jun-2026")).toBe("2026-06-22");
    expect(parseSheetDate("2-Jul-2026")).toBe("2026-07-02");
    expect(parseSheetDate("10-Jul-2026")).toBe("2026-07-10");
  });

  it("parses M/D/YYYY (BP ITEP format)", () => {
    expect(parseSheetDate("7/13/2026")).toBe("2026-07-13");
    expect(parseSheetDate("12/1/2026")).toBe("2026-12-01");
  });

  it("returns null for empty and whitespace cells", () => {
    expect(parseSheetDate("")).toBeNull();
    expect(parseSheetDate("  ")).toBeNull();
    expect(parseSheetDate(undefined)).toBeNull();
    expect(parseSheetDate(null)).toBeNull();
  });

  it("returns null for unparseable values (never falls back to new Date)", () => {
    expect(parseSheetDate("June 22, 2026")).toBeNull();
    expect(parseSheetDate("22-Junn-2026")).toBeNull();
    expect(parseSheetDate("13/40/2026")).toBeNull();
    expect(parseSheetDate("TBD")).toBeNull();
  });

  it("rejects impossible day/month combinations", () => {
    expect(parseSheetDate("0/13/2026")).toBeNull();
    expect(parseSheetDate("13/13/2026")).toBeNull();
    expect(parseSheetDate("32-Jan-2026")).toBeNull();
  });
});

describe("isParseableDate", () => {
  it("treats empty as parseable (no flag) and junk as not", () => {
    expect(isParseableDate("")).toBe(true);
    expect(isParseableDate("22-Jun-2026")).toBe(true);
    expect(isParseableDate("junk")).toBe(false);
  });
});

describe("getMondayIso", () => {
  it("mirrors operations-writes-week getMonday for each weekday", () => {
    expect(getMondayIso("2026-06-22")).toBe("2026-06-22"); // Monday stays
    expect(getMondayIso("2026-06-24")).toBe("2026-06-22"); // Wednesday
    expect(getMondayIso("2026-06-28")).toBe("2026-06-22"); // Sunday → prior Monday
    expect(getMondayIso("2026-07-13")).toBe("2026-07-13"); // ITEP kickoff Monday
  });
});
