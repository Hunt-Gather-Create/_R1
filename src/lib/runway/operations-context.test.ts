import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSelectFrom = vi.fn();
const mockProjectsSelect = vi.fn();
const mockGetClientBySlug = vi.fn();
const mockGetClientNameMap = vi.fn();

vi.mock("@/lib/db/runway", () => ({
  getRunwayDb: () => ({
    select: () => ({
      // Route by table identity — projects has `.__table === "projects"`
      // (set in the schema mock below). Everything else routes through
      // the generic `mockSelectFrom` used by pre-existing tests.
      from: (table: unknown) => {
        const t = table as { __table?: string };
        if (t?.__table === "projects") return mockProjectsSelect();
        return mockSelectFrom();
      },
    }),
  }),
}));
vi.mock("@/lib/db/runway-schema", () => ({
  clients: { name: "name", slug: "slug" },
  projects: { __table: "projects" },
  updates: { createdAt: "createdAt", idempotencyKey: "idempotencyKey" },
  teamMembers: { isActive: "isActive", slackUserId: "slackUserId" },
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
  desc: vi.fn((col) => ({ desc: col })),
}));
vi.mock("./operations", () => ({
  getClientBySlug: (...args: unknown[]) => mockGetClientBySlug(...args),
  getClientNameMap: (...args: unknown[]) => mockGetClientNameMap(...args),
  matchesSubstring: (value: string | null | undefined, search: string) => {
    if (!value) return false;
    return value.toLowerCase().includes(search.toLowerCase());
  },
}));

function chainable(data: unknown[]) {
  const obj: Record<string, unknown> = {
    orderBy: vi.fn(() => chainable(data)),
    where: vi.fn(() => chainable(data)),
    limit: vi.fn(() => chainable(data)),
    get: vi.fn(() => data[0] ?? undefined),
    then: (resolve: (v: unknown) => void) => resolve(data),
  };
  return obj;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetClientNameMap.mockResolvedValue(new Map([["c1", "Convergix"]]));
  // Default projects returned when the projectName filter triggers a lookup.
  mockProjectsSelect.mockResolvedValue([]);
});

describe("getUpdatesData", () => {
  it("returns formatted updates with client names", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { clientId: "c1", updatedBy: "Kathy", updateType: "status-change", previousValue: "active", newValue: "done", summary: "Done", createdAt: new Date("2026-04-05") },
    ]));
    const { getUpdatesData } = await import("./operations-context");
    const result = await getUpdatesData();
    expect(result[0].client).toBe("Convergix");
    expect(result[0].updatedBy).toBe("Kathy");
    expect(result[0].createdAt).toContain("2026-04-05");
  });

  it("filters by clientSlug when provided", async () => {
    mockGetClientBySlug.mockResolvedValue({ id: "c1" });
    mockSelectFrom.mockReturnValue(chainable([
      { clientId: "c1", updatedBy: "Kathy", updateType: "note", summary: "Test", createdAt: null },
      { clientId: "c2", updatedBy: "Jason", updateType: "note", summary: "Other", createdAt: null },
    ]));
    const { getUpdatesData } = await import("./operations-context");
    const result = await getUpdatesData({ clientSlug: "convergix" });
    expect(result).toHaveLength(1);
    expect(result[0].updatedBy).toBe("Kathy");
  });

  it("returns all when clientSlug not found", async () => {
    mockGetClientBySlug.mockResolvedValue(null);
    mockSelectFrom.mockReturnValue(chainable([
      { clientId: "c1", updatedBy: "Kathy", updateType: "note", summary: "Test", createdAt: null },
    ]));
    const { getUpdatesData } = await import("./operations-context");
    const result = await getUpdatesData({ clientSlug: "nonexistent" });
    expect(result).toHaveLength(1);
  });
});

describe("getTeamMembersData", () => {
  it("returns active team members", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { name: "Kathy Horn", title: "Creative Director", channelPurpose: "Creative" },
    ]));
    const { getTeamMembersData } = await import("./operations-context");
    const result = await getTeamMembersData();
    expect(result[0].name).toBe("Kathy Horn");
    expect(result[0].title).toBe("Creative Director");
  });
});

describe("getClientContacts", () => {
  it("returns parsed contacts for existing client", async () => {
    mockGetClientBySlug.mockResolvedValue({ name: "Convergix", clientContacts: '["Daniel","Sarah"]' });
    const { getClientContacts } = await import("./operations-context");
    const result = await getClientContacts("convergix");
    expect(result).toEqual({ client: "Convergix", contacts: ["Daniel", "Sarah"] });
  });

  it("returns null for unknown client", async () => {
    mockGetClientBySlug.mockResolvedValue(null);
    const { getClientContacts } = await import("./operations-context");
    const result = await getClientContacts("unknown");
    expect(result).toBeNull();
  });

  it("wraps plain string contacts in array", async () => {
    mockGetClientBySlug.mockResolvedValue({ name: "LPPC", clientContacts: "not-json" });
    const { getClientContacts } = await import("./operations-context");
    const result = await getClientContacts("lppc");
    expect(result).toEqual({ client: "LPPC", contacts: ["not-json"] });
  });

  it("returns empty contacts when null", async () => {
    mockGetClientBySlug.mockResolvedValue({ name: "Convergix", clientContacts: null });
    const { getClientContacts } = await import("./operations-context");
    const result = await getClientContacts("convergix");
    expect(result).toEqual({ client: "Convergix", contacts: [] });
  });
});

describe("getTeamMemberBySlackId", () => {
  it("returns member name when found", async () => {
    mockSelectFrom.mockReturnValue(chainable([{ name: "Kathy Horn" }]));
    const { getTeamMemberBySlackId } = await import("./operations-context");
    const result = await getTeamMemberBySlackId("U12345");
    expect(result).toBe("Kathy Horn");
  });

  it("returns null when not found", async () => {
    mockSelectFrom.mockReturnValue(chainable([]));
    const { getTeamMemberBySlackId } = await import("./operations-context");
    const result = await getTeamMemberBySlackId("U_UNKNOWN");
    expect(result).toBeNull();
  });
});

describe("getUpdatesData — edge cases", () => {
  it("returns empty array when no updates exist", async () => {
    mockSelectFrom.mockReturnValue(chainable([]));
    const { getUpdatesData } = await import("./operations-context");
    const result = await getUpdatesData();
    expect(result).toEqual([]);
  });

  it("handles null clientId in update records", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { clientId: null, updatedBy: "Jason", updateType: "note", previousValue: null, newValue: null, summary: "General", createdAt: null },
    ]));
    const { getUpdatesData } = await import("./operations-context");
    const result = await getUpdatesData();
    expect(result[0].client).toBeNull();
    expect(result[0].createdAt).toBeUndefined();
  });

  it("handles client that exists but has no updates", async () => {
    mockGetClientBySlug.mockResolvedValue({ id: "c1" });
    mockSelectFrom.mockReturnValue(chainable([
      { clientId: "c2", updatedBy: "Jason", updateType: "note", summary: "Other", createdAt: null },
    ]));
    const { getUpdatesData } = await import("./operations-context");
    const result = await getUpdatesData({ clientSlug: "convergix" });
    expect(result).toEqual([]);
  });
});

describe("getUpdatesData — v4 expanded params (since/until/batchId/updateType/projectName)", () => {
  it("filters by since (inclusive lower bound on createdAt)", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { clientId: "c1", updatedBy: "Kathy", updateType: "note", previousValue: null, newValue: null, summary: "recent", createdAt: new Date("2026-04-15T00:00:00Z") },
      { clientId: "c1", updatedBy: "Kathy", updateType: "note", previousValue: null, newValue: null, summary: "old", createdAt: new Date("2026-03-01T00:00:00Z") },
    ]));
    const { getUpdatesData } = await import("./operations-context");
    const result = await getUpdatesData({ since: "2026-04-01T00:00:00Z" });
    expect(result).toHaveLength(1);
    expect(result[0].summary).toBe("recent");
  });

  it("filters by until (inclusive upper bound on createdAt)", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { clientId: "c1", updatedBy: "Kathy", updateType: "note", previousValue: null, newValue: null, summary: "keep", createdAt: new Date("2026-03-15T00:00:00Z") },
      { clientId: "c1", updatedBy: "Kathy", updateType: "note", previousValue: null, newValue: null, summary: "too-new", createdAt: new Date("2026-04-15T00:00:00Z") },
    ]));
    const { getUpdatesData } = await import("./operations-context");
    const result = await getUpdatesData({ until: "2026-04-01T00:00:00Z" });
    expect(result).toHaveLength(1);
    expect(result[0].summary).toBe("keep");
  });

  it("filters by batchId", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { clientId: "c1", updatedBy: "Kathy", updateType: "note", batchId: "batch-1", previousValue: null, newValue: null, summary: "in-batch", createdAt: null },
      { clientId: "c1", updatedBy: "Kathy", updateType: "note", batchId: null, previousValue: null, newValue: null, summary: "no-batch", createdAt: null },
      { clientId: "c1", updatedBy: "Kathy", updateType: "note", batchId: "batch-2", previousValue: null, newValue: null, summary: "wrong-batch", createdAt: null },
    ]));
    const { getUpdatesData } = await import("./operations-context");
    const result = await getUpdatesData({ batchId: "batch-1" });
    expect(result).toHaveLength(1);
    expect(result[0].summary).toBe("in-batch");
  });

  it("filters by updateType (exact match)", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { clientId: "c1", updatedBy: "Kathy", updateType: "status-change", previousValue: null, newValue: null, summary: "status", createdAt: null },
      { clientId: "c1", updatedBy: "Kathy", updateType: "note", previousValue: null, newValue: null, summary: "note", createdAt: null },
    ]));
    const { getUpdatesData } = await import("./operations-context");
    const result = await getUpdatesData({ updateType: "status-change" });
    expect(result).toHaveLength(1);
    expect(result[0].summary).toBe("status");
  });

  it("filters by projectName (case-insensitive substring against linked project)", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { clientId: "c1", projectId: "p1", updatedBy: "Kathy", updateType: "note", previousValue: null, newValue: null, summary: "cds-update", createdAt: null },
      { clientId: "c1", projectId: "p2", updatedBy: "Kathy", updateType: "note", previousValue: null, newValue: null, summary: "brand-update", createdAt: null },
      { clientId: "c1", projectId: null, updatedBy: "Kathy", updateType: "note", previousValue: null, newValue: null, summary: "no-project", createdAt: null },
    ]));
    mockProjectsSelect.mockResolvedValue([
      { id: "p1", name: "CDS Messaging" },
      { id: "p2", name: "Brand Refresh" },
    ]);
    const { getUpdatesData } = await import("./operations-context");
    const result = await getUpdatesData({ projectName: "cds" });
    expect(result).toHaveLength(1);
    expect(result[0].summary).toBe("cds-update");
  });

  it("combines multiple filters (AND semantics)", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      { clientId: "c1", updatedBy: "Kathy", updateType: "status-change", batchId: "b1", previousValue: null, newValue: null, summary: "keep", createdAt: new Date("2026-04-15T00:00:00Z") },
      { clientId: "c1", updatedBy: "Kathy", updateType: "note",          batchId: "b1", previousValue: null, newValue: null, summary: "wrong-type", createdAt: new Date("2026-04-15T00:00:00Z") },
      { clientId: "c1", updatedBy: "Kathy", updateType: "status-change", batchId: "b2", previousValue: null, newValue: null, summary: "wrong-batch", createdAt: new Date("2026-04-15T00:00:00Z") },
    ]));
    const { getUpdatesData } = await import("./operations-context");
    const result = await getUpdatesData({
      since: "2026-04-01",
      batchId: "b1",
      updateType: "status-change",
    });
    expect(result).toHaveLength(1);
    expect(result[0].summary).toBe("keep");
  });

  it("applies limit post-filter", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      clientId: "c1",
      updatedBy: "Kathy",
      updateType: "note",
      batchId: "b1",
      previousValue: null,
      newValue: null,
      summary: `u${i}`,
      createdAt: new Date("2026-04-15T00:00:00Z"),
    }));
    mockSelectFrom.mockReturnValue(chainable(rows));
    const { getUpdatesData } = await import("./operations-context");
    const result = await getUpdatesData({ batchId: "b1", limit: 3 });
    expect(result).toHaveLength(3);
  });
});

describe("getClientContacts — JSON edge cases", () => {
  it("handles malformed JSON gracefully", async () => {
    mockGetClientBySlug.mockResolvedValue({ name: "Test", clientContacts: "[unclosed" });
    const { getClientContacts } = await import("./operations-context");
    const result = await getClientContacts("test");
    expect(result).toEqual({ client: "Test", contacts: ["[unclosed"] });
  });

  it("handles empty string contacts", async () => {
    mockGetClientBySlug.mockResolvedValue({ name: "Test", clientContacts: "" });
    const { getClientContacts } = await import("./operations-context");
    const result = await getClientContacts("test");
    expect(result).toEqual({ client: "Test", contacts: [] });
  });
});

describe("getTeamMembersData — edge cases", () => {
  it("returns empty array when no active members", async () => {
    mockSelectFrom.mockReturnValue(chainable([]));
    const { getTeamMembersData } = await import("./operations-context");
    const result = await getTeamMembersData();
    expect(result).toEqual([]);
  });
});

describe("getTeamRosterForContext", () => {
  it("returns active members with parsed accountsLed and nicknames", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      {
        name: "Allison Shannon",
        firstName: "Allison",
        fullName: "Allison Shannon",
        nicknames: '["Allie"]',
        title: "Strategy Director",
        roleCategory: "am",
        accountsLed: '["wilsonart","dave-asprey"]',
        isActive: 1,
      },
    ]));
    const { getTeamRosterForContext } = await import("./operations-context");
    const result = await getTeamRosterForContext();
    expect(result).toHaveLength(1);
    expect(result[0].firstName).toBe("Allison");
    expect(result[0].fullName).toBe("Allison Shannon");
    expect(result[0].nicknames).toEqual(["Allie"]);
    expect(result[0].accountsLed).toEqual(["wilsonart", "dave-asprey"]);
  });

  it("handles null nicknames gracefully", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      {
        name: "Lane Jordan",
        firstName: "Lane",
        fullName: "Lane Jordan",
        nicknames: null,
        title: "Creative Director",
        roleCategory: "creative",
        accountsLed: "[]",
        isActive: 1,
      },
    ]));
    const { getTeamRosterForContext } = await import("./operations-context");
    const result = await getTeamRosterForContext();
    expect(result[0].nicknames).toEqual([]);
  });
});

describe("getClientMapForContext", () => {
  it("returns all clients with parsed nicknames and structured contacts", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      {
        slug: "convergix",
        name: "Convergix",
        nicknames: '["CGX","Convergix"]',
        clientContacts: '[{"name":"Daniel","role":"Marketing Director"}]',
      },
    ]));
    const { getClientMapForContext } = await import("./operations-context");
    const result = await getClientMapForContext();
    expect(result).toHaveLength(1);
    expect(result[0].slug).toBe("convergix");
    expect(result[0].nicknames).toEqual(["CGX", "Convergix"]);
    expect(result[0].contacts).toEqual([{ name: "Daniel", role: "Marketing Director" }]);
  });

  it("handles null nicknames and contacts", async () => {
    mockSelectFrom.mockReturnValue(chainable([
      {
        slug: "lppc",
        name: "LPPC",
        nicknames: null,
        clientContacts: null,
      },
    ]));
    const { getClientMapForContext } = await import("./operations-context");
    const result = await getClientMapForContext();
    expect(result[0].nicknames).toEqual([]);
    expect(result[0].contacts).toEqual([]);
  });
});

describe("getClientContactsStructured", () => {
  it("returns structured contacts with roles for valid slug", async () => {
    mockGetClientBySlug.mockResolvedValue({
      name: "Convergix",
      clientContacts: '[{"name":"Daniel","role":"Marketing Director"},{"name":"Nicole","role":"Marketing"}]',
    });
    const { getClientContactsStructured } = await import("./operations-context");
    const result = await getClientContactsStructured("convergix");
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: "Daniel", role: "Marketing Director" });
  });

  it("returns empty array for unknown slug", async () => {
    mockGetClientBySlug.mockResolvedValue(null);
    const { getClientContactsStructured } = await import("./operations-context");
    const result = await getClientContactsStructured("unknown");
    expect(result).toEqual([]);
  });

  it("returns empty array when clientContacts is null", async () => {
    mockGetClientBySlug.mockResolvedValue({ name: "LPPC", clientContacts: null });
    const { getClientContactsStructured } = await import("./operations-context");
    const result = await getClientContactsStructured("lppc");
    expect(result).toEqual([]);
  });
});
