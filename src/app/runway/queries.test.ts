import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mockResults, resetMocks, createChainable,
  convergixClient, lppcClient, weekItemRows, pipelineRow, orphanPipelineRow,
  createWeekItem, createUpdate,
} from "./queries-test-helpers";

vi.mock("@/lib/db/runway", () => ({
  getRunwayDb: () => ({
    select: () => ({ from: vi.fn(() => createChainable()) }),
  }),
}));

vi.mock("@/lib/db/runway-schema", () => ({
  clients: { name: "clients", id: "id" },
  projects: { sortOrder: "sortOrder", clientId: "clientId" },
  weekItems: { weekOf: "weekOf", date: "date", sortOrder: "sortOrder" },
  pipelineItems: { sortOrder: "sortOrder", clientId: "clientId" },
  teamMembers: { isActive: "isActive" },
  updates: { createdAt: "createdAt" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  gte: vi.fn((a, b) => ({ gte: [a, b] })),
  lte: vi.fn((a, b) => ({ lte: [a, b] })),
  asc: vi.fn((col) => ({ asc: col })),
  desc: vi.fn((col) => ({ desc: col })),
}));

// queries.ts now imports getClientNameMap from operations for DRY
// Provide a mock that reads from mockResults like the DB mock does
vi.mock("@/lib/runway/operations", () => ({
  getClientNameMap: async () => {
    // The first chainable call in getWeekItems/getPipeline is the client list
    // We reuse convergixClient from helpers to build the map
    return new Map([["c1", "Convergix"]]);
  },
  groupBy: <T, K>(items: T[], keyFn: (item: T) => K) => {
    const map = new Map<K, T[]>();
    for (const item of items) {
      const key = keyFn(item);
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return map;
  },
}));

describe("getClientsWithProjects", () => {
  beforeEach(() => resetMocks());

  it("groups projects under their client", async () => {
    mockResults.push(
      [convergixClient, lppcClient],
      [
        { id: "p1", clientId: "c1", name: "CDS Messaging" },
        { id: "p2", clientId: "c1", name: "Website" },
        { id: "p3", clientId: "c2", name: "SEO" },
      ]
    );

    const { getClientsWithProjects } = await import("./queries");
    const result = await getClientsWithProjects();

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("Convergix");
    expect(result[0].items).toHaveLength(2);
    expect(result[1].name).toBe("LPPC");
    expect(result[1].items).toHaveLength(1);
  });

  it("returns empty items array for clients with no projects", async () => {
    mockResults.push([convergixClient], []);

    const { getClientsWithProjects } = await import("./queries");
    const result = await getClientsWithProjects();
    expect(result[0].items).toEqual([]);
  });
});

describe("getWeekItems", () => {
  beforeEach(() => resetMocks());

  it("groups items by date and formats day labels", async () => {
    mockResults.push(weekItemRows);

    const { getWeekItems } = await import("./queries");
    const result = await getWeekItems();

    expect(result).toHaveLength(2);
    expect(result[0].date).toBe("2026-04-06");
    expect(result[0].label).toContain("Mon");
    expect(result[0].items).toHaveLength(2);
    expect(result[0].items[0].title).toBe("CDS Review");
    expect(result[0].items[0].account).toBe("Convergix");
    expect(result[0].items[0].type).toBe("review");
    expect(result[0].items[1].notes).toBe("Final review");
    expect(result[1].date).toBe("2026-04-07");
    expect(result[1].items[0].account).toBe("");
    expect(result[1].items[0].owner).toBe("Jason");
  });

  it("returns empty array when no items exist", async () => {
    mockResults.push([]);

    const { getWeekItems } = await import("./queries");
    const result = await getWeekItems();
    expect(result).toEqual([]);
  });

  // v4: resolves blockedBy id array into {id, title, status} refs (chunk 3 #7).
  it("resolves blockedBy id array to in-scope blocker refs", async () => {
    mockResults.push([
      {
        id: "wi-blocker",
        date: "2026-04-06",
        dayOfWeek: "monday",
        title: "Copy Ready",
        clientId: "c1",
        category: "delivery",
        owner: "Kathy",
        status: "in-progress",
        notes: null,
        blockedBy: null,
      },
      {
        id: "wi-downstream",
        date: "2026-04-08",
        dayOfWeek: "wednesday",
        title: "Design Layout",
        clientId: "c1",
        category: "delivery",
        owner: "Lane",
        status: null,
        notes: null,
        blockedBy: '["wi-blocker","wi-missing"]',
      },
    ]);

    const { getWeekItems } = await import("./queries");
    const result = await getWeekItems();

    const downstream = result
      .flatMap((d) => d.items)
      .find((i) => i.title === "Design Layout");

    expect(downstream?.blockedBy).toEqual([
      { id: "wi-blocker", title: "Copy Ready", status: "in-progress" },
    ]);
  });

  it("drops blockedBy field when raw is null or empty", async () => {
    mockResults.push([
      {
        id: "wi-1",
        date: "2026-04-06",
        dayOfWeek: "monday",
        title: "Standalone",
        clientId: "c1",
        category: "delivery",
        owner: "Kathy",
        status: null,
        notes: null,
        blockedBy: null,
      },
    ]);

    const { getWeekItems } = await import("./queries");
    const result = await getWeekItems();
    expect(result[0].items[0].blockedBy).toBeUndefined();
  });
});

describe("getPipeline", () => {
  beforeEach(() => resetMocks());

  it("maps client names to pipeline items", async () => {
    mockResults.push([pipelineRow]);

    const { getPipeline } = await import("./queries");
    const result = await getPipeline();

    expect(result).toHaveLength(1);
    expect(result[0].accountName).toBe("Convergix");
    expect(result[0].name).toBe("New SOW");
  });

  it("returns null accountName when clientId is null", async () => {
    mockResults.push([orphanPipelineRow]);

    const { getPipeline } = await import("./queries");
    const result = await getPipeline();
    expect(result[0].accountName).toBeNull();
  });
});

describe("getStaleWeekItems", () => {
  beforeEach(() => resetMocks());

  it("returns items from yesterday with no updates", async () => {
    // Fix date to 2026-04-07 (Tuesday)
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T12:00:00"));

    // First query: week items for current week (weekOf = 2026-04-06)
    mockResults.push([createWeekItem({ date: "2026-04-06" })]);
    // Second query: updates
    mockResults.push([]);

    const { getStaleWeekItems } = await import("./queries");
    const result = await getStaleWeekItems();

    expect(result).toHaveLength(1);
    expect(result[0].date).toBe("2026-04-06");
    expect(result[0].items[0].title).toBe("CDS Review");
    expect(result[0].items[0].account).toBe("Convergix");

    vi.useRealTimers();
  });

  it("excludes items from yesterday that HAVE updates", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T12:00:00"));

    mockResults.push([createWeekItem({ date: "2026-04-06", projectId: "p1" })]);
    mockResults.push([createUpdate({ projectId: "p1", createdAt: new Date("2026-04-06T14:00:00") })]);

    const { getStaleWeekItems } = await import("./queries");
    const result = await getStaleWeekItems();

    expect(result).toHaveLength(0);

    vi.useRealTimers();
  });

  it("excludes items from today", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T12:00:00"));

    // Only today's items, no past items
    mockResults.push([createWeekItem({ date: "2026-04-07" })]);
    // updates won't be queried since pastItems is empty

    const { getStaleWeekItems } = await import("./queries");
    const result = await getStaleWeekItems();

    expect(result).toHaveLength(0);

    vi.useRealTimers();
  });

  it("excludes future items", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T12:00:00"));

    mockResults.push([createWeekItem({ date: "2026-04-09" })]);

    const { getStaleWeekItems } = await import("./queries");
    const result = await getStaleWeekItems();

    expect(result).toHaveLength(0);

    vi.useRealTimers();
  });

  it("returns empty array when no week items exist", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T12:00:00"));

    mockResults.push([]);

    const { getStaleWeekItems } = await import("./queries");
    const result = await getStaleWeekItems();

    expect(result).toEqual([]);

    vi.useRealTimers();
  });

  it("includes overdue items from previous weeks", async () => {
    vi.useFakeTimers();
    // It's now Tuesday of a NEW week (2026-04-14 week)
    vi.setSystemTime(new Date("2026-04-14T12:00:00"));

    // lte(weekOf, "2026-04-13") returns items from previous weeks too
    mockResults.push([
      createWeekItem({ date: "2026-04-09", weekOf: "2026-04-06" }), // last week Thursday
    ]);
    // updates query
    mockResults.push([]);

    const { getStaleWeekItems } = await import("./queries");
    const result = await getStaleWeekItems();

    // Item from last week should appear since it's past-due and has no update
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe("2026-04-09");

    vi.useRealTimers();
  });

  it("excludes overdue items from previous weeks that have updates", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-14T12:00:00"));

    mockResults.push([
      createWeekItem({ date: "2026-04-09", weekOf: "2026-04-06", projectId: "p1" }),
    ]);
    // Update after the item's date — project has been updated
    mockResults.push([createUpdate({ projectId: "p1", createdAt: new Date("2026-04-10T10:00:00") })]);

    const { getStaleWeekItems } = await import("./queries");
    const result = await getStaleWeekItems();

    expect(result).toHaveLength(0);

    vi.useRealTimers();
  });

  it("excludes completed items even when past-due with no update", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T12:00:00"));

    // Past-due item with status='completed' — should be excluded regardless of updates
    mockResults.push([createWeekItem({ date: "2026-04-06", status: "completed" })]);
    mockResults.push([]);

    const { getStaleWeekItems } = await import("./queries");
    const result = await getStaleWeekItems();

    expect(result).toHaveLength(0);

    vi.useRealTimers();
  });

  it("treats items without projectId as always stale", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T12:00:00"));

    // Item with no projectId — should always be stale regardless of updates
    mockResults.push([createWeekItem({ date: "2026-04-06", projectId: null })]);
    mockResults.push([]);

    const { getStaleWeekItems } = await import("./queries");
    const result = await getStaleWeekItems();

    expect(result).toHaveLength(1);
    expect(result[0].items[0].title).toBe("CDS Review");

    vi.useRealTimers();
  });

  // 4b: confirm the updates query is gated by a 30-day lookback
  // (full-table scans on the updates table were the prior behavior).
  it("filters the updates query to the last 30 days via gte", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T12:00:00"));

    mockResults.push([createWeekItem({ date: "2026-04-06" })]);
    mockResults.push([]);

    const { gte } = await import("drizzle-orm");
    (gte as unknown as ReturnType<typeof vi.fn>).mockClear();

    const { getStaleWeekItems } = await import("./queries");
    await getStaleWeekItems();

    // gte fires twice: once for week-item lookback and once for updates.
    // The updates call passes a Date (not a YYYY-MM-DD string) and lands
    // ~30 days before "now".
    const dateCalls = (gte as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter((call: unknown[]) => call[1] instanceof Date);
    expect(dateCalls.length).toBeGreaterThan(0);
    const cutoff = dateCalls[0][1] as Date;
    const now = Date.now();
    const expected = now - 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(2_000);

    vi.useRealTimers();
  });

  // 4a: nested-loop fix — confirm correctness with multiple updates per
  // project and updates that predate the item (should not mark as covered).
  it("excludes items whose only updates predate the item date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T12:00:00"));

    mockResults.push([createWeekItem({ date: "2026-04-06", projectId: "p1" })]);
    // Two updates for p1: one before the item date, one... still before.
    // Neither covers the item, so it stays stale.
    mockResults.push([
      createUpdate({ projectId: "p1", createdAt: new Date("2026-04-04T09:00:00") }),
      createUpdate({ projectId: "p1", createdAt: new Date("2026-04-05T15:00:00") }),
    ]);

    const { getStaleWeekItems } = await import("./queries");
    const result = await getStaleWeekItems();

    expect(result).toHaveLength(1);
    expect(result[0].items[0].title).toBe("CDS Review");

    vi.useRealTimers();
  });
});

// ── Real-filter coverage for the 30-day update lookback ──────────────
//
// The "filters the updates query to the last 30 days via gte" test above
// verifies the SQL signature (gte called with a Date ~30d ago) but the
// chainable mock ignores where clauses entirely — push to mockResults and
// the rows come back regardless of any filter. So that test would still
// PASS if someone deleted the gte call from queries.ts.
//
// This describe block wires up a smarter mock that actually APPLIES the
// gte filter against seeded update rows. It uses vi.doMock + resetModules
// to swap in an alternate getRunwayDb just for these tests, then re-imports
// queries.ts so the new mock binds.
//
// Two paired tests prove the filter outcome both ways:
//   1. Old update (60d ago) gets filtered out → item is stale.
//   2. Recent update (5d ago) passes through → item is covered (not stale).
//
// If the gte call is removed from queries.ts, test #1 fails: the old update
// is no longer filtered, marks the project as covered, and the item drops
// out of the stale list.
describe("getStaleWeekItems — 30d update lookback (real-filter)", () => {
  // Updates fed to the smart chainable on a per-test basis.
  let updateFixtures: Array<ReturnType<typeof createUpdate>> = [];
  // Week items fed to the smart chainable on a per-test basis.
  let weekItemFixtures: Array<ReturnType<typeof createWeekItem>> = [];

  beforeEach(() => {
    updateFixtures = [];
    weekItemFixtures = [];
    vi.resetModules();
  });

  it("filters out updates older than the 30-day cutoff (item stays stale)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T12:00:00"));

    // Past-due item from ~52 days ago, project p1. (The DB-level weekOf
    // lookback would normally exclude this; the mock chainable skips that
    // filter so we can isolate the updates-side gte behavior.)
    weekItemFixtures = [
      createWeekItem({
        date: "2026-02-15",
        weekOf: "2026-02-09",
        projectId: "p1",
      }),
    ];
    // ONE update for p1, dated 5 days AFTER the item but ~46 days before
    // "now" — outside the 30d window. With the gte filter the update gets
    // dropped, leaving p1 with no recent coverage, so the item appears
    // stale. WITHOUT the filter, this ancient update slips through,
    // satisfies `latest >= item.date`, marks p1 as covered, and the item
    // disappears from the stale list.
    updateFixtures = [
      createUpdate({
        projectId: "p1",
        createdAt: new Date("2026-02-20T14:00:00"),
      }),
    ];

    // Re-mock @/lib/db/runway with a chainable that introspects the where
    // clause and actually applies the gte filter against updateFixtures.
    // This is intentionally local to this describe block; the file-level
    // mock is overridden via vi.doMock + vi.resetModules + dynamic import.
    vi.doMock("@/lib/db/runway", () => ({
      getRunwayDb: () => ({
        select: () => ({
          from: (table: unknown) => createSmartChainable(table),
        }),
      }),
    }));

    function createSmartChainable(table: unknown) {
      // The schema mock identifies tables by reference. updates table has
      // shape { createdAt: "createdAt" }; weekItems has shape {
      // weekOf: "weekOf", date: "date", sortOrder: "sortOrder" }.
      const isUpdatesTable =
        table != null &&
        typeof table === "object" &&
        "createdAt" in (table as Record<string, unknown>) &&
        !("weekOf" in (table as Record<string, unknown>));

      let capturedWhere: unknown = null;

      const chainable: Record<string, unknown> = {
        where: vi.fn((arg: unknown) => {
          capturedWhere = arg;
          return chainable;
        }),
        orderBy: vi.fn(() => chainable),
        then: (resolve: (v: unknown) => void) => {
          if (!isUpdatesTable) {
            resolve(weekItemFixtures);
            return;
          }
          // Apply the gte filter to updateFixtures using the captured
          // where clause. The drizzle-orm mock returns gte calls as
          // { gte: [column, cutoffDate] }. If the caller wrapped in and(),
          // it becomes { and: [{ gte: [...] }, ...] }. We accept either
          // shape for robustness.
          const gteClauses = extractGteClauses(capturedWhere);
          const filtered = updateFixtures.filter((row) => {
            for (const clause of gteClauses) {
              const [, cutoff] = clause;
              if (cutoff instanceof Date && row.createdAt < cutoff) {
                return false;
              }
            }
            return true;
          });
          resolve(filtered);
        },
      };
      return chainable;
    }

    function extractGteClauses(
      where: unknown
    ): Array<[unknown, unknown]> {
      if (where == null || typeof where !== "object") return [];
      const obj = where as Record<string, unknown>;
      if ("gte" in obj && Array.isArray(obj.gte)) {
        return [obj.gte as [unknown, unknown]];
      }
      if ("and" in obj && Array.isArray(obj.and)) {
        return (obj.and as unknown[]).flatMap((sub) => extractGteClauses(sub));
      }
      return [];
    }

    const { getStaleWeekItems } = await import("./queries");
    const result = await getStaleWeekItems();

    // The 46-day-old update is filtered out by gte, so p1 has no recent
    // coverage and the past-due item is reported as stale.
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe("2026-02-15");
    expect(result[0].items[0].title).toBe("CDS Review");

    vi.useRealTimers();
    vi.doUnmock("@/lib/db/runway");
  });

  it("keeps recent updates inside the 30-day window (item is covered, not stale)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T12:00:00"));

    weekItemFixtures = [createWeekItem({ date: "2026-04-06", projectId: "p1" })];
    // Recent update (5d ago) — well inside the 30d window — should pass
    // through the gte filter and mark p1 as covered, dropping the item
    // from the stale list. This is the paired sanity check confirming the
    // filter is not over-eager.
    updateFixtures = [
      createUpdate({
        projectId: "p1",
        createdAt: new Date("2026-04-06T14:00:00"),
      }),
    ];

    vi.doMock("@/lib/db/runway", () => ({
      getRunwayDb: () => ({
        select: () => ({
          from: (table: unknown) => createSmartChainable(table),
        }),
      }),
    }));

    function createSmartChainable(table: unknown) {
      const isUpdatesTable =
        table != null &&
        typeof table === "object" &&
        "createdAt" in (table as Record<string, unknown>) &&
        !("weekOf" in (table as Record<string, unknown>));

      let capturedWhere: unknown = null;

      const chainable: Record<string, unknown> = {
        where: vi.fn((arg: unknown) => {
          capturedWhere = arg;
          return chainable;
        }),
        orderBy: vi.fn(() => chainable),
        then: (resolve: (v: unknown) => void) => {
          if (!isUpdatesTable) {
            resolve(weekItemFixtures);
            return;
          }
          const gteClauses = extractGteClauses(capturedWhere);
          const filtered = updateFixtures.filter((row) => {
            for (const clause of gteClauses) {
              const [, cutoff] = clause;
              if (cutoff instanceof Date && row.createdAt < cutoff) {
                return false;
              }
            }
            return true;
          });
          resolve(filtered);
        },
      };
      return chainable;
    }

    function extractGteClauses(
      where: unknown
    ): Array<[unknown, unknown]> {
      if (where == null || typeof where !== "object") return [];
      const obj = where as Record<string, unknown>;
      if ("gte" in obj && Array.isArray(obj.gte)) {
        return [obj.gte as [unknown, unknown]];
      }
      if ("and" in obj && Array.isArray(obj.and)) {
        return (obj.and as unknown[]).flatMap((sub) => extractGteClauses(sub));
      }
      return [];
    }

    const { getStaleWeekItems } = await import("./queries");
    const result = await getStaleWeekItems();

    // Recent update slips through the gte filter and marks p1 as covered.
    // The item is excluded from the stale list.
    expect(result).toHaveLength(0);

    vi.useRealTimers();
    vi.doUnmock("@/lib/db/runway");
  });
});
