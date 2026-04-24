/**
 * Tests for operations-reads barrel module.
 *
 * The read operations are split across three files for maintainability:
 *   - operations-reads-clients.ts (getClientsWithCounts, getProjectsFiltered, getPersonWorkload)
 *   - operations-reads-week.ts (getWeekItemsData, getStaleItemsForAccounts)
 *   - operations-reads-pipeline.ts (getPipelineData)
 *
 * This test file covers all split modules via the barrel re-export in operations-reads.ts.
 * Tests are not duplicated in per-file test files — this is the canonical location.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockSelectFrom = vi.fn();
const mockGetAllClients = vi.fn();
const mockGetClientNameMap = vi.fn();

vi.mock("@/lib/db/runway", () => ({ getRunwayDb: () => ({ select: () => ({ from: mockSelectFrom }) }) }));
vi.mock("@/lib/db/runway-schema", () => ({
  clients: { id: "id", contractStatus: "contractStatus" },
  projects: { sortOrder: "sortOrder", clientId: "clientId" },
  weekItems: { weekOf: "weekOf", date: "date", sortOrder: "sortOrder", projectId: "projectId" },
  pipelineItems: { sortOrder: "sortOrder" },
  updates: { clientId: "clientId", createdAt: "createdAt" },
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
  asc: vi.fn((col) => ({ asc: col })),
  desc: vi.fn((col) => ({ desc: col })),
}));
const mockGetClientBySlug = vi.fn();

vi.mock("./operations", () => ({
  getAllClients: (...args: unknown[]) => mockGetAllClients(...args),
  getClientNameMap: (...args: unknown[]) => mockGetClientNameMap(...args),
  getClientBySlug: (...args: unknown[]) => mockGetClientBySlug(...args),
  matchesSubstring: (value: string | null | undefined, search: string) => {
    if (!value) return false;
    return value.toLowerCase().includes(search.toLowerCase());
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

function chainable(data: unknown[]) {
  const obj: Record<string, unknown> = {
    orderBy: vi.fn(() => chainable(data)),
    where: vi.fn(() => chainable(data)),
    then: (resolve: (v: unknown) => void) => resolve(data),
  };
  return obj;
}

const clients = [
  { id: "c1", name: "Convergix", slug: "convergix", contractValue: "$120k", contractStatus: "signed", contractTerm: "Annual", team: "Jason" },
  { id: "c2", name: "LPPC", slug: "lppc", contractValue: null, contractStatus: "unsigned", contractTerm: null, team: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAllClients.mockResolvedValue(clients);
  mockGetClientNameMap.mockResolvedValue(new Map([["c1", "Convergix"], ["c2", "LPPC"]]));
  mockGetClientBySlug.mockImplementation(async (slug: string) => {
    const map: Record<string, typeof clients[0]> = {
      convergix: clients[0],
      lppc: clients[1],
    };
    return map[slug] ?? null;
  });
});

describe("getClientsWithCounts", () => {
  it("counts projects per client", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { clientId: "c1" }, { clientId: "c1" }, { clientId: "c2" },
    ]));
    const { getClientsWithCounts } = await import("./operations-reads");
    const result = await getClientsWithCounts();
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("Convergix");
    expect(result[0].projectCount).toBe(2);
    expect(result[1].projectCount).toBe(1);
  });

  it("returns 0 for clients with no projects", async () => {
    mockSelectFrom.mockReturnValue(chainable([]));
    const { getClientsWithCounts } = await import("./operations-reads");
    const result = await getClientsWithCounts();
    expect(result[0].projectCount).toBe(0);
  });
});

describe("getProjectsFiltered", () => {
  it("returns all projects when no filters", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { clientId: "c1", name: "CDS", status: "in-production", category: "active", owner: "Kathy", waitingOn: null, notes: null, staleDays: null },
    ]));
    const { getProjectsFiltered } = await import("./operations-reads");
    const result = await getProjectsFiltered();
    expect(result).toHaveLength(1);
    expect(result[0].client).toBe("Convergix");
  });

  it("filters by clientSlug", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { clientId: "c1", name: "CDS", status: "active" },
      { clientId: "c2", name: "SEO", status: "active" },
    ]));
    const { getProjectsFiltered } = await import("./operations-reads");
    const result = await getProjectsFiltered({ clientSlug: "convergix" });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("CDS");
  });

  it("filters by status", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { clientId: "c1", name: "CDS", status: "in-production" },
      { clientId: "c1", name: "Website", status: "blocked" },
    ]));
    const { getProjectsFiltered } = await import("./operations-reads");
    const result = await getProjectsFiltered({ status: "blocked" });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Website");
  });

  it("returns Unknown for unmatched clientId", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { clientId: "unknown-id", name: "Orphan", status: "active" },
    ]));
    const { getProjectsFiltered } = await import("./operations-reads");
    const result = await getProjectsFiltered();
    expect(result[0].client).toBe("Unknown");
  });
});

describe("getWeekItemsData", () => {
  it("maps client names to items", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { date: "2026-04-06", dayOfWeek: "monday", title: "Review", clientId: "c1", category: "review", owner: "Kathy", notes: null },
    ]));
    const { getWeekItemsData } = await import("./operations-reads");
    const result = await getWeekItemsData();
    expect(result[0].account).toBe("Convergix");
    expect(result[0].title).toBe("Review");
  });

  it("returns null account when clientId is null", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { date: "2026-04-06", dayOfWeek: "monday", title: "Internal", clientId: null, category: "delivery", owner: null, notes: null },
    ]));
    const { getWeekItemsData } = await import("./operations-reads");
    const result = await getWeekItemsData();
    expect(result[0].account).toBeNull();
  });

  it("returns empty array when no items", async () => {
    mockSelectFrom.mockReturnValue(chainable([]));
    const { getWeekItemsData } = await import("./operations-reads");
    const result = await getWeekItemsData();
    expect(result).toEqual([]);
  });
});

describe("getProjectsFiltered — combined filters", () => {
  it("filters by both clientSlug and status", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { clientId: "c1", name: "CDS", status: "in-production" },
      { clientId: "c1", name: "Website", status: "blocked" },
      { clientId: "c2", name: "SEO", status: "in-production" },
    ]));
    const { getProjectsFiltered } = await import("./operations-reads");
    const result = await getProjectsFiltered({ clientSlug: "convergix", status: "blocked" });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Website");
  });

  it("returns empty when filters match nothing", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { clientId: "c1", name: "CDS", status: "in-production" },
    ]));
    const { getProjectsFiltered } = await import("./operations-reads");
    const result = await getProjectsFiltered({ clientSlug: "convergix", status: "completed" });
    expect(result).toEqual([]);
  });

  it("ignores unknown clientSlug filter gracefully", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { clientId: "c1", name: "CDS", status: "active" },
    ]));
    const { getProjectsFiltered } = await import("./operations-reads");
    // Unknown slug means clientBySlug.get returns undefined, so no filtering happens
    const result = await getProjectsFiltered({ clientSlug: "nonexistent" });
    expect(result).toHaveLength(1);
  });
});

describe("getWeekItemsData — weekOf parameter", () => {
  it("passes weekOf to query when provided", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { date: "2026-04-06", dayOfWeek: "monday", title: "Review", clientId: "c1", category: "review", owner: null, notes: null },
    ]));
    const { getWeekItemsData } = await import("./operations-reads");
    const result = await getWeekItemsData("2026-04-06");
    expect(result).toHaveLength(1);
  });

  it("returns empty when weekOf matches no items", async () => {
    mockSelectFrom.mockReturnValue(chainable([]));
    const { getWeekItemsData } = await import("./operations-reads");
    const result = await getWeekItemsData("2030-01-01");
    expect(result).toEqual([]);
  });
});

describe("getClientsWithCounts — edge cases", () => {
  it("handles projects with unknown clientId", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { clientId: "unknown-id" },
    ]));
    const { getClientsWithCounts } = await import("./operations-reads");
    const result = await getClientsWithCounts();
    // Both known clients get 0 because the project's clientId doesn't match
    expect(result[0].projectCount).toBe(0);
    expect(result[1].projectCount).toBe(0);
  });
});

describe("getProjectsFiltered — owner filter", () => {
  it("filters by owner (case-insensitive substring)", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { clientId: "c1", name: "CDS", status: "in-production", owner: "Kathy/Lane", waitingOn: null, notes: null, staleDays: null },
      { clientId: "c1", name: "Website", status: "active", owner: "Leslie", waitingOn: null, notes: null, staleDays: null },
    ]));
    const { getProjectsFiltered } = await import("./operations-reads");
    const result = await getProjectsFiltered({ owner: "Kathy" });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("CDS");
  });

  it("matches partial owner names (e.g. 'Kathy' in 'Kathy/Lane')", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { clientId: "c1", name: "CDS", status: "in-production", owner: "Kathy/Lane", waitingOn: null, notes: null, staleDays: null },
    ]));
    const { getProjectsFiltered } = await import("./operations-reads");
    const result = await getProjectsFiltered({ owner: "lane" });
    expect(result).toHaveLength(1);
  });

  it("returns empty when owner matches nothing", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { clientId: "c1", name: "CDS", status: "in-production", owner: "Kathy", waitingOn: null, notes: null, staleDays: null },
    ]));
    const { getProjectsFiltered } = await import("./operations-reads");
    const result = await getProjectsFiltered({ owner: "Nobody" });
    expect(result).toEqual([]);
  });
});

describe("getProjectsFiltered — waitingOn filter", () => {
  it("filters by waitingOn (case-insensitive substring)", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { clientId: "c1", name: "Brochure", status: "awaiting-client", owner: null, waitingOn: "Daniel", notes: null, staleDays: null },
      { clientId: "c1", name: "Website", status: "active", owner: null, waitingOn: null, notes: null, staleDays: null },
    ]));
    const { getProjectsFiltered } = await import("./operations-reads");
    const result = await getProjectsFiltered({ waitingOn: "daniel" });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Brochure");
  });

  it("matches partial waitingOn (e.g. 'Daniel' in 'Daniel/Nicole')", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { clientId: "c1", name: "Templates", status: "awaiting-client", owner: null, waitingOn: "Daniel/Nicole", notes: null, staleDays: null },
    ]));
    const { getProjectsFiltered } = await import("./operations-reads");
    const result = await getProjectsFiltered({ waitingOn: "Nicole" });
    expect(result).toHaveLength(1);
  });
});

describe("getWeekItemsData — owner filter", () => {
  it("filters week items by owner", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { date: "2026-04-06", dayOfWeek: "monday", title: "CDS Review", clientId: "c1", category: "review", owner: "Kathy", notes: null },
      { date: "2026-04-06", dayOfWeek: "monday", title: "Map R2", clientId: "c2", category: "delivery", owner: "Leslie", notes: null },
    ]));
    const { getWeekItemsData } = await import("./operations-reads");
    const result = await getWeekItemsData(undefined, "Kathy");
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("CDS Review");
  });

  it("returns empty when owner filter matches nothing", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { date: "2026-04-06", dayOfWeek: "monday", title: "CDS Review", clientId: "c1", category: "review", owner: "Kathy", notes: null },
    ]));
    const { getWeekItemsData } = await import("./operations-reads");
    const result = await getWeekItemsData(undefined, "Nobody");
    expect(result).toEqual([]);
  });

  it("combines weekOf and owner filters", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { date: "2026-04-06", dayOfWeek: "monday", title: "CDS Review", clientId: "c1", category: "review", owner: "Kathy", notes: null },
      { date: "2026-04-06", dayOfWeek: "monday", title: "Map R2", clientId: "c2", category: "delivery", owner: "Leslie", notes: null },
    ]));
    const { getWeekItemsData } = await import("./operations-reads");
    const result = await getWeekItemsData("2026-04-06", "Kathy");
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("CDS Review");
  });
});

describe("getWeekItemsData — resource filter", () => {
  it("filters by resource (case-insensitive substring)", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { date: "2026-04-06", dayOfWeek: "monday", title: "CDS Review", clientId: "c1", category: "review", owner: "Kathy", resources: "Roz, Lane", notes: null },
      { date: "2026-04-06", dayOfWeek: "monday", title: "Map R2", clientId: "c2", category: "delivery", owner: "Ronan", resources: "Leslie", notes: null },
    ]));
    const { getWeekItemsData } = await import("./operations-reads");
    const result = await getWeekItemsData(undefined, undefined, "Roz");
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("CDS Review");
  });

  it("combines owner and resource filters", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { date: "2026-04-06", dayOfWeek: "monday", title: "CDS Review", clientId: "c1", category: "review", owner: "Kathy", resources: "Roz, Lane", notes: null },
      { date: "2026-04-06", dayOfWeek: "monday", title: "Map R2", clientId: "c2", category: "delivery", owner: "Kathy", resources: "Leslie", notes: null },
    ]));
    const { getWeekItemsData } = await import("./operations-reads");
    const result = await getWeekItemsData(undefined, "Kathy", "Leslie");
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Map R2");
  });

  it("includes resources in returned data", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { date: "2026-04-06", dayOfWeek: "monday", title: "CDS Review", clientId: "c1", category: "review", owner: "Kathy", resources: "Roz, Lane", notes: null },
    ]));
    const { getWeekItemsData } = await import("./operations-reads");
    const result = await getWeekItemsData();
    expect(result[0].resources).toBe("Roz, Lane");
  });
});

describe("getWeekItemsData — person filter (owner OR resource)", () => {
  it("matches items where person is owner OR resource", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      // Kathy as owner, not in resources
      { date: "2026-04-06", dayOfWeek: "monday", title: "CDS Review", clientId: "c1", category: "review", owner: "Kathy", resources: "Lane", notes: null },
      // Kathy in resources, not owner
      { date: "2026-04-07", dayOfWeek: "tuesday", title: "Impact Handoff", clientId: "c2", category: "delivery", owner: "Ronan", resources: "Kathy, Leslie", notes: null },
      // Not Kathy anywhere
      { date: "2026-04-08", dayOfWeek: "wednesday", title: "Map R2", clientId: "c2", category: "delivery", owner: "Ronan", resources: "Leslie", notes: null },
    ]));
    const { getWeekItemsData } = await import("./operations-reads");
    const result = await getWeekItemsData(undefined, undefined, undefined, "Kathy");
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.title).sort()).toEqual(["CDS Review", "Impact Handoff"]);
  });

  it("is case-insensitive", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { date: "2026-04-06", dayOfWeek: "monday", title: "CDS", clientId: "c1", category: "review", owner: "KATHY", resources: null, notes: null },
    ]));
    const { getWeekItemsData } = await import("./operations-reads");
    const result = await getWeekItemsData(undefined, undefined, undefined, "kathy");
    expect(result).toHaveLength(1);
  });

  it("returns empty array when person matches nothing", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { date: "2026-04-06", dayOfWeek: "monday", title: "CDS Review", clientId: "c1", category: "review", owner: "Kathy", resources: "Lane", notes: null },
    ]));
    const { getWeekItemsData } = await import("./operations-reads");
    const result = await getWeekItemsData(undefined, undefined, undefined, "Nobody");
    expect(result).toEqual([]);
  });

  it("combines weekOf and person filters (AND)", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { date: "2026-04-06", dayOfWeek: "monday", title: "Match", clientId: "c1", category: "review", owner: "Ronan", resources: "Kathy", notes: null },
      { date: "2026-04-06", dayOfWeek: "monday", title: "No", clientId: "c1", category: "review", owner: "Lane", resources: null, notes: null },
    ]));
    const { getWeekItemsData } = await import("./operations-reads");
    const result = await getWeekItemsData("2026-04-06", undefined, undefined, "Kathy");
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Match");
  });
});

describe("getPersonWorkload (v4 contract)", () => {
  // Fixed Monday 2026-04-20 (CDT). thisWeek: 04-20..04-26, nextWeek: 04-27..05-03.
  const NOW = new Date("2026-04-20T17:00:00Z");

  it("returns owned L1s and bucketed week items, with contract expiry flag", async () => {
    // Projects, weekItems, clients issued via Promise.all — mock in that order.
    let callCount = 0;
    mockSelectFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // projects
        return chainable([
          { id: "p1", clientId: "c1", name: "CDS", status: "in-production", owner: "Kathy", resources: null, notes: "Gate", engagementType: "project", contractEnd: null, startDate: null, endDate: null, staleDays: null, sortOrder: 0 },
          { id: "p2", clientId: "c2", name: "Map", status: "in-production", owner: "Leslie", resources: null, notes: null, engagementType: "project", contractEnd: null, startDate: null, endDate: null, staleDays: null, sortOrder: 0 },
        ]);
      }
      if (callCount === 2) {
        // week items
        return chainable([
          { id: "w1", projectId: "p1", clientId: "c1", startDate: "2026-04-22", endDate: null, date: "2026-04-22", title: "CDS Review", owner: "Kathy", resources: null, category: "review", notes: null, status: null, sortOrder: 0, dayOfWeek: "wed", weekOf: "2026-04-20", blockedBy: null, createdAt: new Date(), updatedAt: new Date() },
        ]);
      }
      // clients
      return chainable([
        { id: "c1", name: "Convergix", slug: "convergix", contractStatus: "signed" },
        { id: "c2", name: "LPPC", slug: "lppc", contractStatus: "signed" },
      ]);
    });

    const { getPersonWorkload } = await import("./operations-reads");
    const result = await getPersonWorkload("Kathy", { now: NOW });
    expect(result.person).toBe("Kathy");
    expect(result.ownedProjects.inProgress.map((p) => p.id)).toEqual(["p1"]);
    expect(result.weekItems.thisWeek.map((i) => i.id)).toEqual(["w1"]);
    expect(result.totalProjects).toBe(1);
    expect(result.totalActiveWeekItems).toBe(1);
    expect(result.flags.contractExpired).toEqual([]);
  });

  it("matches L2 items where person is a resource but not owner; L1 owner-only", async () => {
    let callCount = 0;
    mockSelectFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Roz is a resource on CDS but not the owner — should NOT surface L1.
        return chainable([
          { id: "p1", clientId: "c1", name: "CDS", status: "in-production", owner: "Kathy", resources: "Roz, Lane", notes: null, engagementType: null, contractEnd: null, startDate: null, endDate: null, staleDays: null, sortOrder: 0 },
        ]);
      }
      if (callCount === 2) {
        return chainable([
          { id: "w1", projectId: "p1", clientId: "c1", startDate: "2026-04-22", endDate: null, date: "2026-04-22", title: "CDS Review", owner: "Kathy", resources: "Roz", category: "review", notes: null, status: null, sortOrder: 0, dayOfWeek: "wed", weekOf: "2026-04-20", blockedBy: null, createdAt: new Date(), updatedAt: new Date() },
        ]);
      }
      return chainable([]);
    });

    const { getPersonWorkload } = await import("./operations-reads");
    const result = await getPersonWorkload("Roz", { now: NOW });
    // Owner-only: Roz does not own any L1.
    expect(result.ownedProjects.inProgress).toHaveLength(0);
    expect(result.totalProjects).toBe(0);
    // But week item matches on resources.
    expect(result.weekItems.thisWeek.map((i) => i.id)).toEqual(["w1"]);
    expect(result.totalActiveWeekItems).toBe(1);
  });

  it("returns empty contract shape for person with no assignments", async () => {
    mockSelectFrom.mockReturnValue(chainable([]));
    const { getPersonWorkload } = await import("./operations-reads");
    const result = await getPersonWorkload("Nobody", { now: NOW });
    expect(result.totalProjects).toBe(0);
    expect(result.totalActiveWeekItems).toBe(0);
    expect(result.ownedProjects).toEqual({
      inProgress: [],
      awaitingClient: [],
      blocked: [],
      onHold: [],
      completed: [],
    });
    expect(result.weekItems).toEqual({
      overdue: [],
      thisWeek: [],
      nextWeek: [],
      later: [],
    });
    expect(result.flags).toEqual({ contractExpired: [], retainerRenewalDue: [] });
  });
});

describe("getPipelineData", () => {
  it("maps client names to pipeline items", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { clientId: "c1", name: "New SOW", status: "sow-sent", estimatedValue: "$50k", waitingOn: "Daniel", notes: null },
    ]));
    const { getPipelineData } = await import("./operations-reads");
    const result = await getPipelineData();
    expect(result[0].account).toBe("Convergix");
    expect(result[0].name).toBe("New SOW");
  });

  it("returns null account when clientId is null", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { clientId: null, name: "Orphan", status: "at-risk", estimatedValue: "TBD", waitingOn: null, notes: null },
    ]));
    const { getPipelineData } = await import("./operations-reads");
    const result = await getPipelineData();
    expect(result[0].account).toBeNull();
  });
});

describe("getStaleItemsForAccounts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T12:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns stale projects (updatedAt-based staleness)", async () => {
    const tenDaysAgo = new Date("2026-04-07T12:00:00");
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
    let callCount = 0;
    mockSelectFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // projects for convergix
        return chainable([
          { id: "p1", clientId: "c1", name: "CDS Messaging", status: "in-production", sortOrder: 0, updatedAt: tenDaysAgo },
        ]);
      }
      // updates for convergix
      return chainable([]);
    });

    const { getStaleItemsForAccounts } = await import("./operations-reads");
    const result = await getStaleItemsForAccounts(["convergix"]);

    expect(result).toHaveLength(1);
    expect(result[0].clientName).toBe("Convergix");
    expect(result[0].projectName).toBe("CDS Messaging");
    expect(result[0].staleDays).toBe(10);
  });

  it("excludes completed projects", async () => {
    mockSelectFrom.mockImplementation(() =>
      chainable([
        { id: "p1", clientId: "c1", name: "Done", status: "completed", staleDays: 30, sortOrder: 0 },
      ])
    );

    const { getStaleItemsForAccounts } = await import("./operations-reads");
    const result = await getStaleItemsForAccounts(["convergix"]);

    expect(result).toHaveLength(0);
  });

  it("excludes recently updated projects", async () => {
    let callCount = 0;
    mockSelectFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return chainable([
          { id: "p1", clientId: "c1", name: "Fresh", status: "in-production", staleDays: 0, sortOrder: 0 },
        ]);
      }
      // recent update (within 7 days)
      return chainable([
        { id: "u1", projectId: "p1", clientId: "c1", createdAt: new Date("2026-04-06T10:00:00") },
      ]);
    });

    const { getStaleItemsForAccounts } = await import("./operations-reads");
    const result = await getStaleItemsForAccounts(["convergix"]);

    expect(result).toHaveLength(0);
  });

  it("returns empty for empty slugs", async () => {
    const { getStaleItemsForAccounts } = await import("./operations-reads");
    const result = await getStaleItemsForAccounts([]);
    expect(result).toEqual([]);
  });

  it("returns empty for unknown client", async () => {
    const { getStaleItemsForAccounts } = await import("./operations-reads");
    const result = await getStaleItemsForAccounts(["nonexistent"]);
    expect(result).toEqual([]);
  });

  it("sorts by staleDays descending (derived from updatedAt)", async () => {
    const now = new Date("2026-04-07T12:00:00");
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    let callCount = 0;
    mockSelectFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return chainable([
          { id: "p1", clientId: "c1", name: "Less Stale", status: "in-production", sortOrder: 0, updatedAt: sevenDaysAgo },
          { id: "p2", clientId: "c1", name: "Very Stale", status: "blocked", sortOrder: 1, updatedAt: thirtyDaysAgo },
        ]);
      }
      return chainable([]);
    });

    const { getStaleItemsForAccounts } = await import("./operations-reads");
    const result = await getStaleItemsForAccounts(["convergix"]);

    expect(result[0].projectName).toBe("Very Stale");
    expect(result[1].projectName).toBe("Less Stale");
  });
});

describe("getLinkedWeekItems", () => {
  it("returns week items linked to a project", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { id: "wi1", projectId: "p1", title: "CDS Review", status: null },
      { id: "wi2", projectId: "p1", title: "CDS Delivery", status: "completed" },
    ]));
    const { getLinkedWeekItems } = await import("./operations-reads");
    const result = await getLinkedWeekItems("p1");
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("CDS Review");
    expect(result[1].title).toBe("CDS Delivery");
  });

  it("returns empty array for project with no linked items", async () => {
    mockSelectFrom.mockReturnValue(chainable([]));
    const { getLinkedWeekItems } = await import("./operations-reads");
    const result = await getLinkedWeekItems("nonexistent");
    expect(result).toEqual([]);
  });
});
