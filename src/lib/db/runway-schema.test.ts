import { describe, it, expect } from "vitest";
import {
  clients,
  projects,
  weekItems,
  pipelineItems,
  updates,
  teamMembers,
} from "./runway-schema";

describe("runway-schema", () => {
  it("exports all 6 tables", () => {
    expect(clients).toBeDefined();
    expect(projects).toBeDefined();
    expect(weekItems).toBeDefined();
    expect(pipelineItems).toBeDefined();
    expect(updates).toBeDefined();
    expect(teamMembers).toBeDefined();
  });

  it("clients table has expected columns", () => {
    const cols = Object.keys(clients);
    expect(cols).toContain("id");
    expect(cols).toContain("name");
    expect(cols).toContain("slug");
    expect(cols).toContain("contractValue");
    expect(cols).toContain("contractStatus");
    expect(cols).toContain("team");
    expect(cols).toContain("clientContacts");
    expect(cols).toContain("createdAt");
    expect(cols).toContain("updatedAt");
  });

  it("projects table references clients via clientId", () => {
    const cols = Object.keys(projects);
    expect(cols).toContain("clientId");
    expect(cols).toContain("name");
    expect(cols).toContain("status");
    expect(cols).toContain("category");
    expect(cols).toContain("owner");
    expect(cols).toContain("sortOrder");
  });

  it("weekItems table has scheduling columns", () => {
    const cols = Object.keys(weekItems);
    expect(cols).toContain("dayOfWeek");
    expect(cols).toContain("weekOf");
    expect(cols).toContain("date");
    expect(cols).toContain("title");
    expect(cols).toContain("category");
  });

  it("pipelineItems table has business columns", () => {
    const cols = Object.keys(pipelineItems);
    expect(cols).toContain("clientId");
    expect(cols).toContain("name");
    expect(cols).toContain("status");
    expect(cols).toContain("estimatedValue");
    expect(cols).toContain("waitingOn");
  });

  it("updates table has audit columns", () => {
    const cols = Object.keys(updates);
    expect(cols).toContain("idempotencyKey");
    expect(cols).toContain("projectId");
    expect(cols).toContain("clientId");
    expect(cols).toContain("updatedBy");
    expect(cols).toContain("updateType");
    expect(cols).toContain("previousValue");
    expect(cols).toContain("newValue");
    expect(cols).toContain("summary");
  });

  it("teamMembers table has identity columns", () => {
    const cols = Object.keys(teamMembers);
    expect(cols).toContain("name");
    expect(cols).toContain("title");
    expect(cols).toContain("slackUserId");
    expect(cols).toContain("isActive");
  });
});
