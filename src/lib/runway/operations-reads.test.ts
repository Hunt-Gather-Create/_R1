import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockSelectFrom = vi.fn();
const mockGetAllClients = vi.fn();
const mockGetClientNameMap = vi.fn();

vi.mock("@/lib/db/runway", () => ({ getRunwayDb: () => ({ select: () => ({ from: mockSelectFrom }) }) }));
vi.mock("@/lib/db/runway-schema", () => ({
  projects: { sortOrder: "sortOrder", clientId: "clientId" },
  weekItems: { weekOf: "weekOf", date: "date", sortOrder: "sortOrder" },
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
      { clientId: "c1", name: "CDS", status: "in-production", category: "active", owner: "Kathy", waitingOn: null, target: null, notes: null, staleDays: null },
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
      { clientId: "c1", name: "CDS", status: "in-production", owner: "Kathy/Lane", waitingOn: null, target: null, notes: null, staleDays: null },
      { clientId: "c1", name: "Website", status: "active", owner: "Leslie", waitingOn: null, target: null, notes: null, staleDays: null },
    ]));
    const { getProjectsFiltered } = await import("./operations-reads");
    const result = await getProjectsFiltered({ owner: "Kathy" });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("CDS");
  });

  it("matches partial owner names (e.g. 'Kathy' in 'Kathy/Lane')", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { clientId: "c1", name: "CDS", status: "in-production", owner: "Kathy/Lane", waitingOn: null, target: null, notes: null, staleDays: null },
    ]));
    const { getProjectsFiltered } = await import("./operations-reads");
    const result = await getProjectsFiltered({ owner: "lane" });
    expect(result).toHaveLength(1);
  });

  it("returns empty when owner matches nothing", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { clientId: "c1", name: "CDS", status: "in-production", owner: "Kathy", waitingOn: null, target: null, notes: null, staleDays: null },
    ]));
    const { getProjectsFiltered } = await import("./operations-reads");
    const result = await getProjectsFiltered({ owner: "Nobody" });
    expect(result).toEqual([]);
  });
});

describe("getProjectsFiltered — waitingOn filter", () => {
  it("filters by waitingOn (case-insensitive substring)", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { clientId: "c1", name: "Brochure", status: "awaiting-client", owner: null, waitingOn: "Daniel", target: null, notes: null, staleDays: null },
      { clientId: "c1", name: "Website", status: "active", owner: null, waitingOn: null, target: null, notes: null, staleDays: null },
    ]));
    const { getProjectsFiltered } = await import("./operations-reads");
    const result = await getProjectsFiltered({ waitingOn: "daniel" });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Brochure");
  });

  it("matches partial waitingOn (e.g. 'Daniel' in 'Daniel/Nicole')", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { clientId: "c1", name: "Templates", status: "awaiting-client", owner: null, waitingOn: "Daniel/Nicole", target: null, notes: null, staleDays: null },
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

describe("getPersonWorkload", () => {
  it("returns projects and week items for a person", async () => {
    // First call = projects, second call = weekItems
    let callCount = 0;
    mockSelectFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return chainable([
          { clientId: "c1", name: "CDS", status: "in-production", owner: "Kathy/Lane", resources: null, target: "4/7", notes: "Gate" },
          { clientId: "c1", name: "Website", status: "active", owner: "Leslie", resources: null, target: null, notes: null },
        ]);
      }
      return chainable([
        { date: "2026-04-06", clientId: "c1", title: "CDS Review", owner: "Kathy", resources: null, category: "review", notes: null },
        { date: "2026-04-07", clientId: "c2", title: "Map R2", owner: "Leslie", resources: null, category: "delivery", notes: null },
      ]);
    });

    const { getPersonWorkload } = await import("./operations-reads");
    const result = await getPersonWorkload("Kathy");
    expect(result.person).toBe("Kathy");
    expect(result.totalProjects).toBe(1);
    expect(result.totalWeekItems).toBe(1);
    expect(result.projects[0].client).toBe("Convergix");
    expect(result.weekItems[0].client).toBe("Convergix");
  });

  it("finds items where person is resource but not owner", async () => {
    let callCount = 0;
    mockSelectFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return chainable([
          { clientId: "c1", name: "CDS", status: "in-production", owner: "Kathy", resources: "Roz, Lane", target: null, notes: null },
        ]);
      }
      return chainable([
        { date: "2026-04-06", clientId: "c1", title: "CDS Review", owner: "Kathy", resources: "Roz", category: "review", notes: null },
      ]);
    });

    const { getPersonWorkload } = await import("./operations-reads");
    const result = await getPersonWorkload("Roz");
    expect(result.totalProjects).toBe(1);
    expect(result.totalWeekItems).toBe(1);
  });

  it("returns empty results for person with no assignments", async () => {
    mockSelectFrom.mockReturnValue(chainable([]));
    const { getPersonWorkload } = await import("./operations-reads");
    const result = await getPersonWorkload("Nobody");
    expect(result.totalProjects).toBe(0);
    expect(result.totalWeekItems).toBe(0);
    expect(result.projects).toEqual([]);
    expect(result.weekItems).toEqual([]);
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
      { clientId: null, name: "Orphan", status: "no-sow", estimatedValue: "TBD", waitingOn: null, notes: null },
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

  it("returns stale projects (staleDays >= 7)", async () => {
    let callCount = 0;
    mockSelectFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // projects for convergix
        return chainable([
          { id: "p1", clientId: "c1", name: "CDS Messaging", status: "in-production", staleDays: 10, sortOrder: 0 },
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

  it("sorts by staleDays descending", async () => {
    let callCount = 0;
    mockSelectFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return chainable([
          { id: "p1", clientId: "c1", name: "Less Stale", status: "in-production", staleDays: 7, sortOrder: 0 },
          { id: "p2", clientId: "c1", name: "Very Stale", status: "blocked", staleDays: 30, sortOrder: 1 },
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
