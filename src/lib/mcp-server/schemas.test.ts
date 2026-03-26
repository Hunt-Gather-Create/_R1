import { describe, it, expect } from "vitest";
import {
  createIssueInput,
  updateIssueInput,
  createSubtaskInput,
  addCommentInput,
  listIssuesInput,
  searchKnowledgeInput,
  listCyclesInput,
} from "./schemas";

describe("createIssueInput", () => {
  it("accepts valid input with defaults", () => {
    const result = createIssueInput.parse({
      workspaceId: "ws_1",
      title: "My Issue",
    });
    expect(result.title).toBe("My Issue");
    expect(result.status).toBe("todo");
    expect(result.priority).toBe(4);
  });

  it("rejects empty title", () => {
    expect(() =>
      createIssueInput.parse({ workspaceId: "ws_1", title: "" })
    ).toThrow();
  });

  it("accepts all optional fields", () => {
    const result = createIssueInput.parse({
      workspaceId: "ws_1",
      title: "Full issue",
      description: "Some desc",
      status: "in_progress",
      priority: 1,
      labelIds: ["lbl_1"],
      cycleId: "cyc_1",
      epicId: "epic_1",
      assigneeId: "user_1",
      estimate: 3,
      dueDate: "2026-04-01",
    });
    expect(result.status).toBe("in_progress");
    expect(result.labelIds).toEqual(["lbl_1"]);
  });

  it("rejects invalid status", () => {
    expect(() =>
      createIssueInput.parse({
        workspaceId: "ws_1",
        title: "Test",
        status: "invalid",
      })
    ).toThrow();
  });

  it("rejects priority out of range", () => {
    expect(() =>
      createIssueInput.parse({
        workspaceId: "ws_1",
        title: "Test",
        priority: 5,
      })
    ).toThrow();
  });
});

describe("updateIssueInput", () => {
  it("requires issueId", () => {
    expect(() => updateIssueInput.parse({ title: "new" })).toThrow();
  });

  it("accepts nullable fields", () => {
    const result = updateIssueInput.parse({
      issueId: "iss_1",
      description: null,
      cycleId: null,
      assigneeId: null,
      estimate: null,
      dueDate: null,
    });
    expect(result.description).toBeNull();
    expect(result.assigneeId).toBeNull();
  });
});

describe("createSubtaskInput", () => {
  it("requires parentIssueId and title", () => {
    const result = createSubtaskInput.parse({
      parentIssueId: "iss_1",
      title: "Subtask",
    });
    expect(result.parentIssueId).toBe("iss_1");
    expect(result.status).toBe("todo");
  });

  it("rejects missing parentIssueId", () => {
    expect(() => createSubtaskInput.parse({ title: "Sub" })).toThrow();
  });
});

describe("addCommentInput", () => {
  it("requires issueId and body", () => {
    const result = addCommentInput.parse({
      issueId: "iss_1",
      body: "Hello",
    });
    expect(result.body).toBe("Hello");
  });

  it("rejects empty body", () => {
    expect(() =>
      addCommentInput.parse({ issueId: "iss_1", body: "" })
    ).toThrow();
  });
});

describe("listIssuesInput", () => {
  it("applies default limit", () => {
    const result = listIssuesInput.parse({ workspaceId: "ws_1" });
    expect(result.limit).toBe(50);
  });

  it("rejects limit over 100", () => {
    expect(() =>
      listIssuesInput.parse({ workspaceId: "ws_1", limit: 200 })
    ).toThrow();
  });
});

describe("searchKnowledgeInput", () => {
  it("applies default limit", () => {
    const result = searchKnowledgeInput.parse({ workspaceId: "ws_1" });
    expect(result.limit).toBe(20);
  });
});

describe("listCyclesInput", () => {
  it("defaults includeIssues to false", () => {
    const result = listCyclesInput.parse({ workspaceId: "ws_1" });
    expect(result.includeIssues).toBe(false);
  });
});
