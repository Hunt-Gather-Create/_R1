import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Account, DayItem, DayItemEntry, TriageItem } from "@/app/runway/types";
import {
  flagId,
  detectResourceConflicts,
  detectStaleItems,
  detectDeadlines,
  detectBottlenecks,
  detectPastEndL2s,
  isPastEndInProgress,
  detectRetainerRenewals,
  detectContractExpired,
  detectHierarchyDemotions,
  detectWrapperCloseOut,
} from "./flags-detectors";

function createDayItemEntry(overrides: Partial<DayItemEntry> = {}): DayItemEntry {
  return {
    title: "Review deck",
    account: "Convergix",
    type: "review",
    ...overrides,
  };
}

function createDayItem(date: string, items: DayItemEntry[]): DayItem {
  return { date, label: date, items };
}

function createTriageItem(overrides: Partial<TriageItem> = {}): TriageItem {
  return {
    id: "item-1",
    title: "CDS Messaging",
    status: "in-production",
    category: "active",
    ...overrides,
  };
}

function createAccount(overrides: Partial<Account> = {}): Account {
  return {
    name: "Convergix",
    slug: "convergix",
    contractStatus: "signed",
    items: [],
    ...overrides,
  };
}

describe("flagId", () => {
  it("returns a 16-character hex string", () => {
    const id = flagId("resource-conflict", "Kathy");
    expect(id).toMatch(/^[a-f0-9]{16}$/);
  });

  it("produces stable output for the same inputs", () => {
    const a = flagId("stale", "convergix", "p1");
    const b = flagId("stale", "convergix", "p1");
    expect(a).toBe(b);
  });

  it("produces different output for different inputs", () => {
    const a = flagId("stale", "convergix", "p1");
    const b = flagId("stale", "convergix", "p2");
    expect(a).not.toBe(b);
  });

  it("produces different output for different types", () => {
    const a = flagId("stale", "convergix");
    const b = flagId("bottleneck", "convergix");
    expect(a).not.toBe(b);
  });
});

describe("detectResourceConflicts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T12:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flags a person with 3+ deliverables across 2+ clients within 10 days", () => {
    const thisWeek: DayItem[] = [
      createDayItem("2026-04-07", [
        createDayItemEntry({ id: "a", owner: "Kathy", account: "Convergix" }),
        createDayItemEntry({ id: "b", owner: "Kathy", account: "Convergix" }),
      ]),
      createDayItem("2026-04-08", [
        createDayItemEntry({ id: "c", owner: "Kathy", account: "LPPC" }),
      ]),
    ];

    const flags = detectResourceConflicts(thisWeek, []);
    expect(flags).toHaveLength(1);
    expect(flags[0].type).toBe("resource-conflict");
    expect(flags[0].relatedPerson).toBe("Kathy");
    expect(flags[0].title).toContain("3 deliverables");
  });

  it("does not flag a person with items on only 1 client", () => {
    const thisWeek: DayItem[] = [
      createDayItem("2026-04-07", [
        createDayItemEntry({ owner: "Kathy", account: "Convergix" }),
        createDayItemEntry({ owner: "Kathy", account: "Convergix" }),
        createDayItemEntry({ owner: "Kathy", account: "Convergix" }),
      ]),
    ];

    const flags = detectResourceConflicts(thisWeek, []);
    expect(flags).toHaveLength(0);
  });

  it("does not flag a person with fewer than 3 deliverables", () => {
    const thisWeek: DayItem[] = [
      createDayItem("2026-04-07", [
        createDayItemEntry({ owner: "Kathy", account: "Convergix" }),
        createDayItemEntry({ owner: "Kathy", account: "LPPC" }),
      ]),
    ];

    const flags = detectResourceConflicts(thisWeek, []);
    expect(flags).toHaveLength(0);
  });

  it("ignores items beyond 10-day cutoff", () => {
    const upcoming: DayItem[] = [
      createDayItem("2026-04-20", [
        createDayItemEntry({ owner: "Kathy", account: "LPPC" }),
      ]),
    ];
    const thisWeek: DayItem[] = [
      createDayItem("2026-04-07", [
        createDayItemEntry({ owner: "Kathy", account: "Convergix" }),
        createDayItemEntry({ owner: "Kathy", account: "Convergix" }),
      ]),
    ];

    const flags = detectResourceConflicts(thisWeek, upcoming);
    expect(flags).toHaveLength(0);
  });

  it("skips completed L2 items when counting capacity", () => {
    const thisWeek: DayItem[] = [
      createDayItem("2026-04-07", [
        createDayItemEntry({ owner: "Kathy", account: "Convergix", status: "completed" }),
        createDayItemEntry({ owner: "Kathy", account: "Convergix" }),
        createDayItemEntry({ owner: "Kathy", account: "LPPC" }),
      ]),
    ];

    // With the completed item filtered, Kathy has only 2 — below the 3+ threshold.
    const flags = detectResourceConflicts(thisWeek, []);
    expect(flags).toHaveLength(0);
  });

  it("skips blocked L2 items (staffing signal excludes blocked)", () => {
    const thisWeek: DayItem[] = [
      createDayItem("2026-04-07", [
        createDayItemEntry({ owner: "Kathy", account: "Convergix", status: "blocked" }),
        createDayItemEntry({ owner: "Kathy", account: "Convergix" }),
        createDayItemEntry({ owner: "Kathy", account: "LPPC" }),
      ]),
    ];

    // Blocked filtered → Kathy has 2 items across 2 clients, below the 3+ threshold.
    const flags = detectResourceConflicts(thisWeek, []);
    expect(flags).toHaveLength(0);
  });

  it("skips items with no owner AND no resources", () => {
    const thisWeek: DayItem[] = [
      createDayItem("2026-04-07", [
        createDayItemEntry({ owner: undefined, account: "Convergix" }),
        createDayItemEntry({ owner: undefined, account: "LPPC" }),
        createDayItemEntry({ owner: undefined, account: "Hopdoddy" }),
      ]),
    ];

    const flags = detectResourceConflicts(thisWeek, []);
    expect(flags).toHaveLength(0);
  });

  // ── Resources-field inclusion + per-item dedupe (2026-04-23 locks) ──

  it("counts resources-field names alongside owner (agency capacity reality)", () => {
    const thisWeek: DayItem[] = [
      // Kathy named as CD on items she doesn't own — still hits her capacity.
      createDayItem("2026-04-07", [
        createDayItemEntry({
          id: "a",
          owner: "Lane",
          resources: "CD: Kathy, CW: Leslie",
          account: "Convergix",
        }),
        createDayItemEntry({
          id: "b",
          owner: "Lane",
          resources: "CD: Kathy",
          account: "LPPC",
        }),
      ]),
      createDayItem("2026-04-08", [
        createDayItemEntry({
          id: "c",
          owner: "Kathy",
          account: "Hopdoddy",
        }),
      ]),
    ];

    const flags = detectResourceConflicts(thisWeek, []);
    const kathy = flags.find((f) => f.relatedPerson?.toLowerCase() === "kathy");
    expect(kathy).toBeDefined();
    expect(kathy!.title).toContain("3 deliverables");
    expect(kathy!.title).toContain("10 days");
  });

  it("parses role-prefix AND bare entries (Leslie without role prefix = Resource)", () => {
    const thisWeek: DayItem[] = [
      createDayItem("2026-04-07", [
        createDayItemEntry({
          id: "a",
          owner: "Lane",
          resources: "CD: Kathy, CW: Lane, Leslie",
          account: "Convergix",
        }),
        createDayItemEntry({
          id: "b",
          owner: "Leslie",
          resources: "CD: Kathy",
          account: "LPPC",
        }),
        createDayItemEntry({
          id: "c",
          owner: "Leslie",
          resources: "CD: Kathy",
          account: "Hopdoddy",
        }),
      ]),
    ];

    const flags = detectResourceConflicts(thisWeek, []);
    // Leslie (bare entry on item a + owner on b, c) → 3 items across 3 clients
    const leslie = flags.find((f) => f.relatedPerson?.toLowerCase() === "leslie");
    expect(leslie).toBeDefined();
    expect(leslie!.title).toContain("3 deliverables");
    // Kathy (CD prefix on all 3 items across 3 clients) → 3 items
    const kathy = flags.find((f) => f.relatedPerson?.toLowerCase() === "kathy");
    expect(kathy).toBeDefined();
    expect(kathy!.title).toContain("3 deliverables");
  });

  it("counts an owner-less item with populated resources (early-exit rework)", () => {
    const thisWeek: DayItem[] = [
      createDayItem("2026-04-07", [
        createDayItemEntry({
          id: "a",
          owner: undefined,
          resources: "CD: Kathy, CW: Lane",
          account: "Convergix",
        }),
        createDayItemEntry({
          id: "b",
          owner: undefined,
          resources: "CD: Kathy",
          account: "LPPC",
        }),
        createDayItemEntry({
          id: "c",
          owner: undefined,
          resources: "CD: Kathy",
          account: "Hopdoddy",
        }),
      ]),
    ];

    const flags = detectResourceConflicts(thisWeek, []);
    const kathy = flags.find((f) => f.relatedPerson?.toLowerCase() === "kathy");
    expect(kathy).toBeDefined();
    expect(kathy!.title).toContain("3 deliverables");
  });

  it("dedupes same person as owner + in resources on the same item (counts as 1)", () => {
    const thisWeek: DayItem[] = [
      // Kathy listed as owner AND as CD in resources on item 'a' — must count once.
      createDayItem("2026-04-07", [
        createDayItemEntry({
          id: "a",
          owner: "Kathy",
          resources: "CD: Kathy, CW: Lane",
          account: "Convergix",
        }),
      ]),
    ];

    const flags = detectResourceConflicts(thisWeek, []);
    // Single item → below 3+ threshold; no flag. Test that the per-item
    // dedupe didn't explode into multiple touches for Kathy on one item.
    expect(flags).toHaveLength(0);
  });

  it("dedupes a multi-day item (same itemId across days) — 1 staffing load, not N", () => {
    // 5-day item for Kathy on Convergix with id='multi' appearing on each day.
    const multiDay = (date: string) =>
      createDayItem(date, [
        createDayItemEntry({
          id: "multi",
          owner: "Kathy",
          account: "Convergix",
          startDate: "2026-04-07",
          endDate: "2026-04-11",
        }),
      ]);
    const thisWeek: DayItem[] = [
      multiDay("2026-04-07"),
      multiDay("2026-04-08"),
      multiDay("2026-04-09"),
      multiDay("2026-04-10"),
      multiDay("2026-04-11"),
      // Plus two other distinct items on other clients so the
      // threshold question is valid — Kathy would fire ONLY if the
      // 5-day item counted as 5 (wrong) instead of 1 (right).
      createDayItem("2026-04-08", [
        createDayItemEntry({ id: "x", owner: "Kathy", account: "LPPC" }),
      ]),
      createDayItem("2026-04-09", [
        createDayItemEntry({ id: "y", owner: "Kathy", account: "Hopdoddy" }),
      ]),
    ];

    const flags = detectResourceConflicts(thisWeek, []);
    const kathy = flags.find((f) => f.relatedPerson === "Kathy");
    expect(kathy).toBeDefined();
    // Unique items for Kathy: multi (once) + x + y = 3.
    expect(kathy!.title).toContain("3 deliverables");
  });

  it("ignores items with no id AND identical account|title composite (dedupe fallback)", () => {
    const thisWeek: DayItem[] = [
      // Same account|title, no id — collapses to a single itemKey.
      createDayItem("2026-04-07", [
        createDayItemEntry({ owner: "Kathy", account: "Convergix", title: "Review" }),
        createDayItemEntry({ owner: "Kathy", account: "Convergix", title: "Review" }),
      ]),
      createDayItem("2026-04-08", [
        createDayItemEntry({ owner: "Kathy", account: "LPPC", title: "Deliverable" }),
      ]),
    ];

    const flags = detectResourceConflicts(thisWeek, []);
    // Kathy's unique items = 2 (the dup collapses). Below threshold → no flag.
    expect(flags).toHaveLength(0);
  });

  it("handles whitespace-only / malformed resources entries by dropping them", () => {
    const thisWeek: DayItem[] = [
      createDayItem("2026-04-07", [
        createDayItemEntry({
          id: "a",
          owner: "Kathy",
          resources: " , ; \n  ,  ",
          account: "Convergix",
        }),
        createDayItemEntry({
          id: "b",
          owner: "Kathy",
          resources: "CD: ",
          account: "LPPC",
        }),
        createDayItemEntry({
          id: "c",
          owner: "Kathy",
          resources: undefined,
          account: "Hopdoddy",
        }),
      ]),
    ];

    const flags = detectResourceConflicts(thisWeek, []);
    // Only Kathy (via owner) should accumulate — resources garbage dropped.
    // 3 items across 3 clients → fires.
    const kathy = flags.find((f) => f.relatedPerson === "Kathy");
    expect(kathy).toBeDefined();
    expect(kathy!.title).toContain("3 deliverables");
    // No spurious additional people.
    expect(flags).toHaveLength(1);
  });
});

describe("detectStaleItems", () => {
  const NOW = new Date("2026-04-20T12:00:00Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function daysAgoISO(days: number): string {
    return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  }

  it("flags items updatedAt >= 14 days ago as warning", () => {
    const accounts: Account[] = [
      createAccount({
        items: [createTriageItem({ updatedAt: daysAgoISO(15) })],
      }),
    ];

    const flags = detectStaleItems(accounts);
    expect(flags).toHaveLength(1);
    expect(flags[0].severity).toBe("warning");
    expect(flags[0].type).toBe("stale");
  });

  it("flags items updatedAt >= 30 days ago as critical", () => {
    const accounts: Account[] = [
      createAccount({
        items: [createTriageItem({ updatedAt: daysAgoISO(35) })],
      }),
    ];

    const flags = detectStaleItems(accounts);
    expect(flags).toHaveLength(1);
    expect(flags[0].severity).toBe("critical");
  });

  it("does not flag items updatedAt < 14 days ago", () => {
    const accounts: Account[] = [
      createAccount({
        items: [createTriageItem({ updatedAt: daysAgoISO(10) })],
      }),
    ];

    const flags = detectStaleItems(accounts);
    expect(flags).toHaveLength(0);
  });

  it("does not flag items with null updatedAt (unknown, no signal)", () => {
    const accounts: Account[] = [
      createAccount({
        items: [createTriageItem({ updatedAt: null })],
      }),
    ];

    const flags = detectStaleItems(accounts);
    expect(flags).toHaveLength(0);
  });

  it("does not flag items with missing updatedAt", () => {
    const accounts: Account[] = [
      createAccount({
        items: [createTriageItem({ updatedAt: undefined })],
      }),
    ];

    const flags = detectStaleItems(accounts);
    expect(flags).toHaveLength(0);
  });

  it("includes waitingOn in title when present", () => {
    const accounts: Account[] = [
      createAccount({
        items: [createTriageItem({ updatedAt: daysAgoISO(20), waitingOn: "Daniel" })],
      }),
    ];

    const flags = detectStaleItems(accounts);
    expect(flags[0].title).toContain("waiting on Daniel");
    expect(flags[0].relatedPerson).toBe("Daniel");
  });

  it("excludes completed projects even when updatedAt >= 14 days ago", () => {
    const accounts: Account[] = [
      createAccount({
        items: [createTriageItem({ updatedAt: daysAgoISO(30), status: "completed" })],
      }),
    ];

    const flags = detectStaleItems(accounts);
    expect(flags).toHaveLength(0);
  });

  it("excludes on-hold projects even when updatedAt >= 14 days ago", () => {
    const accounts: Account[] = [
      createAccount({
        items: [createTriageItem({ updatedAt: daysAgoISO(30), status: "on-hold" })],
      }),
    ];

    const flags = detectStaleItems(accounts);
    expect(flags).toHaveLength(0);
  });

  it("includes account name and days computed from updatedAt in detail", () => {
    const accounts: Account[] = [
      createAccount({
        name: "Convergix",
        items: [createTriageItem({ updatedAt: daysAgoISO(14) })],
      }),
    ];

    const flags = detectStaleItems(accounts);
    expect(flags[0].detail).toContain("Convergix");
    expect(flags[0].detail).toContain("14 days");
  });
});

describe("detectDeadlines", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T12:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flags deadline items due today as warning", () => {
    const thisWeek: DayItem[] = [
      createDayItem("2026-04-07", [
        createDayItemEntry({ type: "deadline", account: "Convergix", title: "SOW Due" }),
      ]),
    ];

    const flags = detectDeadlines(thisWeek);
    expect(flags).toHaveLength(1);
    expect(flags[0].severity).toBe("warning");
    expect(flags[0].detail).toBe("Due today");
  });

  it("flags delivery items due tomorrow as info", () => {
    const thisWeek: DayItem[] = [
      createDayItem("2026-04-08", [
        createDayItemEntry({ type: "delivery", account: "LPPC", title: "Website launch" }),
      ]),
    ];

    const flags = detectDeadlines(thisWeek);
    expect(flags).toHaveLength(1);
    expect(flags[0].severity).toBe("info");
    expect(flags[0].detail).toBe("Due tomorrow");
  });

  it("ignores items that are not deadline or delivery", () => {
    const thisWeek: DayItem[] = [
      createDayItem("2026-04-07", [
        createDayItemEntry({ type: "review" }),
        createDayItemEntry({ type: "kickoff" }),
      ]),
    ];

    const flags = detectDeadlines(thisWeek);
    expect(flags).toHaveLength(0);
  });

  it("ignores items on days other than today or tomorrow", () => {
    const thisWeek: DayItem[] = [
      createDayItem("2026-04-09", [
        createDayItemEntry({ type: "deadline", title: "Far deadline" }),
      ]),
    ];

    const flags = detectDeadlines(thisWeek);
    expect(flags).toHaveLength(0);
  });

  it("includes account in the title", () => {
    const thisWeek: DayItem[] = [
      createDayItem("2026-04-07", [
        createDayItemEntry({ type: "deadline", account: "Convergix", title: "SOW" }),
      ]),
    ];

    const flags = detectDeadlines(thisWeek);
    expect(flags[0].title).toBe("Convergix: SOW");
    expect(flags[0].relatedClient).toBe("Convergix");
  });

  // Commit 4.6: detectDeadlines now keys on item.endDate (falling back to
  // day.date) so a range task whose bucket sits on the kickoff day still
  // fires its deadline flag on the actual due day.
  it("fires Due today flag for a range task with endDate=today even when bucketed on an earlier startDate", () => {
    const thisWeek: DayItem[] = [
      createDayItem("2026-03-24", [
        createDayItemEntry({
          type: "delivery",
          account: "Bonterra",
          title: "Impact Report",
          startDate: "2026-03-24",
          endDate: "2026-04-07",
        }),
      ]),
    ];

    const flags = detectDeadlines(thisWeek);
    expect(flags).toHaveLength(1);
    expect(flags[0].detail).toBe("Due today");
    expect(flags[0].severity).toBe("warning");
  });

  it("fires Due tomorrow flag for a range task with endDate=tomorrow regardless of bucket key", () => {
    const thisWeek: DayItem[] = [
      createDayItem("2026-03-24", [
        createDayItemEntry({
          type: "delivery",
          account: "Bonterra",
          title: "Range work",
          startDate: "2026-03-24",
          endDate: "2026-04-08",
        }),
      ]),
    ];

    const flags = detectDeadlines(thisWeek);
    expect(flags).toHaveLength(1);
    expect(flags[0].detail).toBe("Due tomorrow");
    expect(flags[0].severity).toBe("info");
  });

  it("does NOT fire when item.endDate is beyond today/tomorrow even if bucket date matches", () => {
    const thisWeek: DayItem[] = [
      createDayItem("2026-04-07", [
        createDayItemEntry({
          type: "delivery",
          account: "X",
          title: "Long-running",
          startDate: "2026-04-07",
          endDate: "2026-04-30",
        }),
      ]),
    ];

    const flags = detectDeadlines(thisWeek);
    expect(flags).toHaveLength(0);
  });

  it("falls back to day.date when item.endDate is absent (single-day items)", () => {
    const thisWeek: DayItem[] = [
      createDayItem("2026-04-07", [
        createDayItemEntry({
          type: "deadline",
          account: "X",
          title: "Single-day deadline",
          // no endDate set — falls back to bucket key
        }),
      ]),
    ];

    const flags = detectDeadlines(thisWeek);
    expect(flags).toHaveLength(1);
    expect(flags[0].detail).toBe("Due today");
  });
});

describe("detectBottlenecks", () => {
  it("flags a person waiting on 3+ items across clients", () => {
    const accounts: Account[] = [
      createAccount({
        name: "Convergix",
        items: [
          createTriageItem({ waitingOn: "Daniel" }),
          createTriageItem({ id: "item-2", waitingOn: "Daniel" }),
        ],
      }),
      createAccount({
        name: "LPPC",
        slug: "lppc",
        items: [createTriageItem({ id: "item-3", waitingOn: "Daniel" })],
      }),
    ];

    const flags = detectBottlenecks(accounts);
    expect(flags).toHaveLength(1);
    expect(flags[0].type).toBe("bottleneck");
    expect(flags[0].relatedPerson).toBe("Daniel");
    expect(flags[0].title).toContain("3 items");
    expect(flags[0].detail).toContain("Convergix");
    expect(flags[0].detail).toContain("LPPC");
  });

  it("does not flag a person with fewer than 3 waitingOn items", () => {
    const accounts: Account[] = [
      createAccount({
        items: [
          createTriageItem({ waitingOn: "Daniel" }),
          createTriageItem({ id: "item-2", waitingOn: "Daniel" }),
        ],
      }),
    ];

    const flags = detectBottlenecks(accounts);
    expect(flags).toHaveLength(0);
  });

  it("ignores items with no waitingOn", () => {
    const accounts: Account[] = [
      createAccount({
        items: [
          createTriageItem({ waitingOn: undefined }),
          createTriageItem({ id: "item-2", waitingOn: undefined }),
          createTriageItem({ id: "item-3", waitingOn: undefined }),
        ],
      }),
    ];

    const flags = detectBottlenecks(accounts);
    expect(flags).toHaveLength(0);
  });

  it("returns empty for empty accounts", () => {
    const flags = detectBottlenecks([]);
    expect(flags).toHaveLength(0);
  });

  it("excludes completed, blocked, on-hold, and awaiting-client items", () => {
    const accounts: Account[] = [
      createAccount({
        name: "Convergix",
        items: [
          // All waiting on Daniel but in non-active states — should not count.
          createTriageItem({ id: "a", status: "completed", waitingOn: "Daniel" }),
          createTriageItem({ id: "b", status: "blocked", waitingOn: "Daniel" }),
          createTriageItem({ id: "c", status: "on-hold", waitingOn: "Daniel" }),
          createTriageItem({ id: "d", status: "awaiting-client", waitingOn: "Daniel" }),
        ],
      }),
    ];

    const flags = detectBottlenecks(accounts);
    expect(flags).toHaveLength(0);
  });

  it("counts only active items toward the bottleneck threshold", () => {
    const accounts: Account[] = [
      createAccount({
        name: "Convergix",
        items: [
          createTriageItem({ id: "a", status: "in-production", waitingOn: "Daniel" }),
          createTriageItem({ id: "b", status: "in-production", waitingOn: "Daniel" }),
          // Inactive — should not count.
          createTriageItem({ id: "c", status: "completed", waitingOn: "Daniel" }),
        ],
      }),
      createAccount({
        name: "LPPC",
        slug: "lppc",
        items: [createTriageItem({ id: "d", status: "in-production", waitingOn: "Daniel" })],
      }),
    ];

    const flags = detectBottlenecks(accounts);
    expect(flags).toHaveLength(1);
    expect(flags[0].title).toContain("3 items");
  });
});

describe("isPastEndInProgress", () => {
  const TODAY = "2026-04-20";

  it("flags items with endDate strictly before today and status in-progress", () => {
    const item = {
      title: "t",
      account: "Convergix",
      type: "delivery",
      status: "in-progress",
      endDate: "2026-04-19",
    } as DayItemEntry;
    expect(isPastEndInProgress(item, TODAY)).toBe(true);
  });

  it("does not flag when endDate equals today", () => {
    const item = {
      title: "t",
      account: "Convergix",
      type: "delivery",
      status: "in-progress",
      endDate: "2026-04-20",
    } as DayItemEntry;
    expect(isPastEndInProgress(item, TODAY)).toBe(false);
  });

  it("does not flag when status is not in-progress", () => {
    const item = {
      title: "t",
      account: "Convergix",
      type: "delivery",
      status: "completed",
      endDate: "2026-04-19",
    } as DayItemEntry;
    expect(isPastEndInProgress(item, TODAY)).toBe(false);
  });

  it("falls back to startDate when endDate is null (single-day item)", () => {
    const item = {
      title: "t",
      account: "Convergix",
      type: "delivery",
      status: "in-progress",
      startDate: "2026-04-19",
      endDate: null,
    } as DayItemEntry;
    expect(isPastEndInProgress(item, TODAY)).toBe(true);
  });

  it("does not flag when single-day start_date === today", () => {
    const item = {
      title: "t",
      account: "Convergix",
      type: "delivery",
      status: "in-progress",
      startDate: TODAY,
      endDate: null,
    } as DayItemEntry;
    expect(isPastEndInProgress(item, TODAY)).toBe(false);
  });

  it("does not flag when both start and end are null", () => {
    const item = {
      title: "t",
      account: "Convergix",
      type: "delivery",
      status: "in-progress",
    } as DayItemEntry;
    expect(isPastEndInProgress(item, TODAY)).toBe(false);
  });
});

describe("detectPastEndL2s", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("triggers exactly at end_date < today AND status === 'in-progress'", () => {
    const thisWeek: DayItem[] = [
      createDayItem("2026-04-15", [
        createDayItemEntry({
          id: "wk-1",
          title: "Dev Handoff",
          account: "Convergix",
          status: "in-progress",
          startDate: "2026-04-10",
          endDate: "2026-04-15",
          type: "delivery",
        }),
      ]),
    ];

    const flags = detectPastEndL2s(thisWeek, []);
    expect(flags).toHaveLength(1);
    expect(flags[0].type).toBe("past-end-l2");
    expect(flags[0].title).toBe("Convergix: Dev Handoff");
    expect(flags[0].detail).toContain("in-progress past end_date");
    expect(flags[0].detail).toContain("2026-04-15");
    expect(flags[0].detail).toContain("5 days ago");
    expect(flags[0].relatedClient).toBe("Convergix");
  });

  it("skips items whose status is 'completed'", () => {
    const thisWeek: DayItem[] = [
      createDayItem("2026-04-15", [
        createDayItemEntry({
          id: "wk-1",
          title: "Done milestone",
          account: "Convergix",
          status: "completed",
          startDate: "2026-04-10",
          endDate: "2026-04-15",
          type: "delivery",
        }),
      ]),
    ];

    const flags = detectPastEndL2s(thisWeek, []);
    expect(flags).toHaveLength(0);
  });

  it("skips items whose end_date equals today (not < today)", () => {
    const thisWeek: DayItem[] = [
      createDayItem("2026-04-20", [
        createDayItemEntry({
          id: "wk-1",
          title: "Ends today",
          account: "Convergix",
          status: "in-progress",
          startDate: "2026-04-10",
          endDate: "2026-04-20",
          type: "delivery",
        }),
      ]),
    ];

    const flags = detectPastEndL2s(thisWeek, []);
    expect(flags).toHaveLength(0);
  });

  it("skips single-day items whose start_date equals today", () => {
    const thisWeek: DayItem[] = [
      createDayItem("2026-04-20", [
        createDayItemEntry({
          id: "wk-1",
          title: "Single-day today",
          account: "Convergix",
          status: "in-progress",
          startDate: "2026-04-20",
          endDate: null,
          type: "delivery",
        }),
      ]),
    ];

    const flags = detectPastEndL2s(thisWeek, []);
    expect(flags).toHaveLength(0);
  });

  it("treats single-day past items (endDate null) as past-end when start < today", () => {
    const thisWeek: DayItem[] = [
      createDayItem("2026-04-18", [
        createDayItemEntry({
          id: "wk-1",
          title: "Legacy single-day",
          account: "Convergix",
          status: "in-progress",
          startDate: "2026-04-18",
          endDate: null,
          type: "delivery",
        }),
      ]),
    ];

    const flags = detectPastEndL2s(thisWeek, []);
    expect(flags).toHaveLength(1);
  });

  it("marks 14+ days past end as 'critical', else 'warning'", () => {
    const thisWeek: DayItem[] = [
      createDayItem("2026-04-05", [
        createDayItemEntry({
          id: "old",
          title: "Old",
          account: "Convergix",
          status: "in-progress",
          startDate: "2026-04-01",
          endDate: "2026-04-05", // 15 days before today
          type: "delivery",
        }),
        createDayItemEntry({
          id: "recent",
          title: "Recent",
          account: "Convergix",
          status: "in-progress",
          startDate: "2026-04-15",
          endDate: "2026-04-18", // 2 days before today
          type: "delivery",
        }),
      ]),
    ];

    const flags = detectPastEndL2s(thisWeek, []);
    expect(flags).toHaveLength(2);
    const old = flags.find((f) => f.title.includes("Old"))!;
    const recent = flags.find((f) => f.title.includes("Recent"))!;
    expect(old.severity).toBe("critical");
    expect(recent.severity).toBe("warning");
  });

  it("dedupes same item appearing in both thisWeek and upcoming by id", () => {
    const entry = createDayItemEntry({
      id: "wk-dupe",
      title: "Dup",
      account: "Convergix",
      status: "in-progress",
      startDate: "2026-04-10",
      endDate: "2026-04-15",
      type: "delivery",
    });
    const thisWeek: DayItem[] = [createDayItem("2026-04-15", [entry])];
    const upcoming: DayItem[] = [createDayItem("2026-04-15", [entry])];

    const flags = detectPastEndL2s(thisWeek, upcoming);
    expect(flags).toHaveLength(1);
  });

  it("exposes owner as relatedPerson when available", () => {
    const thisWeek: DayItem[] = [
      createDayItem("2026-04-18", [
        createDayItemEntry({
          id: "wk-1",
          title: "With owner",
          account: "Convergix",
          owner: "Kathy",
          status: "in-progress",
          startDate: "2026-04-15",
          endDate: "2026-04-18",
          type: "delivery",
        }),
      ]),
    ];

    const flags = detectPastEndL2s(thisWeek, []);
    expect(flags[0].relatedPerson).toBe("Kathy");
  });

  it("scans both thisWeek and upcoming inputs", () => {
    const thisWeek: DayItem[] = [
      createDayItem("2026-04-15", [
        createDayItemEntry({
          id: "t1",
          title: "ThisWeekItem",
          account: "Convergix",
          status: "in-progress",
          startDate: "2026-04-10",
          endDate: "2026-04-15",
          type: "delivery",
        }),
      ]),
    ];
    const upcoming: DayItem[] = [
      createDayItem("2026-04-18", [
        createDayItemEntry({
          id: "u1",
          title: "UpcomingItem",
          account: "LPPC",
          status: "in-progress",
          startDate: "2026-04-15",
          endDate: "2026-04-18",
          type: "delivery",
        }),
      ]),
    ];

    const flags = detectPastEndL2s(thisWeek, upcoming);
    expect(flags).toHaveLength(2);
  });

  it("returns empty when no items are past-end", () => {
    const thisWeek: DayItem[] = [
      createDayItem("2026-04-25", [
        createDayItemEntry({
          id: "future",
          title: "Future",
          account: "Convergix",
          status: "in-progress",
          startDate: "2026-04-20",
          endDate: "2026-04-25",
          type: "delivery",
        }),
      ]),
    ];

    const flags = detectPastEndL2s(thisWeek, []);
    expect(flags).toHaveLength(0);
  });
});

describe("detectRetainerRenewals", () => {
  const TODAY = new Date("2026-04-21T12:00:00Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TODAY);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function plusDaysISO(days: number): string {
    const d = new Date(TODAY.getTime() + days * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  }

  it("fires on retainer with contract_end today (0 days out)", () => {
    const accounts: Account[] = [
      createAccount({
        items: [
          createTriageItem({ engagementType: "retainer", contractEnd: plusDaysISO(0) }),
        ],
      }),
    ];
    const flags = detectRetainerRenewals(accounts);
    expect(flags).toHaveLength(1);
    expect(flags[0].type).toBe("retainer-renewal");
    expect(flags[0].severity).toBe("warning");
  });

  it("fires on retainer with contract_end +15 days", () => {
    const accounts: Account[] = [
      createAccount({
        items: [
          createTriageItem({ engagementType: "retainer", contractEnd: plusDaysISO(15) }),
        ],
      }),
    ];
    expect(detectRetainerRenewals(accounts)).toHaveLength(1);
  });

  it("fires on retainer with contract_end +29 days (inclusive boundary)", () => {
    const accounts: Account[] = [
      createAccount({
        items: [
          createTriageItem({ engagementType: "retainer", contractEnd: plusDaysISO(29) }),
        ],
      }),
    ];
    expect(detectRetainerRenewals(accounts)).toHaveLength(1);
  });

  it("does not fire on retainer with contract_end +31 days (outside window)", () => {
    const accounts: Account[] = [
      createAccount({
        items: [
          createTriageItem({ engagementType: "retainer", contractEnd: plusDaysISO(31) }),
        ],
      }),
    ];
    expect(detectRetainerRenewals(accounts)).toHaveLength(0);
  });

  it("does not fire on non-retainer engagementType with near contract_end", () => {
    const accounts: Account[] = [
      createAccount({
        items: [
          createTriageItem({ engagementType: "project", contractEnd: plusDaysISO(10) }),
        ],
      }),
    ];
    expect(detectRetainerRenewals(accounts)).toHaveLength(0);
  });

  it("does not fire on retainer with no contract_end", () => {
    const accounts: Account[] = [
      createAccount({
        items: [
          createTriageItem({ engagementType: "retainer", contractEnd: null }),
        ],
      }),
    ];
    expect(detectRetainerRenewals(accounts)).toHaveLength(0);
  });

  it("does not fire on retainer whose contract_end is already past", () => {
    const accounts: Account[] = [
      createAccount({
        items: [
          createTriageItem({ engagementType: "retainer", contractEnd: plusDaysISO(-5) }),
        ],
      }),
    ];
    expect(detectRetainerRenewals(accounts)).toHaveLength(0);
  });
});

describe("detectContractExpired", () => {
  it("fires on expired client with ≥1 active L1", () => {
    const accounts: Account[] = [
      createAccount({
        contractStatus: "expired",
        items: [createTriageItem({ status: "in-production" })],
      }),
    ];
    const flags = detectContractExpired(accounts);
    expect(flags).toHaveLength(1);
    expect(flags[0].type).toBe("contract-expired");
    expect(flags[0].severity).toBe("warning");
  });

  it("fires on expired client with only blocked L1 (billing signal includes blocked)", () => {
    const accounts: Account[] = [
      createAccount({
        contractStatus: "expired",
        items: [createTriageItem({ status: "blocked" })],
      }),
    ];
    expect(detectContractExpired(accounts)).toHaveLength(1);
  });

  it("fires on expired client with awaiting-client L1 (per CONTRACT_EXPIRED_ACTIVE_STATUSES)", () => {
    const accounts: Account[] = [
      createAccount({
        contractStatus: "expired",
        items: [createTriageItem({ status: "awaiting-client" })],
      }),
    ];
    expect(detectContractExpired(accounts)).toHaveLength(1);
  });

  it("does not fire on expired client whose L1s are all completed", () => {
    const accounts: Account[] = [
      createAccount({
        contractStatus: "expired",
        items: [
          createTriageItem({ id: "a", status: "completed" }),
          createTriageItem({ id: "b", status: "on-hold" }),
        ],
      }),
    ];
    expect(detectContractExpired(accounts)).toHaveLength(0);
  });

  it("does not fire on signed client with active L1", () => {
    const accounts: Account[] = [
      createAccount({
        contractStatus: "signed",
        items: [createTriageItem({ status: "in-production" })],
      }),
    ];
    expect(detectContractExpired(accounts)).toHaveLength(0);
  });
});

describe("detectHierarchyDemotions", () => {
  it("does not fire on 2-tier wrapper + children (Convergix shape)", () => {
    const accounts: Account[] = [
      createAccount({
        items: [
          createTriageItem({ id: "wrapper", engagementType: "retainer" }),
          createTriageItem({ id: "child-1", parentProjectId: "wrapper" }),
          createTriageItem({ id: "child-2", parentProjectId: "wrapper" }),
        ],
      }),
    ];
    expect(detectHierarchyDemotions(accounts)).toHaveLength(0);
  });

  it("does not fire on standalone L1 with no parent", () => {
    const accounts: Account[] = [
      createAccount({
        items: [createTriageItem({ id: "solo", parentProjectId: null })],
      }),
    ];
    expect(detectHierarchyDemotions(accounts)).toHaveLength(0);
  });

  it("fires on 3-tier A → B → C (grandchild C flagged)", () => {
    const accounts: Account[] = [
      createAccount({
        items: [
          createTriageItem({ id: "A" }),
          createTriageItem({ id: "B", parentProjectId: "A" }),
          createTriageItem({ id: "C", parentProjectId: "B" }),
        ],
      }),
    ];
    const flags = detectHierarchyDemotions(accounts);
    expect(flags).toHaveLength(1);
    expect(flags[0].type).toBe("hierarchy-demotion");
    expect(flags[0].severity).toBe("warning");
    expect(flags[0].title).toContain("C");
  });

  it("does not fire when the grandparent link is unresolved in-account", () => {
    const accounts: Account[] = [
      createAccount({
        items: [
          // B's parentProjectId "missing" is not in this account -> no 3-tier chain.
          createTriageItem({ id: "B", parentProjectId: "missing" }),
          createTriageItem({ id: "C", parentProjectId: "B" }),
        ],
      }),
    ];
    expect(detectHierarchyDemotions(accounts)).toHaveLength(0);
  });
});

describe("detectWrapperCloseOut", () => {
  const TODAY = new Date("2026-04-23T12:00:00Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TODAY);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function plusDaysISO(days: number): string {
    const d = new Date(TODAY.getTime() + days * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  }

  function wrapperWithChildrenAccount(wrapperOverrides: Partial<TriageItem>): Account {
    return createAccount({
      items: [
        createTriageItem({
          id: "wrap",
          title: "Convergix Retainer",
          engagementType: "retainer",
          ...wrapperOverrides,
        }),
        createTriageItem({ id: "child-1", parentProjectId: "wrap" }),
      ],
    });
  }

  it("does NOT fire on contractEnd === today (handoff to detectRetainerRenewals on boundary day)", () => {
    const accounts = [
      wrapperWithChildrenAccount({ status: "in-production", contractEnd: plusDaysISO(0) }),
    ];
    // Predicate is `contractEnd < todayISO`. Boundary behavior: today is
    // the last day of the contract and is covered by detectRetainerRenewals
    // (0 days out). Close-out starts the day after — avoids double-flagging
    // the same wrapper on both detectors on the same day.
    expect(detectWrapperCloseOut(accounts)).toHaveLength(0);
  });

  it("fires when wrapper contractEnd is yesterday and status is in-production", () => {
    const accounts = [
      wrapperWithChildrenAccount({ status: "in-production", contractEnd: plusDaysISO(-1) }),
    ];
    const flags = detectWrapperCloseOut(accounts);
    expect(flags).toHaveLength(1);
    expect(flags[0].type).toBe("wrapper-close-out");
    expect(flags[0].severity).toBe("warning");
    expect(flags[0].title).toContain("Convergix Retainer");
  });

  it("does NOT fire when contractEnd is tomorrow", () => {
    const accounts = [
      wrapperWithChildrenAccount({ status: "in-production", contractEnd: plusDaysISO(1) }),
    ];
    expect(detectWrapperCloseOut(accounts)).toHaveLength(0);
  });

  it("does NOT fire when wrapper status is completed (already closed out)", () => {
    const accounts = [
      wrapperWithChildrenAccount({ status: "completed", contractEnd: plusDaysISO(-30) }),
    ];
    expect(detectWrapperCloseOut(accounts)).toHaveLength(0);
  });

  it("does NOT fire on standalone retainer with 0 children (not acting as wrapper)", () => {
    const accounts = [
      createAccount({
        items: [
          createTriageItem({
            id: "solo",
            title: "Standalone Retainer",
            engagementType: "retainer",
            status: "in-production",
            contractEnd: plusDaysISO(-30),
          }),
        ],
      }),
    ];
    expect(detectWrapperCloseOut(accounts)).toHaveLength(0);
  });

  it("does NOT fire on non-retainer engagementType even with children past contractEnd", () => {
    const accounts = [
      createAccount({
        items: [
          createTriageItem({
            id: "proj",
            engagementType: "project",
            status: "in-production",
            contractEnd: plusDaysISO(-30),
          }),
          createTriageItem({ id: "sub", parentProjectId: "proj" }),
        ],
      }),
    ];
    expect(detectWrapperCloseOut(accounts)).toHaveLength(0);
  });
});
