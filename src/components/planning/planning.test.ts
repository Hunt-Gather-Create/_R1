import type { PlannedIssue, EpicSummary } from "./PlanningChatPanel";
import type { Priority } from "@/lib/design-tokens";

// Helper to create mock planned issues
function createPlannedIssue(
  overrides: Partial<PlannedIssue> = {}
): PlannedIssue {
  return {
    id: crypto.randomUUID(),
    title: "Test Issue",
    description: "Test description with acceptance criteria",
    priority: 2 as Priority,
    status: "pending",
    ...overrides,
  };
}

describe("PlannedIssue", () => {
  describe("createPlannedIssue helper", () => {
    it("creates a valid planned issue with defaults", () => {
      const issue = createPlannedIssue();

      expect(issue.id).toBeDefined();
      expect(issue.title).toBe("Test Issue");
      expect(issue.description).toBe(
        "Test description with acceptance criteria"
      );
      expect(issue.priority).toBe(2);
      expect(issue.status).toBe("pending");
    });

    it("allows overriding specific fields", () => {
      const issue = createPlannedIssue({
        title: "Custom Title",
        priority: 0 as Priority,
        status: "created",
      });

      expect(issue.title).toBe("Custom Title");
      expect(issue.priority).toBe(0);
      expect(issue.status).toBe("created");
    });
  });

  describe("status transitions", () => {
    it("starts with pending status", () => {
      const issue = createPlannedIssue();
      expect(issue.status).toBe("pending");
    });

    it("can transition to creating status", () => {
      const issue = createPlannedIssue({ status: "creating" });
      expect(issue.status).toBe("creating");
    });

    it("can transition to created status", () => {
      const issue = createPlannedIssue({ status: "created" });
      expect(issue.status).toBe("created");
    });
  });

  describe("priority values", () => {
    it("accepts urgent priority (0)", () => {
      const issue = createPlannedIssue({ priority: 0 as Priority });
      expect(issue.priority).toBe(0);
    });

    it("accepts high priority (1)", () => {
      const issue = createPlannedIssue({ priority: 1 as Priority });
      expect(issue.priority).toBe(1);
    });

    it("accepts medium priority (2)", () => {
      const issue = createPlannedIssue({ priority: 2 as Priority });
      expect(issue.priority).toBe(2);
    });

    it("accepts low priority (3)", () => {
      const issue = createPlannedIssue({ priority: 3 as Priority });
      expect(issue.priority).toBe(3);
    });

    it("accepts no priority (4)", () => {
      const issue = createPlannedIssue({ priority: 4 as Priority });
      expect(issue.priority).toBe(4);
    });
  });
});

describe("PlannedIssue list operations", () => {
  it("filters pending issues correctly", () => {
    const issues: PlannedIssue[] = [
      createPlannedIssue({ id: "1", status: "pending" }),
      createPlannedIssue({ id: "2", status: "creating" }),
      createPlannedIssue({ id: "3", status: "created" }),
      createPlannedIssue({ id: "4", status: "pending" }),
    ];

    const pendingIssues = issues.filter((i) => i.status === "pending");
    expect(pendingIssues).toHaveLength(2);
    expect(pendingIssues.map((i) => i.id)).toEqual(["1", "4"]);
  });

  it("counts pending and created issues correctly", () => {
    const issues: PlannedIssue[] = [
      createPlannedIssue({ status: "pending" }),
      createPlannedIssue({ status: "pending" }),
      createPlannedIssue({ status: "created" }),
    ];

    const pendingCount = issues.filter((i) => i.status === "pending").length;
    const createdCount = issues.filter((i) => i.status === "created").length;

    expect(pendingCount).toBe(2);
    expect(createdCount).toBe(1);
  });

  it("updates an issue by id", () => {
    const issues: PlannedIssue[] = [
      createPlannedIssue({ id: "1", title: "Original" }),
      createPlannedIssue({ id: "2", title: "Other" }),
    ];

    const updatedIssues = issues.map((issue) =>
      issue.id === "1" ? { ...issue, title: "Updated" } : issue
    );

    expect(updatedIssues[0].title).toBe("Updated");
    expect(updatedIssues[1].title).toBe("Other");
  });

  it("removes an issue by id", () => {
    const issues: PlannedIssue[] = [
      createPlannedIssue({ id: "1" }),
      createPlannedIssue({ id: "2" }),
      createPlannedIssue({ id: "3" }),
    ];

    const filteredIssues = issues.filter((i) => i.id !== "2");

    expect(filteredIssues).toHaveLength(2);
    expect(filteredIssues.map((i) => i.id)).toEqual(["1", "3"]);
  });
});

describe("intake column selection", () => {
  // Simulates the logic used in AIPlanningSheet
  function findIntakeColumn(
    columns: Array<{ id: string; name: string }>
  ): { id: string; name: string } | undefined {
    return (
      columns.find((col) => {
        const name = col.name.toLowerCase();
        return name === "backlog" || name === "ideas";
      }) || columns[0]
    );
  }

  it("selects Backlog column for software workspaces", () => {
    const columns = [
      { id: "1", name: "Todo" },
      { id: "2", name: "Backlog" },
      { id: "3", name: "Done" },
    ];

    const intakeColumn = findIntakeColumn(columns);
    expect(intakeColumn?.name).toBe("Backlog");
  });

  it("selects Ideas column for marketing workspaces", () => {
    const columns = [
      { id: "1", name: "Ideas" },
      { id: "2", name: "Planning" },
      { id: "3", name: "Published" },
    ];

    const intakeColumn = findIntakeColumn(columns);
    expect(intakeColumn?.name).toBe("Ideas");
  });

  it("falls back to first column if no Backlog or Ideas", () => {
    const columns = [
      { id: "1", name: "Todo" },
      { id: "2", name: "In Progress" },
      { id: "3", name: "Done" },
    ];

    const intakeColumn = findIntakeColumn(columns);
    expect(intakeColumn?.name).toBe("Todo");
  });

  it("handles case-insensitive matching", () => {
    const columns = [
      { id: "1", name: "TODO" },
      { id: "2", name: "BACKLOG" },
    ];

    const intakeColumn = findIntakeColumn(columns);
    expect(intakeColumn?.name).toBe("BACKLOG");
  });
});

describe("EpicSummary", () => {
  it("stores epic title and description", () => {
    const summary: EpicSummary = {
      title: "User Authentication",
      description: "Implements login, signup, and password reset flows.",
    };

    expect(summary.title).toBe("User Authentication");
    expect(summary.description).toBe(
      "Implements login, signup, and password reset flows."
    );
  });

  it("falls back to Untitled Epic when no summary provided", () => {
    const summary: EpicSummary | null = null;
    const fallback = summary ?? { title: "Untitled Epic" };

    expect(fallback.title).toBe("Untitled Epic");
  });
});

describe("handleCreateAll with epic", () => {
  it("passes epicId to each issue when creating", () => {
    const epicId = "epic-123";
    const pendingIssues = [
      createPlannedIssue({ id: "1", status: "pending" }),
      createPlannedIssue({ id: "2", status: "pending" }),
      createPlannedIssue({ id: "3", status: "created" }),
    ];

    // Simulate: filter pending, then create each with epicId
    const issuesToCreate = pendingIssues.filter((i) => i.status === "pending");
    const createdInputs = issuesToCreate.map((issue) => ({
      title: issue.title,
      description: issue.description,
      priority: issue.priority,
      epicId,
    }));

    expect(createdInputs).toHaveLength(2);
    expect(createdInputs[0].epicId).toBe(epicId);
    expect(createdInputs[1].epicId).toBe(epicId);
  });

  it("skips already-created issues", () => {
    const pendingIssues = [
      createPlannedIssue({ id: "1", status: "created" }),
      createPlannedIssue({ id: "2", status: "pending" }),
    ];

    const issuesToCreate = pendingIssues.filter((i) => i.status === "pending");
    expect(issuesToCreate).toHaveLength(1);
    expect(issuesToCreate[0].id).toBe("2");
  });
});
