import {
  filterIssues,
  serializeFilters,
  deserializeFilters,
  countActiveFilters,
  DEFAULT_FILTER_STATE,
  type FilterState,
} from "./filters";
import type { IssueWithLabels } from "./types";
import type { Label } from "./types";

// Helper to create mock labels
function createLabel(overrides: Partial<Label> = {}): Label {
  return {
    id: "label-1",
    workspaceId: "workspace-1",
    name: "Bug",
    color: "#ef4444",
    createdAt: new Date(),
    ...overrides,
  };
}

// Helper to create mock issues
function createIssue(
  overrides: Partial<IssueWithLabels> = {}
): IssueWithLabels {
  return {
    id: "issue-1",
    columnId: "column-1",
    identifier: "PROJ-1",
    title: "Test Issue",
    description: null,
    status: "todo",
    priority: 2,
    estimate: null,
    dueDate: null,
    cycleId: null,
    parentIssueId: null,
    position: 0,
    sentToAI: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    labels: [],
    ...overrides,
  };
}

describe("filterIssues", () => {
  const bugLabel = createLabel({ id: "label-bug", name: "Bug" });
  const featureLabel = createLabel({ id: "label-feature", name: "Feature" });

  const issues: IssueWithLabels[] = [
    createIssue({
      id: "1",
      title: "Fix login bug",
      status: "in_progress",
      priority: 0,
      labels: [bugLabel],
      cycleId: "cycle-1",
      dueDate: new Date("2025-01-01"), // Past date (overdue)
    }),
    createIssue({
      id: "2",
      title: "Add dark mode",
      description: "Support dark theme",
      status: "todo",
      priority: 2,
      labels: [featureLabel],
      cycleId: null,
      dueDate: new Date("2030-12-31"), // Future date
    }),
    createIssue({
      id: "3",
      identifier: "PROJ-3",
      title: "Update documentation",
      status: "backlog",
      priority: 4,
      labels: [],
      cycleId: "cycle-2",
      dueDate: null,
    }),
  ];

  it("returns all issues when no filters are active", () => {
    const result = filterIssues(issues, DEFAULT_FILTER_STATE);
    expect(result).toHaveLength(3);
  });

  describe("status filter", () => {
    it("filters by single status", () => {
      const result = filterIssues(issues, {
        ...DEFAULT_FILTER_STATE,
        status: ["todo"],
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("2");
    });

    it("filters by multiple statuses", () => {
      const result = filterIssues(issues, {
        ...DEFAULT_FILTER_STATE,
        status: ["todo", "in_progress"],
      });
      expect(result).toHaveLength(2);
    });
  });

  describe("priority filter", () => {
    it("filters by single priority", () => {
      const result = filterIssues(issues, {
        ...DEFAULT_FILTER_STATE,
        priority: [0], // Urgent
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("1");
    });

    it("filters by multiple priorities", () => {
      const result = filterIssues(issues, {
        ...DEFAULT_FILTER_STATE,
        priority: [0, 2], // Urgent and Medium
      });
      expect(result).toHaveLength(2);
    });
  });

  describe("labels filter", () => {
    it("filters by label (any match)", () => {
      const result = filterIssues(issues, {
        ...DEFAULT_FILTER_STATE,
        labels: ["label-bug"],
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("1");
    });

    it("matches any of multiple labels", () => {
      const result = filterIssues(issues, {
        ...DEFAULT_FILTER_STATE,
        labels: ["label-bug", "label-feature"],
      });
      expect(result).toHaveLength(2);
    });

    it("excludes issues with no matching labels", () => {
      const result = filterIssues(issues, {
        ...DEFAULT_FILTER_STATE,
        labels: ["label-nonexistent"],
      });
      expect(result).toHaveLength(0);
    });
  });

  describe("cycle filter", () => {
    it("filters by cycle", () => {
      const result = filterIssues(issues, {
        ...DEFAULT_FILTER_STATE,
        cycleId: "cycle-1",
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("1");
    });
  });

  describe("hasDueDate filter", () => {
    it("filters issues with due date", () => {
      const result = filterIssues(issues, {
        ...DEFAULT_FILTER_STATE,
        hasDueDate: true,
      });
      expect(result).toHaveLength(2);
      expect(result.every((i) => i.dueDate !== null)).toBe(true);
    });

    it("filters issues without due date", () => {
      const result = filterIssues(issues, {
        ...DEFAULT_FILTER_STATE,
        hasDueDate: false,
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("3");
    });
  });

  describe("isOverdue filter", () => {
    it("filters overdue issues", () => {
      const result = filterIssues(issues, {
        ...DEFAULT_FILTER_STATE,
        isOverdue: true,
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("1"); // Due date in past
    });
  });

  describe("search filter", () => {
    it("searches by title", () => {
      const result = filterIssues(issues, {
        ...DEFAULT_FILTER_STATE,
        search: "login",
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("1");
    });

    it("searches by identifier", () => {
      const result = filterIssues(issues, {
        ...DEFAULT_FILTER_STATE,
        search: "PROJ-3",
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("3");
    });

    it("searches by description", () => {
      const result = filterIssues(issues, {
        ...DEFAULT_FILTER_STATE,
        search: "dark theme",
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("2");
    });

    it("searches by label name", () => {
      const result = filterIssues(issues, {
        ...DEFAULT_FILTER_STATE,
        search: "feature",
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("2");
    });

    it("is case insensitive", () => {
      const result = filterIssues(issues, {
        ...DEFAULT_FILTER_STATE,
        search: "LOGIN",
      });
      expect(result).toHaveLength(1);
    });
  });

  describe("combined filters", () => {
    it("combines multiple filters with AND logic", () => {
      const result = filterIssues(issues, {
        ...DEFAULT_FILTER_STATE,
        status: ["todo", "in_progress"],
        priority: [0, 2],
      });
      // Only issues matching BOTH filters
      expect(result).toHaveLength(2);
    });

    it("returns empty when no issues match all filters", () => {
      const result = filterIssues(issues, {
        ...DEFAULT_FILTER_STATE,
        status: ["done"],
        priority: [0],
      });
      expect(result).toHaveLength(0);
    });
  });
});

describe("serializeFilters / deserializeFilters", () => {
  it("roundtrips empty filter state", () => {
    const params = serializeFilters(DEFAULT_FILTER_STATE);
    const result = deserializeFilters(params);
    expect(result).toEqual(DEFAULT_FILTER_STATE);
  });

  it("roundtrips status filter", () => {
    const filters: FilterState = {
      ...DEFAULT_FILTER_STATE,
      status: ["todo", "in_progress"],
    };
    const params = serializeFilters(filters);
    const result = deserializeFilters(params);
    expect(result.status).toEqual(["todo", "in_progress"]);
  });

  it("roundtrips priority filter", () => {
    const filters: FilterState = {
      ...DEFAULT_FILTER_STATE,
      priority: [0, 2],
    };
    const params = serializeFilters(filters);
    const result = deserializeFilters(params);
    expect(result.priority).toEqual([0, 2]);
  });

  it("roundtrips labels filter", () => {
    const filters: FilterState = {
      ...DEFAULT_FILTER_STATE,
      labels: ["label-1", "label-2"],
    };
    const params = serializeFilters(filters);
    const result = deserializeFilters(params);
    expect(result.labels).toEqual(["label-1", "label-2"]);
  });

  it("roundtrips cycleId filter", () => {
    const filters: FilterState = {
      ...DEFAULT_FILTER_STATE,
      cycleId: "cycle-123",
    };
    const params = serializeFilters(filters);
    const result = deserializeFilters(params);
    expect(result.cycleId).toBe("cycle-123");
  });

  it("roundtrips hasDueDate filter", () => {
    const filters: FilterState = {
      ...DEFAULT_FILTER_STATE,
      hasDueDate: true,
    };
    const params = serializeFilters(filters);
    const result = deserializeFilters(params);
    expect(result.hasDueDate).toBe(true);
  });

  it("roundtrips isOverdue filter", () => {
    const filters: FilterState = {
      ...DEFAULT_FILTER_STATE,
      isOverdue: true,
    };
    const params = serializeFilters(filters);
    const result = deserializeFilters(params);
    expect(result.isOverdue).toBe(true);
  });

  it("roundtrips search filter", () => {
    const filters: FilterState = {
      ...DEFAULT_FILTER_STATE,
      search: "test query",
    };
    const params = serializeFilters(filters);
    const result = deserializeFilters(params);
    expect(result.search).toBe("test query");
  });

  it("produces empty params for default state", () => {
    const params = serializeFilters(DEFAULT_FILTER_STATE);
    expect(params.toString()).toBe("");
  });

  it("serializes all filter types correctly", () => {
    const filters: FilterState = {
      status: ["todo"],
      priority: [1],
      labels: ["label-1"],
      cycleId: "cycle-1",
      hasDueDate: true,
      isOverdue: false,
      search: "query",
    };
    const params = serializeFilters(filters);
    expect(params.get("status")).toBe("todo");
    expect(params.get("priority")).toBe("1");
    expect(params.get("labels")).toBe("label-1");
    expect(params.get("cycle")).toBe("cycle-1");
    expect(params.get("hasDueDate")).toBe("true");
    expect(params.get("isOverdue")).toBe("false");
    expect(params.get("q")).toBe("query");
  });
});

describe("countActiveFilters", () => {
  it("returns 0 for default state", () => {
    expect(countActiveFilters(DEFAULT_FILTER_STATE)).toBe(0);
  });

  it("counts each active filter type", () => {
    expect(
      countActiveFilters({
        ...DEFAULT_FILTER_STATE,
        status: ["todo"],
      })
    ).toBe(1);

    expect(
      countActiveFilters({
        ...DEFAULT_FILTER_STATE,
        status: ["todo"],
        priority: [0],
      })
    ).toBe(2);

    expect(
      countActiveFilters({
        ...DEFAULT_FILTER_STATE,
        status: ["todo"],
        priority: [0],
        labels: ["label-1"],
        cycleId: "cycle-1",
        hasDueDate: true,
        isOverdue: true,
      })
    ).toBe(6);
  });

  it("does not count search as a filter", () => {
    expect(
      countActiveFilters({
        ...DEFAULT_FILTER_STATE,
        search: "query",
      })
    ).toBe(0);
  });
});
