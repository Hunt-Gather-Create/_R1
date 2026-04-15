import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockProjectsSelect = vi.fn();
const mockClientsSelect = vi.fn();
const mockUpdatesSelect = vi.fn();

vi.mock("@/lib/db/runway", () => ({
  getRunwayDb: () => ({
    select: vi.fn(() => ({
      from: vi.fn((table: { toString?: () => string }) => {
        // Route to correct mock based on table reference
        const tableName = String(table);
        if (tableName.includes("project")) {
          return mockProjectsSelect();
        }
        if (tableName.includes("client")) {
          return mockClientsSelect();
        }
        // updates table — needs orderBy chain
        return {
          orderBy: vi.fn(() => mockUpdatesSelect()),
        };
      }),
    })),
  }),
}));

vi.mock("@/lib/db/runway-schema", () => ({
  projects: { toString: () => "projects" },
  clients: { toString: () => "clients" },
  updates: { createdAt: "created_at", toString: () => "updates" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  desc: vi.fn(),
}));

const mockGetClientBySlug = vi.fn();

vi.mock("./operations-utils", () => ({
  matchesSubstring: (value: string | null, search: string) => {
    if (!value) return false;
    return value.toLowerCase().includes(search.toLowerCase());
  },
  getClientBySlug: (...args: unknown[]) => mockGetClientBySlug(...args),
}));

const now = new Date("2026-04-08T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  // Pin Date.now() so the default "since" (7 days ago) is stable
  vi.useFakeTimers();
  vi.setSystemTime(now);

  mockProjectsSelect.mockReturnValue([
    { id: "p1", name: "CDS Messaging" },
    { id: "p2", name: "Website" },
  ]);
  mockClientsSelect.mockReturnValue([
    { id: "c1", name: "Convergix" },
    { id: "c2", name: "Bonterra" },
  ]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getRecentUpdates", () => {
  it("returns recent updates sorted by date descending", async () => {
    mockUpdatesSelect.mockReturnValue([
      {
        id: "u1", clientId: "c1", projectId: "p1",
        updatedBy: "kathy", updateType: "status-change",
        summary: "CDS: active -> completed",
        previousValue: "active", newValue: "completed",
        createdAt: new Date("2026-04-08T10:00:00Z"),
      },
      {
        id: "u2", clientId: "c1", projectId: "p2",
        updatedBy: "kathy", updateType: "note",
        summary: "Website looks good",
        previousValue: null, newValue: null,
        createdAt: new Date("2026-04-07T10:00:00Z"),
      },
    ]);

    const { getRecentUpdates } = await import("./operations-reads-updates");
    const results = await getRecentUpdates();

    expect(results).toHaveLength(2);
    expect(results[0].clientName).toBe("Convergix");
    expect(results[0].projectName).toBe("CDS Messaging");
    expect(results[1].projectName).toBe("Website");
  });

  it("filters by updatedBy (substring match)", async () => {
    mockUpdatesSelect.mockReturnValue([
      {
        id: "u1", clientId: "c1", projectId: "p1",
        updatedBy: "kathy", updateType: "note",
        summary: "test", previousValue: null, newValue: null,
        createdAt: new Date("2026-04-08T10:00:00Z"),
      },
      {
        id: "u2", clientId: "c1", projectId: "p1",
        updatedBy: "jason", updateType: "note",
        summary: "test2", previousValue: null, newValue: null,
        createdAt: new Date("2026-04-07T10:00:00Z"),
      },
    ]);

    const { getRecentUpdates } = await import("./operations-reads-updates");
    const results = await getRecentUpdates({ updatedBy: "kathy" });

    expect(results).toHaveLength(1);
    expect(results[0].summary).toBe("test");
  });

  it("filters by client slug", async () => {
    mockGetClientBySlug.mockResolvedValue({ id: "c2", name: "Bonterra" });
    mockUpdatesSelect.mockReturnValue([
      {
        id: "u1", clientId: "c1", projectId: "p1",
        updatedBy: "kathy", updateType: "note",
        summary: "convergix update", previousValue: null, newValue: null,
        createdAt: new Date("2026-04-08T10:00:00Z"),
      },
      {
        id: "u2", clientId: "c2", projectId: null,
        updatedBy: "kathy", updateType: "note",
        summary: "bonterra update", previousValue: null, newValue: null,
        createdAt: new Date("2026-04-07T10:00:00Z"),
      },
    ]);

    const { getRecentUpdates } = await import("./operations-reads-updates");
    const results = await getRecentUpdates({ clientSlug: "bonterra" });

    expect(results).toHaveLength(1);
    expect(results[0].summary).toBe("bonterra update");
  });

  it("respects limit", async () => {
    const updates = Array.from({ length: 5 }, (_, i) => ({
      id: `u${i}`, clientId: "c1", projectId: "p1",
      updatedBy: "kathy", updateType: "note",
      summary: `update ${i}`, previousValue: null, newValue: null,
      createdAt: new Date(now.getTime() - i * 3600000),
    }));
    mockUpdatesSelect.mockReturnValue(updates);

    const { getRecentUpdates } = await import("./operations-reads-updates");
    const results = await getRecentUpdates({ limit: 3 });

    expect(results).toHaveLength(3);
  });

  it("filters by date range", async () => {
    mockUpdatesSelect.mockReturnValue([
      {
        id: "u1", clientId: "c1", projectId: "p1",
        updatedBy: "kathy", updateType: "note",
        summary: "recent", previousValue: null, newValue: null,
        createdAt: new Date("2026-04-08T10:00:00Z"),
      },
      {
        id: "u2", clientId: "c1", projectId: "p1",
        updatedBy: "kathy", updateType: "note",
        summary: "old", previousValue: null, newValue: null,
        createdAt: new Date("2026-03-01T10:00:00Z"),
      },
    ]);

    const { getRecentUpdates } = await import("./operations-reads-updates");
    const results = await getRecentUpdates({ since: "2026-04-01" });

    expect(results).toHaveLength(1);
    expect(results[0].summary).toBe("recent");
  });
});
