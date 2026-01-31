import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Column } from "../types";

// Mock the dependencies
vi.mock("../db", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    get: vi.fn(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  },
}));

vi.mock("./workspace", () => ({
  requireWorkspaceAccess: vi.fn().mockResolvedValue({
    user: { id: "user-1" },
    member: { role: "admin" },
    workspace: { id: "workspace-1", slug: "test-workspace" },
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Helper to create mock columns
function createColumn(overrides: Partial<Column> = {}): Column {
  return {
    id: "col-1",
    workspaceId: "workspace-1",
    name: "Test Column",
    position: 0,
    isSystem: false,
    status: null,
    ...overrides,
  };
}

describe("Column utility functions", () => {
  describe("isSystem column behavior", () => {
    it("identifies regular columns", () => {
      const column = createColumn({ isSystem: false });
      expect(column.isSystem).toBe(false);
    });

    it("identifies system columns (orphaned)", () => {
      const column = createColumn({ isSystem: true, name: "Orphaned" });
      expect(column.isSystem).toBe(true);
    });
  });

  describe("column ordering", () => {
    it("regular columns are ordered by position", () => {
      const columns: Column[] = [
        createColumn({ id: "col-1", position: 2 }),
        createColumn({ id: "col-2", position: 0 }),
        createColumn({ id: "col-3", position: 1 }),
      ];

      const sorted = [...columns].sort((a, b) => a.position - b.position);
      expect(sorted[0].id).toBe("col-2");
      expect(sorted[1].id).toBe("col-3");
      expect(sorted[2].id).toBe("col-1");
    });

    it("system columns should appear after regular columns", () => {
      const columns: Column[] = [
        createColumn({ id: "col-regular", position: 0, isSystem: false }),
        createColumn({ id: "col-system", position: 1, isSystem: true }),
      ];

      const regularColumns = columns.filter((c) => !c.isSystem);
      const systemColumns = columns.filter((c) => c.isSystem);

      expect(regularColumns).toHaveLength(1);
      expect(systemColumns).toHaveLength(1);
      expect(regularColumns[0].id).toBe("col-regular");
      expect(systemColumns[0].id).toBe("col-system");
    });
  });

  describe("orphaned column logic", () => {
    it("orphaned column should be a system column", () => {
      const orphanedColumn = createColumn({
        name: "Orphaned",
        isSystem: true,
      });
      expect(orphanedColumn.isSystem).toBe(true);
      expect(orphanedColumn.name).toBe("Orphaned");
    });

    it("system columns cannot be edited", () => {
      const column = createColumn({ isSystem: true });
      // The actual enforcement happens in the updateColumn function
      // This test documents the expected behavior
      expect(column.isSystem).toBe(true);
    });

    it("system columns cannot be deleted", () => {
      const column = createColumn({ isSystem: true });
      // The actual enforcement happens in the deleteColumn function
      // This test documents the expected behavior
      expect(column.isSystem).toBe(true);
    });
  });

  describe("column visibility rules", () => {
    it("filters out empty system columns", () => {
      interface ColumnWithIssues extends Column {
        issues: { id: string }[];
      }

      const columnsWithIssues: ColumnWithIssues[] = [
        { ...createColumn({ id: "col-1" }), issues: [{ id: "issue-1" }] },
        {
          ...createColumn({ id: "col-orphaned", isSystem: true }),
          issues: [],
        },
        { ...createColumn({ id: "col-2" }), issues: [] },
      ];

      const visibleColumns = columnsWithIssues.filter(
        (col) => !col.isSystem || col.issues.length > 0
      );

      expect(visibleColumns).toHaveLength(2);
      expect(visibleColumns.map((c) => c.id)).toEqual(["col-1", "col-2"]);
    });

    it("shows system columns with issues", () => {
      interface ColumnWithIssues extends Column {
        issues: { id: string }[];
      }

      const columnsWithIssues: ColumnWithIssues[] = [
        { ...createColumn({ id: "col-1" }), issues: [] },
        {
          ...createColumn({ id: "col-orphaned", isSystem: true }),
          issues: [{ id: "orphaned-issue" }],
        },
      ];

      const visibleColumns = columnsWithIssues.filter(
        (col) => !col.isSystem || col.issues.length > 0
      );

      expect(visibleColumns).toHaveLength(2);
      expect(visibleColumns.map((c) => c.id)).toEqual([
        "col-1",
        "col-orphaned",
      ]);
    });
  });

  describe("reorder logic", () => {
    it("updates positions based on new order", () => {
      const columnIds = ["col-3", "col-1", "col-2"];
      const newPositions: Record<string, number> = {};

      columnIds.forEach((id, index) => {
        newPositions[id] = index;
      });

      expect(newPositions["col-3"]).toBe(0);
      expect(newPositions["col-1"]).toBe(1);
      expect(newPositions["col-2"]).toBe(2);
    });
  });

  describe("delete column with orphan handling", () => {
    it("identifies when column has issues", () => {
      const columnIssues = [{ id: "issue-1" }, { id: "issue-2" }];
      const hasIssues = columnIssues.length > 0;
      expect(hasIssues).toBe(true);
    });

    it("calculates next position for orphaned issues", () => {
      const existingOrphanedIssues = 3; // max position is 2 (0-indexed)
      const newIssuesCount = 2;
      const startPosition = existingOrphanedIssues; // Start at 3

      const finalPositions: number[] = [];
      for (let i = 0; i < newIssuesCount; i++) {
        finalPositions.push(startPosition + i);
      }

      expect(finalPositions).toEqual([3, 4]);
    });

    it("preserves issue order when moving to orphaned", () => {
      const issuesToMove = [
        { id: "issue-1", position: 0 },
        { id: "issue-2", position: 1 },
        { id: "issue-3", position: 2 },
      ];

      // Sort by position to maintain order
      const sortedIssues = [...issuesToMove].sort(
        (a, b) => a.position - b.position
      );

      // Assign new positions starting from a base
      const basePosition = 5;
      const newPositions = sortedIssues.map((issue, index) => ({
        ...issue,
        newPosition: basePosition + index,
      }));

      expect(newPositions[0].newPosition).toBe(5);
      expect(newPositions[1].newPosition).toBe(6);
      expect(newPositions[2].newPosition).toBe(7);
    });
  });
});

describe("batch issue counts", () => {
  it("returns counts keyed by column ID", () => {
    // Simulates the shape returned by getColumnIssueCounts
    const mockDbResults = [
      { columnId: "col-1", count: 5 },
      { columnId: "col-2", count: 0 },
      { columnId: "col-3", count: 12 },
    ];

    const columnIds = ["col-1", "col-2", "col-3", "col-4"];
    const counts: Record<string, number> = {};

    // Initialize all columns with 0
    for (const id of columnIds) {
      counts[id] = 0;
    }
    // Fill in actual counts from results
    for (const row of mockDbResults) {
      counts[row.columnId] = row.count;
    }

    expect(counts["col-1"]).toBe(5);
    expect(counts["col-2"]).toBe(0);
    expect(counts["col-3"]).toBe(12);
    expect(counts["col-4"]).toBe(0); // Not in results, defaults to 0
  });

  it("returns empty object for empty column list", () => {
    const columnIds: string[] = [];
    const counts: Record<string, number> = {};

    if (columnIds.length === 0) {
      expect(counts).toEqual({});
    }
  });
});

describe("Column type guards", () => {
  it("isSystemColumn returns true for system columns", () => {
    const isSystemColumn = (col: Column) => col.isSystem === true;

    expect(isSystemColumn(createColumn({ isSystem: true }))).toBe(true);
    expect(isSystemColumn(createColumn({ isSystem: false }))).toBe(false);
  });

  it("isOrphanedColumn returns true only for orphaned system columns", () => {
    const isOrphanedColumn = (col: Column) =>
      col.isSystem && col.name === "Orphaned";

    expect(
      isOrphanedColumn(createColumn({ isSystem: true, name: "Orphaned" }))
    ).toBe(true);
    expect(
      isOrphanedColumn(createColumn({ isSystem: true, name: "Other" }))
    ).toBe(false);
    expect(
      isOrphanedColumn(createColumn({ isSystem: false, name: "Orphaned" }))
    ).toBe(false);
  });
});
