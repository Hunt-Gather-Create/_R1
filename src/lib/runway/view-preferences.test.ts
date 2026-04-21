import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock state for the DB chain.
const mockSelectRows: unknown[] = [];
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
// When non-null, `makeChain`'s `.limit()` throws this error instead of
// resolving. Used to simulate SQLITE "no such table" responses.
let mockSelectError: Error | null = null;

function resetState() {
  mockSelectRows.length = 0;
  mockInsert.mockReset();
  mockUpdate.mockReset();
  mockSelectError = null;
}

function makeChain() {
  const chain: Record<string, unknown> = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() =>
      mockSelectError ? Promise.reject(mockSelectError) : Promise.resolve([...mockSelectRows]),
    ),
  };
  return chain;
}

vi.mock("@/lib/db/runway", () => ({
  getRunwayDb: () => ({
    select: vi.fn(() => makeChain()),
    insert: vi.fn(() => ({ values: mockInsert.mockResolvedValue(undefined) })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: mockUpdate.mockResolvedValue(undefined) })),
    })),
  }),
}));

vi.mock("@/lib/db/runway-schema", () => ({
  viewPreferences: { scope: "scope", preferences: "preferences" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  resetState();
});

describe("getViewPreferences", () => {
  it("returns defaults when row does not exist (inFlightToggle = true)", async () => {
    mockSelectRows.length = 0;

    const { getViewPreferences } = await import("./view-preferences");
    const prefs = await getViewPreferences();
    expect(prefs.inFlightToggle).toBe(true);
  });

  it("parses stored JSON into typed preferences", async () => {
    mockSelectRows.push({
      scope: "global",
      preferences: JSON.stringify({ inFlightToggle: false }),
    });

    const { getViewPreferences } = await import("./view-preferences");
    const prefs = await getViewPreferences();
    expect(prefs.inFlightToggle).toBe(false);
  });

  it("silently falls back to defaults for malformed JSON", async () => {
    mockSelectRows.push({
      scope: "global",
      preferences: "not-valid-json{",
    });

    const { getViewPreferences } = await import("./view-preferences");
    const prefs = await getViewPreferences();
    expect(prefs.inFlightToggle).toBe(true);
  });

  it("merges stored partial preferences with defaults", async () => {
    mockSelectRows.push({
      scope: "global",
      preferences: JSON.stringify({ someFutureKey: "val" }),
    });

    const { getViewPreferences } = await import("./view-preferences");
    const prefs = await getViewPreferences();
    expect(prefs.inFlightToggle).toBe(true);
  });

  it("falls back to defaults when view_preferences table does not exist", async () => {
    // Chunk 5 debt §13.1: cover the SQLITE "no such table" fallback branch —
    // this is the whole reason view-preferences reads are merge-safe before
    // `pnpm runway:push` applies the migration.
    mockSelectError = new Error("SQLITE_ERROR: no such table: view_preferences");

    const { getViewPreferences } = await import("./view-preferences");
    const prefs = await getViewPreferences();
    expect(prefs.inFlightToggle).toBe(true);
  });

  it("re-throws unrelated DB errors instead of swallowing", async () => {
    // The fallback should be narrowly scoped — other failures (permissions,
    // connection refused, disk I/O) must propagate so they're not masked.
    mockSelectError = new Error("some other sqlite error");

    const { getViewPreferences } = await import("./view-preferences");
    await expect(getViewPreferences()).rejects.toThrow("some other sqlite error");
  });
});

describe("setViewPreferences — no-such-table fallback", () => {
  it("returns the merged object when the table does not exist", async () => {
    // First select (for the merge) succeeds with empty defaults;
    // the subsequent select triggers the table-missing path in setViewPreferences.
    mockSelectError = new Error("SQLITE_ERROR: no such table: view_preferences");

    const { setViewPreferences } = await import("./view-preferences");
    const result = await setViewPreferences({ inFlightToggle: false });
    expect(result.inFlightToggle).toBe(false);
  });
});
