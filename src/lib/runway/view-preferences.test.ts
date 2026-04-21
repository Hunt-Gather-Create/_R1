import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock state for the DB chain.
const mockSelectRows: unknown[] = [];
const mockInsert = vi.fn();
const mockUpdate = vi.fn();

function resetState() {
  mockSelectRows.length = 0;
  mockInsert.mockReset();
  mockUpdate.mockReset();
}

function makeChain() {
  const chain: Record<string, unknown> = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve([...mockSelectRows])),
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
});
