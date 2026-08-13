import { describe, expect, it } from "vitest";
import { chicagoISODate, chicagoToday, chicagoDisplayDate } from "./date-chicago";

describe("chicagoISODate", () => {
  it("buckets a UTC morning instant to the same Chicago day", () => {
    // 2026-04-20T05:00:00Z = 00:00 CDT on 2026-04-20
    expect(chicagoISODate(new Date("2026-04-20T05:00:00Z"))).toBe("2026-04-20");
  });

  it("buckets a UTC small-hours instant back to the previous Chicago day", () => {
    // 2026-04-20T02:00:00Z = 21:00 CDT on 2026-04-19
    expect(chicagoISODate(new Date("2026-04-20T02:00:00Z"))).toBe("2026-04-19");
  });

  // DST-boundary correctness (condition b, core proof): bucketing must stay
  // correct across both US transitions regardless of host timezone.
  it("buckets correctly across the 2026 spring-forward (Mar 8, 2am CST -> CDT)", () => {
    // 08:30Z = 02:30 CST just before the jump -> still Mar 8 in Chicago
    expect(chicagoISODate(new Date("2026-03-08T08:30:00Z"))).toBe("2026-03-08");
    // 05:30Z = 23:30 CST on Mar 7
    expect(chicagoISODate(new Date("2026-03-08T05:30:00Z"))).toBe("2026-03-07");
  });

  it("buckets correctly across the 2026 fall-back (Nov 1, 2am CDT -> CST)", () => {
    // 06:30Z = 01:30 CDT on Nov 1
    expect(chicagoISODate(new Date("2026-11-01T06:30:00Z"))).toBe("2026-11-01");
    // 04:30Z = 23:30 CDT on Oct 31
    expect(chicagoISODate(new Date("2026-11-01T04:30:00Z"))).toBe("2026-10-31");
  });
});

describe("chicagoToday", () => {
  it("equals chicagoISODate of the passed instant (injectable clock)", () => {
    const t = new Date("2026-04-20T02:00:00Z");
    expect(chicagoToday(t)).toBe("2026-04-19");
  });
});

describe("chicagoDisplayDate", () => {
  it("formats the Chicago day as a long en-US string", () => {
    expect(chicagoDisplayDate(new Date("2026-04-20T05:00:00Z"))).toBe("Monday, April 20, 2026");
  });
});
