import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mockResults, resetMocks, createChainable,
  convergixClient, lppcClient, weekItemRows, pipelineRow, orphanPipelineRow,
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
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
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
