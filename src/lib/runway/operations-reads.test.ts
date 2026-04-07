import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSelectFrom = vi.fn();
const mockGetAllClients = vi.fn();
const mockGetClientNameMap = vi.fn();

vi.mock("@/lib/db/runway", () => ({ getRunwayDb: () => ({ select: () => ({ from: mockSelectFrom }) }) }));
vi.mock("@/lib/db/runway-schema", () => ({
  projects: { sortOrder: "sortOrder" }, weekItems: { weekOf: "weekOf", date: "date", sortOrder: "sortOrder" }, pipelineItems: { sortOrder: "sortOrder" },
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn((a, b) => ({ eq: [a, b] })), asc: vi.fn((col) => ({ asc: col })) }));
vi.mock("./operations", () => ({
  getAllClients: (...args: unknown[]) => mockGetAllClients(...args),
  getClientNameMap: (...args: unknown[]) => mockGetClientNameMap(...args),
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

describe("getPersonWorkload", () => {
  it("returns projects and week items for a person", async () => {
    // First call = projects, second call = weekItems
    let callCount = 0;
    mockSelectFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return chainable([
          { clientId: "c1", name: "CDS", status: "in-production", owner: "Kathy/Lane", target: "4/7", notes: "Gate" },
          { clientId: "c1", name: "Website", status: "active", owner: "Leslie", target: null, notes: null },
        ]);
      }
      return chainable([
        { date: "2026-04-06", clientId: "c1", title: "CDS Review", owner: "Kathy", category: "review", notes: null },
        { date: "2026-04-07", clientId: "c2", title: "Map R2", owner: "Leslie", category: "delivery", notes: null },
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
