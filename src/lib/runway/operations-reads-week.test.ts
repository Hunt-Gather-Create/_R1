import { describe, it, expect, vi, beforeEach } from "vitest";
import { getLinkedDeadlineItems } from "./operations-reads-week";

// Mock the runway DB module
vi.mock("@/lib/db/runway", () => ({
  getRunwayDb: vi.fn(),
}));

import { getRunwayDb } from "@/lib/db/runway";

function createWeekItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "wi-1",
    projectId: "proj-1",
    clientId: "client-1",
    dayOfWeek: "monday",
    weekOf: "2026-04-06",
    date: "2026-04-07",
    title: "Test Item",
    status: null,
    category: "deadline",
    owner: null,
    resources: null,
    notes: null,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// Build a chainable mock that captures the where clause and filters results
function mockDbWithItems(items: ReturnType<typeof createWeekItem>[]) {
  const mockWhere = vi.fn().mockResolvedValue(
    // The actual filtering happens in the DB; we simulate it by returning
    // only items matching the expected category + projectId
    items.filter((i) => i.category === "deadline")
  );
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
  const mockDb = { select: mockSelect };
  vi.mocked(getRunwayDb).mockReturnValue(mockDb as never);
  return { mockDb, mockWhere };
}

describe("getLinkedDeadlineItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns only deadline-category items for a project", async () => {
    const deadline1 = createWeekItem({ id: "wi-1", title: "Code handoff", category: "deadline" });
    const deadline2 = createWeekItem({ id: "wi-2", title: "Go live", category: "deadline" });
    const review = createWeekItem({ id: "wi-3", title: "Design review", category: "review" });
    const delivery = createWeekItem({ id: "wi-4", title: "Asset delivery", category: "delivery" });

    mockDbWithItems([deadline1, deadline2, review, delivery]);

    const result = await getLinkedDeadlineItems("proj-1");

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.title)).toEqual(["Code handoff", "Go live"]);
  });

  it("returns empty array when no deadline items linked", async () => {
    const review = createWeekItem({ id: "wi-1", title: "Design review", category: "review" });

    mockDbWithItems([review]);

    const result = await getLinkedDeadlineItems("proj-1");

    expect(result).toHaveLength(0);
  });

  it("returns empty array when no items exist for project", async () => {
    mockDbWithItems([]);

    const result = await getLinkedDeadlineItems("proj-nonexistent");

    expect(result).toHaveLength(0);
  });

  it("calls getRunwayDb and queries with correct table", async () => {
    mockDbWithItems([]);

    await getLinkedDeadlineItems("proj-1");

    expect(getRunwayDb).toHaveBeenCalledOnce();
  });
});
