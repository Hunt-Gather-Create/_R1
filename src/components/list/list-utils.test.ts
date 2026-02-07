import { sortIssues } from "./list-utils";
import type { IssueWithLabels } from "@/lib/types";

function createIssue(overrides: Partial<IssueWithLabels> = {}): IssueWithLabels {
  return {
    id: "issue-1",
    columnId: "col-1",
    identifier: "AUTO-1",
    title: "Test issue",
    description: null,
    status: "todo",
    priority: 4,
    estimate: null,
    dueDate: null,
    cycleId: null,
    parentIssueId: null,
    assigneeId: null,
    position: 0,
    sentToAI: false,
    aiAssignable: false,
    aiInstructions: null,
    aiTools: null,
    aiExecutionStatus: null,
    aiJobId: null,
    aiExecutionResult: null,
    aiExecutionSummary: null,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    labels: [],
    ...overrides,
  };
}

describe("sortIssues", () => {
  const issues: IssueWithLabels[] = [
    createIssue({ id: "1", identifier: "AUTO-3", title: "Charlie", priority: 2, createdAt: new Date("2025-01-03") }),
    createIssue({ id: "2", identifier: "AUTO-1", title: "Alice", priority: 0, createdAt: new Date("2025-01-01") }),
    createIssue({ id: "3", identifier: "AUTO-2", title: "Bob", priority: 4, createdAt: new Date("2025-01-02") }),
  ];

  describe("sort by identifier", () => {
    it("sorts ascending", () => {
      const result = sortIssues(issues, "identifier", "asc");
      expect(result.map((i) => i.identifier)).toEqual(["AUTO-1", "AUTO-2", "AUTO-3"]);
    });

    it("sorts descending", () => {
      const result = sortIssues(issues, "identifier", "desc");
      expect(result.map((i) => i.identifier)).toEqual(["AUTO-3", "AUTO-2", "AUTO-1"]);
    });
  });

  describe("sort by title", () => {
    it("sorts ascending", () => {
      const result = sortIssues(issues, "title", "asc");
      expect(result.map((i) => i.title)).toEqual(["Alice", "Bob", "Charlie"]);
    });

    it("sorts descending", () => {
      const result = sortIssues(issues, "title", "desc");
      expect(result.map((i) => i.title)).toEqual(["Charlie", "Bob", "Alice"]);
    });
  });

  describe("sort by priority", () => {
    it("sorts ascending (urgent first)", () => {
      const result = sortIssues(issues, "priority", "asc");
      expect(result.map((i) => i.priority)).toEqual([0, 2, 4]);
    });

    it("sorts descending (none first)", () => {
      const result = sortIssues(issues, "priority", "desc");
      expect(result.map((i) => i.priority)).toEqual([4, 2, 0]);
    });
  });

  describe("sort by createdAt", () => {
    it("sorts ascending (oldest first)", () => {
      const result = sortIssues(issues, "createdAt", "asc");
      expect(result.map((i) => i.id)).toEqual(["2", "3", "1"]);
    });

    it("sorts descending (newest first)", () => {
      const result = sortIssues(issues, "createdAt", "desc");
      expect(result.map((i) => i.id)).toEqual(["1", "3", "2"]);
    });
  });

  describe("sort by dueDate", () => {
    it("places null dates at end when ascending", () => {
      const issuesWithDates = [
        createIssue({ id: "a", dueDate: null }),
        createIssue({ id: "b", dueDate: new Date("2025-03-01") }),
        createIssue({ id: "c", dueDate: new Date("2025-01-15") }),
      ];
      const result = sortIssues(issuesWithDates, "dueDate", "asc");
      expect(result.map((i) => i.id)).toEqual(["c", "b", "a"]);
    });
  });

  describe("sort by estimate", () => {
    it("sorts ascending with null estimates as 0", () => {
      const issuesWithEstimates = [
        createIssue({ id: "a", estimate: 5 }),
        createIssue({ id: "b", estimate: null }),
        createIssue({ id: "c", estimate: 3 }),
      ];
      const result = sortIssues(issuesWithEstimates, "estimate", "asc");
      expect(result.map((i) => i.id)).toEqual(["b", "c", "a"]);
    });
  });

  it("does not mutate the original array", () => {
    const original = [...issues];
    sortIssues(issues, "title", "asc");
    expect(issues).toEqual(original);
  });

  it("returns empty array for empty input", () => {
    expect(sortIssues([], "title", "asc")).toEqual([]);
  });
});
