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
        // updates table: support both `.orderBy(desc)` chain (findUpdates,
        // getRecentUpdates) and the no-orderBy form used by getUpdateChain.
        const rows = mockUpdatesSelect();
        return {
          orderBy: vi.fn(() => rows),
          then: (resolve: (v: unknown) => void) => resolve(rows),
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

describe("findUpdates (audit-trail search)", () => {
  it("returns AuditUpdate rows with id/batchId/triggeredByUpdateId surfaced", async () => {
    mockUpdatesSelect.mockReturnValue([
      {
        id: "u-root",
        clientId: "c1", projectId: "p1",
        updatedBy: "kathy", updateType: "status-change",
        summary: "active -> awaiting-client",
        previousValue: "active", newValue: "awaiting-client",
        batchId: "batch-1",
        triggeredByUpdateId: null,
        createdAt: new Date("2026-04-10T12:00:00Z"),
      },
    ]);

    const { findUpdates } = await import("./operations-reads-updates");
    const results = await findUpdates();

    expect(results).toHaveLength(1);
    const row = results[0];
    expect(row.id).toBe("u-root");
    expect(row.batchId).toBe("batch-1");
    expect(row.triggeredByUpdateId).toBeNull();
    expect(row.clientName).toBe("Convergix");
    expect(row.projectName).toBe("CDS Messaging");
  });

  it("filters by batchId (exact)", async () => {
    mockUpdatesSelect.mockReturnValue([
      { id: "u1", clientId: "c1", projectId: null, updatedBy: "kathy", updateType: "note", batchId: "b1", triggeredByUpdateId: null, summary: "keep", previousValue: null, newValue: null, createdAt: new Date("2026-04-10T12:00:00Z") },
      { id: "u2", clientId: "c1", projectId: null, updatedBy: "kathy", updateType: "note", batchId: "b2", triggeredByUpdateId: null, summary: "drop", previousValue: null, newValue: null, createdAt: new Date("2026-04-10T12:00:00Z") },
      { id: "u3", clientId: "c1", projectId: null, updatedBy: "kathy", updateType: "note", batchId: null, triggeredByUpdateId: null, summary: "drop-null", previousValue: null, newValue: null, createdAt: new Date("2026-04-10T12:00:00Z") },
    ]);
    const { findUpdates } = await import("./operations-reads-updates");
    const results = await findUpdates({ batchId: "b1" });
    expect(results.map((r) => r.id)).toEqual(["u1"]);
  });

  it("filters by updateType (exact)", async () => {
    mockUpdatesSelect.mockReturnValue([
      { id: "u1", clientId: "c1", projectId: null, updatedBy: "kathy", updateType: "status-change", batchId: null, triggeredByUpdateId: null, summary: "s", previousValue: null, newValue: null, createdAt: new Date("2026-04-10T12:00:00Z") },
      { id: "u2", clientId: "c1", projectId: null, updatedBy: "kathy", updateType: "note", batchId: null, triggeredByUpdateId: null, summary: "n", previousValue: null, newValue: null, createdAt: new Date("2026-04-10T12:00:00Z") },
    ]);
    const { findUpdates } = await import("./operations-reads-updates");
    const results = await findUpdates({ updateType: "status-change" });
    expect(results.map((r) => r.id)).toEqual(["u1"]);
  });

  it("filters by projectName (substring, requires linked project)", async () => {
    mockUpdatesSelect.mockReturnValue([
      { id: "u1", clientId: "c1", projectId: "p1", updatedBy: "kathy", updateType: "note", batchId: null, triggeredByUpdateId: null, summary: "cds", previousValue: null, newValue: null, createdAt: new Date("2026-04-10T12:00:00Z") },
      { id: "u2", clientId: "c1", projectId: "p2", updatedBy: "kathy", updateType: "note", batchId: null, triggeredByUpdateId: null, summary: "web", previousValue: null, newValue: null, createdAt: new Date("2026-04-10T12:00:00Z") },
      { id: "u3", clientId: "c1", projectId: null, updatedBy: "kathy", updateType: "note", batchId: null, triggeredByUpdateId: null, summary: "no-proj", previousValue: null, newValue: null, createdAt: new Date("2026-04-10T12:00:00Z") },
    ]);
    const { findUpdates } = await import("./operations-reads-updates");
    const results = await findUpdates({ projectName: "cds" });
    expect(results.map((r) => r.id)).toEqual(["u1"]);
  });

  it("filters by clientSlug; returns [] for unknown slug", async () => {
    mockGetClientBySlug.mockResolvedValueOnce({ id: "c2" });
    mockUpdatesSelect.mockReturnValue([
      { id: "u1", clientId: "c1", projectId: null, updatedBy: "kathy", updateType: "note", batchId: null, triggeredByUpdateId: null, summary: "c1", previousValue: null, newValue: null, createdAt: new Date("2026-04-10T12:00:00Z") },
      { id: "u2", clientId: "c2", projectId: null, updatedBy: "kathy", updateType: "note", batchId: null, triggeredByUpdateId: null, summary: "c2", previousValue: null, newValue: null, createdAt: new Date("2026-04-10T12:00:00Z") },
    ]);
    const { findUpdates } = await import("./operations-reads-updates");
    let results = await findUpdates({ clientSlug: "bonterra" });
    expect(results.map((r) => r.id)).toEqual(["u2"]);

    // Unknown slug → empty.
    mockGetClientBySlug.mockResolvedValueOnce(null);
    results = await findUpdates({ clientSlug: "nope" });
    expect(results).toEqual([]);
  });

  it("filters by since/until (inclusive)", async () => {
    mockUpdatesSelect.mockReturnValue([
      { id: "u-new", clientId: "c1", projectId: null, updatedBy: "kathy", updateType: "note", batchId: null, triggeredByUpdateId: null, summary: "new", previousValue: null, newValue: null, createdAt: new Date("2026-04-15T12:00:00Z") },
      { id: "u-mid", clientId: "c1", projectId: null, updatedBy: "kathy", updateType: "note", batchId: null, triggeredByUpdateId: null, summary: "mid", previousValue: null, newValue: null, createdAt: new Date("2026-04-05T12:00:00Z") },
      { id: "u-old", clientId: "c1", projectId: null, updatedBy: "kathy", updateType: "note", batchId: null, triggeredByUpdateId: null, summary: "old", previousValue: null, newValue: null, createdAt: new Date("2026-03-01T12:00:00Z") },
    ]);
    const { findUpdates } = await import("./operations-reads-updates");
    const results = await findUpdates({ since: "2026-04-01T00:00:00Z", until: "2026-04-10T00:00:00Z" });
    expect(results.map((r) => r.id)).toEqual(["u-mid"]);
  });

  it("respects limit (default 100, overridable)", async () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({
      id: `u${i}`, clientId: "c1", projectId: null, updatedBy: "kathy", updateType: "note",
      batchId: null, triggeredByUpdateId: null, summary: `s${i}`, previousValue: null, newValue: null, createdAt: new Date("2026-04-10T12:00:00Z"),
    }));
    mockUpdatesSelect.mockReturnValue(rows);

    const { findUpdates } = await import("./operations-reads-updates");
    const defaulted = await findUpdates();
    expect(defaulted).toHaveLength(100);

    const capped = await findUpdates({ limit: 5 });
    expect(capped).toHaveLength(5);
  });
});

describe("getUpdateChain (cascade linkage)", () => {
  it("returns root + chronological descendants when given a mid-chain id", async () => {
    // Tree: u-root → u-child1 → u-grandchild, and u-root → u-child2.
    // Requesting u-child1 should climb to u-root then gather all descendants.
    mockUpdatesSelect.mockReturnValue([
      { id: "u-root",      clientId: "c1", projectId: "p1", updatedBy: "kathy", updateType: "status-change", batchId: null, triggeredByUpdateId: null,        summary: "root",   previousValue: null, newValue: null, createdAt: new Date("2026-04-10T12:00:00Z") },
      { id: "u-child1",    clientId: "c1", projectId: "p1", updatedBy: "kathy", updateType: "cascade",       batchId: null, triggeredByUpdateId: "u-root",    summary: "c1",     previousValue: null, newValue: null, createdAt: new Date("2026-04-10T12:00:01Z") },
      { id: "u-child2",    clientId: "c1", projectId: "p1", updatedBy: "kathy", updateType: "cascade",       batchId: null, triggeredByUpdateId: "u-root",    summary: "c2",     previousValue: null, newValue: null, createdAt: new Date("2026-04-10T12:00:02Z") },
      { id: "u-grandchild",clientId: "c1", projectId: "p1", updatedBy: "kathy", updateType: "cascade",       batchId: null, triggeredByUpdateId: "u-child1",  summary: "gc",     previousValue: null, newValue: null, createdAt: new Date("2026-04-10T12:00:03Z") },
      // Unrelated update — must not leak in.
      { id: "u-other",     clientId: "c1", projectId: "p1", updatedBy: "kathy", updateType: "note",           batchId: null, triggeredByUpdateId: null,        summary: "other",  previousValue: null, newValue: null, createdAt: new Date("2026-04-11T09:00:00Z") },
    ]);

    const { getUpdateChain } = await import("./operations-reads-updates");
    const { root, chain } = await getUpdateChain("u-child1");

    expect(root?.id).toBe("u-root");
    expect(chain.map((c) => c.id)).toEqual([
      "u-root",
      "u-child1",
      "u-child2",
      "u-grandchild",
    ]);
    // Unrelated update excluded.
    expect(chain.map((c) => c.id)).not.toContain("u-other");
  });

  it("returns { root: null, chain: [] } for an unknown updateId", async () => {
    mockUpdatesSelect.mockReturnValue([
      { id: "u-root", clientId: "c1", projectId: null, updatedBy: "kathy", updateType: "note", batchId: null, triggeredByUpdateId: null, summary: "s", previousValue: null, newValue: null, createdAt: new Date("2026-04-10T12:00:00Z") },
    ]);
    const { getUpdateChain } = await import("./operations-reads-updates");
    const result = await getUpdateChain("does-not-exist");
    expect(result).toEqual({ root: null, chain: [] });
  });

  it("handles a single-node chain (root with no children)", async () => {
    mockUpdatesSelect.mockReturnValue([
      { id: "u-solo", clientId: "c1", projectId: null, updatedBy: "kathy", updateType: "note", batchId: null, triggeredByUpdateId: null, summary: "solo", previousValue: null, newValue: null, createdAt: new Date("2026-04-10T12:00:00Z") },
    ]);
    const { getUpdateChain } = await import("./operations-reads-updates");
    const { root, chain } = await getUpdateChain("u-solo");
    expect(root?.id).toBe("u-solo");
    expect(chain.map((c) => c.id)).toEqual(["u-solo"]);
  });

  it("defensive cycle guard: does not infinite-loop on a triggered_by cycle", async () => {
    // u-a.triggeredBy = u-b, u-b.triggeredBy = u-a.
    mockUpdatesSelect.mockReturnValue([
      { id: "u-a", clientId: "c1", projectId: null, updatedBy: "kathy", updateType: "cascade", batchId: null, triggeredByUpdateId: "u-b", summary: "a", previousValue: null, newValue: null, createdAt: new Date("2026-04-10T12:00:00Z") },
      { id: "u-b", clientId: "c1", projectId: null, updatedBy: "kathy", updateType: "cascade", batchId: null, triggeredByUpdateId: "u-a", summary: "b", previousValue: null, newValue: null, createdAt: new Date("2026-04-10T12:00:01Z") },
    ]);
    const { getUpdateChain } = await import("./operations-reads-updates");
    const { root, chain } = await getUpdateChain("u-a");
    // Not asserting which one wins the cycle climb — only that we return
    // without hanging and give back a valid audit update.
    expect(root).not.toBeNull();
    expect(chain.length).toBeGreaterThanOrEqual(1);
  });
});
