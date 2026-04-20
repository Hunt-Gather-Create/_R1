import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Account, DayItem, DayItemEntry, TriageItem } from "@/app/runway/types";
import { flagId, detectResourceConflicts, detectStaleItems, detectDeadlines, detectBottlenecks } from "./flags-detectors";

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
        createDayItemEntry({ owner: "Kathy", account: "Convergix" }),
        createDayItemEntry({ owner: "Kathy", account: "Convergix" }),
      ]),
      createDayItem("2026-04-08", [
        createDayItemEntry({ owner: "Kathy", account: "LPPC" }),
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

  it("skips items with no owner", () => {
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
});

describe("detectStaleItems", () => {
  it("flags items with staleDays >= 14 as warning", () => {
    const accounts: Account[] = [
      createAccount({
        items: [createTriageItem({ staleDays: 15 })],
      }),
    ];

    const flags = detectStaleItems(accounts);
    expect(flags).toHaveLength(1);
    expect(flags[0].severity).toBe("warning");
    expect(flags[0].type).toBe("stale");
  });

  it("flags items with staleDays >= 30 as critical", () => {
    const accounts: Account[] = [
      createAccount({
        items: [createTriageItem({ staleDays: 35 })],
      }),
    ];

    const flags = detectStaleItems(accounts);
    expect(flags).toHaveLength(1);
    expect(flags[0].severity).toBe("critical");
  });

  it("does not flag items with staleDays < 14", () => {
    const accounts: Account[] = [
      createAccount({
        items: [createTriageItem({ staleDays: 10 })],
      }),
    ];

    const flags = detectStaleItems(accounts);
    expect(flags).toHaveLength(0);
  });

  it("does not flag items with null staleDays", () => {
    const accounts: Account[] = [
      createAccount({
        items: [createTriageItem({ staleDays: undefined })],
      }),
    ];

    const flags = detectStaleItems(accounts);
    expect(flags).toHaveLength(0);
  });

  it("includes waitingOn in title when present", () => {
    const accounts: Account[] = [
      createAccount({
        items: [createTriageItem({ staleDays: 20, waitingOn: "Daniel" })],
      }),
    ];

    const flags = detectStaleItems(accounts);
    expect(flags[0].title).toContain("waiting on Daniel");
    expect(flags[0].relatedPerson).toBe("Daniel");
  });

  it("excludes completed projects even when staleDays >= 14", () => {
    const accounts: Account[] = [
      createAccount({
        items: [createTriageItem({ staleDays: 30, status: "completed" })],
      }),
    ];

    const flags = detectStaleItems(accounts);
    expect(flags).toHaveLength(0);
  });

  it("excludes on-hold projects even when staleDays >= 14", () => {
    const accounts: Account[] = [
      createAccount({
        items: [createTriageItem({ staleDays: 30, status: "on-hold" })],
      }),
    ];

    const flags = detectStaleItems(accounts);
    expect(flags).toHaveLength(0);
  });

  it("includes account name in detail", () => {
    const accounts: Account[] = [
      createAccount({
        name: "Convergix",
        items: [createTriageItem({ staleDays: 14 })],
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
});
