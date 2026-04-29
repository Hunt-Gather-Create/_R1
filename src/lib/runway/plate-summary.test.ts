import { describe, it, expect } from "vitest";
import {
  pastEndRedNote,
  pastEndNoteText,
  retainerRenewalPills,
  retainerPillText,
  contractExpiredPills,
  contractExpiredPillText,
  daysBetween,
  filterInFlight,
} from "./plate-summary";
import type { Account, DayItemEntry, TriageItem } from "@/app/runway/types";

const NOW_ISO = "2026-04-20";
const NOW_MS = Date.parse("2026-04-20T12:00:00Z");

function makeDayItem(overrides: Partial<DayItemEntry> = {}): DayItemEntry {
  return {
    title: "Test Item",
    account: "Convergix",
    type: "delivery",
    ...overrides,
  };
}

function makeTriageItem(overrides: Partial<TriageItem> = {}): TriageItem {
  return {
    id: "p1",
    title: "Test Project",
    status: "in-production",
    category: "active",
    ...overrides,
  };
}

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    name: "High Desert Law",
    slug: "hdl",
    contractStatus: "expired",
    items: [],
    ...overrides,
  };
}

describe("daysBetween", () => {
  it("returns positive diff for future date", () => {
    expect(daysBetween("2026-04-20", "2026-05-20")).toBe(30);
  });

  it("returns negative diff for past date", () => {
    expect(daysBetween("2026-04-20", "2026-04-13")).toBe(-7);
  });

  it("returns 0 for invalid date", () => {
    expect(daysBetween("not-a-date", "2026-04-20")).toBe(0);
  });
});

describe("pastEndRedNote", () => {
  it("flags in-progress item past its end_date", () => {
    const item = makeDayItem({
      status: "in-progress",
      endDate: "2026-04-15", // 5 days ago
      startDate: "2026-04-10",
      updatedAtMs: Date.parse("2026-04-17T12:00:00Z"), // 3 days ago
    });

    const result = pastEndRedNote(item, NOW_ISO, NOW_MS);
    expect(result).not.toBeNull();
    expect(result?.daysSinceTouched).toBe(3);
  });

  it("falls back to start_date when end_date null for single-day items", () => {
    const item = makeDayItem({
      status: "in-progress",
      endDate: null,
      startDate: "2026-04-18",
      updatedAtMs: Date.parse("2026-04-18T12:00:00Z"),
    });

    const result = pastEndRedNote(item, NOW_ISO, NOW_MS);
    expect(result).not.toBeNull();
    expect(result?.daysSinceTouched).toBe(2);
  });

  it("does not flag items with status other than in-progress", () => {
    const item = makeDayItem({
      status: "completed",
      endDate: "2026-04-15",
    });
    expect(pastEndRedNote(item, NOW_ISO, NOW_MS)).toBeNull();
  });

  it("does not flag items whose end_date is today or future", () => {
    const item = makeDayItem({
      status: "in-progress",
      endDate: "2026-04-22",
    });
    expect(pastEndRedNote(item, NOW_ISO, NOW_MS)).toBeNull();
  });

  it("defaults daysSinceTouched to 0 when updatedAtMs missing", () => {
    const item = makeDayItem({
      status: "in-progress",
      endDate: "2026-04-15",
    });
    const result = pastEndRedNote(item, NOW_ISO, NOW_MS);
    expect(result?.daysSinceTouched).toBe(0);
  });

  it("formats singular/plural day copy", () => {
    expect(pastEndNoteText(1)).toContain("1 day ago");
    expect(pastEndNoteText(3)).toContain("3 days ago");
    expect(pastEndNoteText(0)).toContain("0 days ago");
  });
});

describe("retainerRenewalPills", () => {
  it("flags retainer L1s expiring within 30 days", () => {
    const items = [
      makeTriageItem({
        title: "Soundly Retainer",
        engagementType: "retainer",
        contractEnd: "2026-05-10", // 20 days out
      }),
      makeTriageItem({
        title: "Beyond Petro MSA",
        engagementType: "retainer",
        contractEnd: "2026-06-30", // 71 days out
      }),
    ];

    const pills = retainerRenewalPills(items, NOW_ISO);
    expect(pills).toHaveLength(1);
    expect(pills[0].projectName).toBe("Soundly Retainer");
    expect(pills[0].daysOut).toBe(20);
  });

  it("includes contract_end exactly 30 days out (inclusive window)", () => {
    const items = [
      makeTriageItem({
        engagementType: "retainer",
        contractEnd: "2026-05-20", // exactly 30 days
      }),
    ];
    expect(retainerRenewalPills(items, NOW_ISO)).toHaveLength(1);
  });

  it("ignores non-retainer engagement types", () => {
    const items = [
      makeTriageItem({
        engagementType: "project",
        contractEnd: "2026-05-01",
      }),
      makeTriageItem({
        engagementType: "break-fix",
        contractEnd: "2026-05-01",
      }),
    ];
    expect(retainerRenewalPills(items, NOW_ISO)).toHaveLength(0);
  });

  it("ignores retainers without contract_end set", () => {
    const items = [
      makeTriageItem({
        engagementType: "retainer",
        contractEnd: null,
      }),
    ];
    expect(retainerRenewalPills(items, NOW_ISO)).toHaveLength(0);
  });

  it("ignores retainers whose contract already ended", () => {
    const items = [
      makeTriageItem({
        engagementType: "retainer",
        contractEnd: "2026-04-01", // past
      }),
    ];
    expect(retainerRenewalPills(items, NOW_ISO)).toHaveLength(0);
  });

  it("formats copy as 'Renewal: {project} expires {date}'", () => {
    const text = retainerPillText({
      projectName: "Soundly Payment Gateway",
      contractEnd: "2026-05-10",
      daysOut: 20,
    });
    expect(text).toBe("Renewal: Soundly Payment Gateway expires 2026-05-10");
  });
});

describe("contractExpiredPills", () => {
  it("flags expired clients with at least one active L1", () => {
    const accounts = [
      makeAccount({
        name: "High Desert Law",
        contractStatus: "expired",
        items: [makeTriageItem({ status: "in-production" })],
      }),
    ];

    expect(contractExpiredPills(accounts)).toEqual([
      { clientName: "High Desert Law" },
    ]);
  });

  it("does not flag expired clients with no active work", () => {
    const accounts = [
      makeAccount({
        name: "Old Client",
        contractStatus: "expired",
        items: [makeTriageItem({ status: "completed" })],
      }),
    ];
    expect(contractExpiredPills(accounts)).toHaveLength(0);
  });

  it("does not flag signed or unsigned clients", () => {
    const accounts = [
      makeAccount({
        name: "Signed Co",
        contractStatus: "signed",
        items: [makeTriageItem({ status: "in-production" })],
      }),
      makeAccount({
        name: "Unsigned Co",
        contractStatus: "unsigned",
        items: [makeTriageItem({ status: "in-production" })],
      }),
    ];
    expect(contractExpiredPills(accounts)).toHaveLength(0);
  });

  it("treats 'blocked' and 'not-started' as active for this flag", () => {
    const accounts = [
      makeAccount({
        name: "Expired + Blocked",
        contractStatus: "expired",
        items: [makeTriageItem({ status: "blocked" })],
      }),
      makeAccount({
        name: "Expired + Not Started",
        contractStatus: "expired",
        items: [makeTriageItem({ status: "not-started" })],
      }),
    ];
    expect(contractExpiredPills(accounts)).toHaveLength(2);
  });

  it("formats copy as 'Contract expired: {client}'", () => {
    expect(contractExpiredPillText({ clientName: "High Desert Law" })).toBe(
      "Contract expired: High Desert Law"
    );
  });
});

describe("filterInFlight", () => {
  const NOW = "2026-04-20";

  it("keeps in-progress items whose today is in (startDate, endDate]", () => {
    // Strict-start rule (Commit 4): start < today < or == end. Items where
    // start == today belong to Today, not In Flight.
    const items = [
      { status: "in-progress", startDate: "2026-04-10", endDate: "2026-04-30", title: "A" },
    ];
    const result = filterInFlight(items, NOW);
    expect(result.map((i) => i.title)).toEqual(["A"]);
  });

  it("excludes Day 0 items where startDate == today (belongs to Today, not In Flight)", () => {
    const items = [
      { status: "in-progress", startDate: "2026-04-20", endDate: "2026-05-20", title: "Kickoff today" },
      { status: "in-progress", startDate: "2026-04-20", endDate: "2026-04-20", title: "Single-day today" },
      { status: "in-progress", startDate: "2026-04-20", endDate: null, title: "Single-day today, null end" },
    ];
    expect(filterInFlight(items, NOW)).toHaveLength(0);
  });

  it("keeps Day 1 items where startDate == today − 1", () => {
    const items = [
      { status: "in-progress", startDate: "2026-04-19", endDate: "2026-05-19", title: "Day 1" },
    ];
    expect(filterInFlight(items, NOW).map((i) => i.title)).toEqual(["Day 1"]);
  });

  it("keeps last-day items where endDate == today (today ≤ end is inclusive)", () => {
    const items = [
      { status: "in-progress", startDate: "2026-04-06", endDate: "2026-04-20", title: "Last day" },
    ];
    expect(filterInFlight(items, NOW).map((i) => i.title)).toEqual(["Last day"]);
  });

  it("excludes items whose status is not in-progress", () => {
    const items = [
      { status: "completed", startDate: "2026-04-10", endDate: "2026-04-30" },
      { status: null, startDate: "2026-04-10", endDate: "2026-04-30" },
      { status: "blocked", startDate: "2026-04-10", endDate: "2026-04-30" },
    ];
    expect(filterInFlight(items, NOW)).toHaveLength(0);
  });

  it("excludes items outside the start/end window", () => {
    const items = [
      { status: "in-progress", startDate: "2026-05-01", endDate: "2026-05-10" },
      { status: "in-progress", startDate: "2026-04-01", endDate: "2026-04-10" },
    ];
    expect(filterInFlight(items, NOW)).toHaveLength(0);
  });

  it("excludes items without a start_date", () => {
    const items = [
      { status: "in-progress", startDate: null, endDate: "2026-04-30" },
    ];
    expect(filterInFlight(items, NOW)).toHaveLength(0);
  });
});
