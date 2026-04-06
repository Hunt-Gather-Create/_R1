import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSelectFrom = vi.fn();
const mockGetClientBySlug = vi.fn();
const mockGetClientNameMap = vi.fn();

vi.mock("@/lib/db/runway", () => ({
  getRunwayDb: () => ({
    select: () => ({ from: mockSelectFrom }),
  }),
}));
vi.mock("@/lib/db/runway-schema", () => ({
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
