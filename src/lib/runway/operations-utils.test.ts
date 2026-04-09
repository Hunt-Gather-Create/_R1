/**
 * Tests for operations-utils shared helpers.
 *
 * Pure utility functions are tested directly.
 * DB-dependent functions use mocks for the Drizzle layer.
 *
 * Fuzzy matching and validateField are tested in operations-utils-fuzzy.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ───────────────────────────────────────────────

const mockSelectFrom = vi.fn();
const mockSelectWhere = vi.fn();
const mockInsertValues = vi.fn();

vi.mock("@/lib/db/runway", () => ({
  getRunwayDb: () => ({
    select: () => ({ from: mockSelectFrom }),
    insert: vi.fn(() => ({ values: mockInsertValues })),
  }),
}));

vi.mock("@/lib/db/runway-schema", () => ({
  clients: { name: "name", slug: "slug" },
  projects: { clientId: "clientId", sortOrder: "sortOrder" },
  updates: { idempotencyKey: "idempotencyKey" },
  weekItems: { weekOf: "weekOf", date: "date", sortOrder: "sortOrder" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
  asc: vi.fn((col) => ({ asc: col })),
}));

function chainable(data: unknown[]) {
  const obj: Record<string, unknown> = {
    orderBy: vi.fn(() => chainable(data)),
    where: vi.fn((...args: unknown[]) => {
      mockSelectWhere(...args);
      return chainable(data);
    }),
    then: (resolve: (v: unknown) => void) => resolve(data),
  };
  return obj;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset module cache to clear the client cache between tests
  vi.resetModules();
});

// ── Pure Utility Tests ──────────────────────────────────

describe("generateIdempotencyKey", () => {
  it("produces a deterministic hex string", async () => {
    const { generateIdempotencyKey } = await import("./operations-utils");
    const key1 = generateIdempotencyKey("a", "b", "c");
    const key2 = generateIdempotencyKey("a", "b", "c");
    expect(key1).toBe(key2);
    expect(key1).toMatch(/^[0-9a-f]{40}$/);
  });

  it("produces different keys for different inputs", async () => {
    const { generateIdempotencyKey } = await import("./operations-utils");
    const key1 = generateIdempotencyKey("a", "b");
    const key2 = generateIdempotencyKey("a", "c");
    expect(key1).not.toBe(key2);
  });

  it("is exactly 40 hex chars", async () => {
    const { generateIdempotencyKey } = await import("./operations-utils");
    const key = generateIdempotencyKey("test");
    expect(key).toHaveLength(40);
  });
});

describe("generateId", () => {
  it("produces a 25-char hex string", async () => {
    const { generateId } = await import("./operations-utils");
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f]{25}$/);
  });

  it("produces unique values", async () => {
    const { generateId } = await import("./operations-utils");
    const ids = new Set(Array.from({ length: 10 }, () => generateId()));
    expect(ids.size).toBe(10);
  });
});

describe("clientNotFoundError", () => {
  it("returns ok:false with slug in message", async () => {
    const { clientNotFoundError } = await import("./operations-utils");
    const result = clientNotFoundError("acme");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("acme");
  });
});

describe("matchesSubstring", () => {
  it("matches case-insensitively", async () => {
    const { matchesSubstring } = await import("./operations-utils");
    expect(matchesSubstring("Kathy/Lane", "kathy")).toBe(true);
    expect(matchesSubstring("Kathy/Lane", "lane")).toBe(true);
  });

  it("returns false for null/undefined", async () => {
    const { matchesSubstring } = await import("./operations-utils");
    expect(matchesSubstring(null, "test")).toBe(false);
    expect(matchesSubstring(undefined, "test")).toBe(false);
  });

  it("returns false for no match", async () => {
    const { matchesSubstring } = await import("./operations-utils");
    expect(matchesSubstring("Kathy", "Leslie")).toBe(false);
  });
});

describe("groupBy", () => {
  it("groups items by key function", async () => {
    const { groupBy } = await import("./operations-utils");
    const items = [
      { clientId: "c1", name: "A" },
      { clientId: "c1", name: "B" },
      { clientId: "c2", name: "C" },
    ];
    const result = groupBy(items, (i) => i.clientId);
    expect(result.get("c1")).toHaveLength(2);
    expect(result.get("c2")).toHaveLength(1);
  });

  it("returns empty map for empty array", async () => {
    const { groupBy } = await import("./operations-utils");
    const result = groupBy([], (i: unknown) => i);
    expect(result.size).toBe(0);
  });
});

describe("normalizeForMatch", () => {
  it("normalizes em dashes to spaces", async () => {
    const { normalizeForMatch } = await import("./operations-utils");
    expect(normalizeForMatch("Impact Report \u2014 Dev")).toBe("impact report dev");
  });

  it("normalizes en dashes to spaces", async () => {
    const { normalizeForMatch } = await import("./operations-utils");
    expect(normalizeForMatch("Brand Refresh \u2013 Phase 2")).toBe("brand refresh phase 2");
  });

  it("normalizes hyphens to spaces", async () => {
    const { normalizeForMatch } = await import("./operations-utils");
    expect(normalizeForMatch("CDS - Final")).toBe("cds final");
  });

  it("collapses whitespace and lowercases", async () => {
    const { normalizeForMatch } = await import("./operations-utils");
    expect(normalizeForMatch("  Hello   World  ")).toBe("hello world");
  });
});

// ── Field Constants ─────────────────────────────────────

describe("field constants", () => {
  it("UNDO_FIELDS includes all PROJECT_FIELDS plus status and category", async () => {
    const { PROJECT_FIELDS, UNDO_FIELDS } = await import("./operations-utils");
    for (const field of PROJECT_FIELDS) {
      expect(UNDO_FIELDS).toContain(field);
    }
    expect(UNDO_FIELDS).toContain("status");
    expect(UNDO_FIELDS).toContain("category");
  });

  it("PROJECT_FIELD_TO_COLUMN maps every PROJECT_FIELD", async () => {
    const { PROJECT_FIELDS, PROJECT_FIELD_TO_COLUMN } = await import("./operations-utils");
    for (const field of PROJECT_FIELDS) {
      expect(PROJECT_FIELD_TO_COLUMN[field]).toBeDefined();
    }
  });

  it("WEEK_ITEM_FIELD_TO_COLUMN maps every WEEK_ITEM_FIELD", async () => {
    const { WEEK_ITEM_FIELDS, WEEK_ITEM_FIELD_TO_COLUMN } = await import("./operations-utils");
    for (const field of WEEK_ITEM_FIELDS) {
      expect(WEEK_ITEM_FIELD_TO_COLUMN[field]).toBeDefined();
    }
  });
});

// ── DB-Dependent Tests ──────────────────────────────────

describe("getClientOrFail", () => {
  it("returns ok:true with client when found", async () => {
    const client = { id: "c1", name: "Convergix", slug: "convergix" };
    mockSelectFrom.mockReturnValue(chainable([client]));
    const { getClientOrFail } = await import("./operations-utils");
    const result = await getClientOrFail("convergix");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.client.name).toBe("Convergix");
  });

  it("returns ok:false when client not found", async () => {
    mockSelectFrom.mockReturnValue(chainable([]));
    const { getClientOrFail } = await import("./operations-utils");
    const result = await getClientOrFail("nonexistent");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("nonexistent");
  });
});

describe("checkIdempotency", () => {
  it("returns true when record exists", async () => {
    mockSelectFrom.mockReturnValue(chainable([{ id: "u1" }]));
    const { checkIdempotency } = await import("./operations-utils");
    expect(await checkIdempotency("some-key")).toBe(true);
  });

  it("returns false when no record exists", async () => {
    mockSelectFrom.mockReturnValue(chainable([]));
    const { checkIdempotency } = await import("./operations-utils");
    expect(await checkIdempotency("some-key")).toBe(false);
  });
});

describe("checkDuplicate", () => {
  it("returns null when no duplicate exists", async () => {
    mockSelectFrom.mockReturnValue(chainable([]));
    const { checkDuplicate } = await import("./operations-utils");
    const result = await checkDuplicate("key", { ok: true, message: "dup" });
    expect(result).toBeNull();
  });

  it("returns the duplicate result when key exists", async () => {
    mockSelectFrom.mockReturnValue(chainable([{ id: "existing" }]));
    const { checkDuplicate } = await import("./operations-utils");
    const dupResult = { ok: true as const, message: "Already done." };
    const result = await checkDuplicate("key", dupResult);
    expect(result).toBe(dupResult);
  });
});

describe("insertAuditRecord", () => {
  it("inserts record with all fields", async () => {
    const { insertAuditRecord } = await import("./operations-utils");
    await insertAuditRecord({
      idempotencyKey: "key-123",
      projectId: "p1",
      clientId: "c1",
      updatedBy: "kathy",
      updateType: "status-change",
      previousValue: "active",
      newValue: "completed",
      summary: "Status changed",
      metadata: JSON.stringify({ field: "status" }),
    });
    expect(mockInsertValues).toHaveBeenCalledTimes(1);
    const inserted = mockInsertValues.mock.calls[0][0];
    expect(inserted.idempotencyKey).toBe("key-123");
    expect(inserted.projectId).toBe("p1");
    expect(inserted.updatedBy).toBe("kathy");
    expect(inserted.updateType).toBe("status-change");
    expect(inserted.summary).toBe("Status changed");
  });

  it("defaults optional fields to null", async () => {
    const { insertAuditRecord } = await import("./operations-utils");
    await insertAuditRecord({
      idempotencyKey: "key-456",
      updatedBy: "jason",
      updateType: "note",
      summary: "A note",
    });
    const inserted = mockInsertValues.mock.calls[0][0];
    expect(inserted.projectId).toBeNull();
    expect(inserted.clientId).toBeNull();
    expect(inserted.previousValue).toBeNull();
    expect(inserted.newValue).toBeNull();
  });

  it("generates a unique ID for each record", async () => {
    const { insertAuditRecord } = await import("./operations-utils");
    await insertAuditRecord({
      idempotencyKey: "k1", updatedBy: "a", updateType: "note", summary: "s1",
    });
    await insertAuditRecord({
      idempotencyKey: "k2", updatedBy: "a", updateType: "note", summary: "s2",
    });
    const id1 = mockInsertValues.mock.calls[0][0].id;
    const id2 = mockInsertValues.mock.calls[1][0].id;
    expect(id1).not.toBe(id2);
  });
});

describe("resolveProjectOrFail", () => {
  it("returns project on exact match", async () => {
    const project = { id: "p1", name: "CDS Messaging", clientId: "c1" };
    // First call: clients cache, second call: projects for fuzzy match
    let callCount = 0;
    mockSelectFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // getCachedClients (for getClientOrFail path, but resolveProjectOrFail
        // calls findProjectByFuzzyNameWithDisambiguation which queries projects)
        return chainable([project]);
      }
      return chainable([project]);
    });
    const { resolveProjectOrFail } = await import("./operations-utils");
    const result = await resolveProjectOrFail("c1", "Convergix", "CDS Messaging");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.project.name).toBe("CDS Messaging");
  });

  it("returns error with available options when ambiguous", async () => {
    const projects = [
      { id: "p1", name: "Impact Report Dev", clientId: "c1" },
      { id: "p2", name: "Impact Report Design", clientId: "c1" },
    ];
    mockSelectFrom.mockReturnValue(chainable(projects));
    const { resolveProjectOrFail } = await import("./operations-utils");
    const result = await resolveProjectOrFail("c1", "Convergix", "Impact Report");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Multiple projects match");
      expect(result.available).toContain("Impact Report Dev");
      expect(result.available).toContain("Impact Report Design");
    }
  });

  it("returns error with available options when not found", async () => {
    const projects = [
      { id: "p1", name: "CDS Messaging", clientId: "c1", sortOrder: 0 },
    ];
    // First call for fuzzy match (returns projects), second for getProjectsForClient
    mockSelectFrom.mockReturnValue(chainable(projects));
    const { resolveProjectOrFail } = await import("./operations-utils");
    const result = await resolveProjectOrFail("c1", "Convergix", "Nonexistent");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not found");
      expect(result.error).toContain("Convergix");
      expect(result.available).toContain("CDS Messaging");
    }
  });
});

describe("resolveWeekItemOrFail", () => {
  it("returns item on exact match", async () => {
    const item = { id: "wi1", title: "CDS Review", weekOf: "2026-04-06" };
    mockSelectFrom.mockReturnValue(chainable([item]));
    const { resolveWeekItemOrFail } = await import("./operations-utils");
    const result = await resolveWeekItemOrFail("2026-04-06", "CDS Review");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.item.title).toBe("CDS Review");
  });

  it("returns error when ambiguous", async () => {
    const items = [
      { id: "wi1", title: "CDS Review", weekOf: "2026-04-06" },
      { id: "wi2", title: "CDS Delivery", weekOf: "2026-04-06" },
    ];
    mockSelectFrom.mockReturnValue(chainable(items));
    const { resolveWeekItemOrFail } = await import("./operations-utils");
    const result = await resolveWeekItemOrFail("2026-04-06", "CDS");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Multiple week items match");
      expect(result.available).toContain("CDS Review");
      expect(result.available).toContain("CDS Delivery");
    }
  });

  it("returns error with available items when not found", async () => {
    const items = [
      { id: "wi1", title: "CDS Review", weekOf: "2026-04-06", sortOrder: 0 },
    ];
    mockSelectFrom.mockReturnValue(chainable(items));
    const { resolveWeekItemOrFail } = await import("./operations-utils");
    const result = await resolveWeekItemOrFail("2026-04-06", "Nonexistent");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not found");
      expect(result.available).toContain("CDS Review");
    }
  });
});

describe("getProjectsForClient", () => {
  it("returns projects ordered by sortOrder", async () => {
    const projects = [
      { id: "p1", name: "A", clientId: "c1", sortOrder: 0 },
      { id: "p2", name: "B", clientId: "c1", sortOrder: 1 },
    ];
    mockSelectFrom.mockReturnValue(chainable(projects));
    const { getProjectsForClient } = await import("./operations-utils");
    const result = await getProjectsForClient("c1");
    expect(result).toHaveLength(2);
  });
});

describe("getWeekItemsForWeek", () => {
  it("returns items for given week", async () => {
    const items = [
      { id: "wi1", title: "Review", weekOf: "2026-04-06", sortOrder: 0 },
    ];
    mockSelectFrom.mockReturnValue(chainable(items));
    const { getWeekItemsForWeek } = await import("./operations-utils");
    const result = await getWeekItemsForWeek("2026-04-06");
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Review");
  });

  it("returns empty array when no items exist", async () => {
    mockSelectFrom.mockReturnValue(chainable([]));
    const { getWeekItemsForWeek } = await import("./operations-utils");
    const result = await getWeekItemsForWeek("2030-01-01");
    expect(result).toEqual([]);
  });
});

describe("client cache", () => {
  it("getAllClients returns cached clients", async () => {
    const clients = [
      { id: "c1", name: "Convergix", slug: "convergix" },
    ];
    mockSelectFrom.mockReturnValue(chainable(clients));
    const { getAllClients } = await import("./operations-utils");

    const result1 = await getAllClients();
    const result2 = await getAllClients();
    expect(result1).toEqual(result2);
    // Only one DB call due to caching
    expect(mockSelectFrom).toHaveBeenCalledTimes(1);
  });

  it("getClientBySlug finds client from cache", async () => {
    const clients = [
      { id: "c1", name: "Convergix", slug: "convergix" },
      { id: "c2", name: "LPPC", slug: "lppc" },
    ];
    mockSelectFrom.mockReturnValue(chainable(clients));
    const { getClientBySlug } = await import("./operations-utils");
    const result = await getClientBySlug("lppc");
    expect(result?.name).toBe("LPPC");
  });

  it("getClientBySlug returns null for unknown slug", async () => {
    mockSelectFrom.mockReturnValue(chainable([]));
    const { getClientBySlug } = await import("./operations-utils");
    const result = await getClientBySlug("nonexistent");
    expect(result).toBeNull();
  });

  it("getClientNameMap returns id-to-name map", async () => {
    const clients = [
      { id: "c1", name: "Convergix", slug: "convergix" },
      { id: "c2", name: "LPPC", slug: "lppc" },
    ];
    mockSelectFrom.mockReturnValue(chainable(clients));
    const { getClientNameMap } = await import("./operations-utils");
    const map = await getClientNameMap();
    expect(map.get("c1")).toBe("Convergix");
    expect(map.get("c2")).toBe("LPPC");
  });
});
