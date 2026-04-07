import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted so variables are available in hoisted vi.mock factories
const { registeredTools } = vi.hoisted(() => {
  type ToolHandler = (params: Record<string, unknown>) => Promise<unknown>;
  const registeredTools = new Map<string, ToolHandler>();
  return { registeredTools };
});

vi.mock("@/lib/runway/operations", () => ({
  getClientsWithCounts: vi.fn().mockResolvedValue([]),
  getProjectsFiltered: vi.fn().mockResolvedValue([]),
  getWeekItemsData: vi.fn().mockResolvedValue([]),
  getPersonWorkload: vi.fn().mockResolvedValue({ person: "Kathy", projects: [], weekItems: [], totalProjects: 0, totalWeekItems: 0 }),
  getPipelineData: vi.fn().mockResolvedValue([]),
  getUpdatesData: vi.fn().mockResolvedValue([]),
  getTeamMembersData: vi.fn().mockResolvedValue([]),
  getClientContacts: vi.fn().mockResolvedValue(null),
  updateProjectStatus: vi.fn().mockResolvedValue({ ok: true, message: "Updated" }),
  addProject: vi.fn().mockResolvedValue({ ok: true, message: "Added" }),
  addUpdate: vi.fn().mockResolvedValue({ ok: true, message: "Logged" }),
}));

vi.mock("@/lib/runway/reference/clients", () => ({
  getClientContactsRef: vi.fn().mockReturnValue([]),
}));

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    tool(name: string, _desc: string, _schema: unknown, handler: (params: Record<string, unknown>) => Promise<unknown>) {
      registeredTools.set(name, handler);
    }
  },
}));

import { createRunwayMcpServer } from "./runway-server";

describe("createRunwayMcpServer", () => {
  beforeEach(() => {
    registeredTools.clear();
    createRunwayMcpServer();
  });

  it("registers all expected tools", () => {
    const expectedTools = [
      "get_clients",
      "get_projects",
      "get_week_items",
      "get_pipeline",
      "get_updates",
      "update_project_status",
      "add_project",
      "add_update",
      "get_team_members",
      "get_person_workload",
      "get_client_contacts",
    ];
    for (const name of expectedTools) {
      expect(registeredTools.has(name)).toBe(true);
    }
    expect(registeredTools.size).toBe(expectedTools.length);
  });
});
