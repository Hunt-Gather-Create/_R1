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
});
