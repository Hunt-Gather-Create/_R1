import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted so variables are available in hoisted vi.mock factories
const { registeredTools } = vi.hoisted(() => {
  type ToolHandler = (params: Record<string, unknown>) => Promise<unknown>;
  const registeredTools = new Map<string, ToolHandler>();
  return { registeredTools };
});

vi.mock("@/lib/runway/operations", () => ({
  getClientsWithCounts: vi.fn().mockResolvedValue([]),
  getClientDetail: vi.fn().mockResolvedValue(null),
  getProjectsFiltered: vi.fn().mockResolvedValue([]),
  getWeekItemsData: vi.fn().mockResolvedValue([]),
  getWeekItemsByProject: vi.fn().mockResolvedValue([]),
  getWeekItemsInRange: vi.fn().mockResolvedValue([]),
  getOrphanWeekItems: vi.fn().mockResolvedValue([]),
  getPersonWorkload: vi.fn().mockResolvedValue({ person: "Kathy", projects: [], weekItems: [], totalProjects: 0, totalWeekItems: 0 }),
  getProjectStatus: vi.fn().mockResolvedValue({ ok: true, status: {} }),
  getPipelineData: vi.fn().mockResolvedValue([]),
  getUpdatesData: vi.fn().mockResolvedValue([]),
  findUpdates: vi.fn().mockResolvedValue([]),
  getUpdateChain: vi.fn().mockResolvedValue({ root: null, chain: [] }),
  getFlags: vi.fn().mockResolvedValue({ flags: [], retainerRenewalDue: [], contractExpired: [] }),
  getDataHealth: vi.fn().mockResolvedValue({}),
  getCurrentBatch: vi.fn().mockResolvedValue({ active: false }),
  getBatchContents: vi.fn().mockResolvedValue({ batchId: "", totalUpdates: 0, groups: [] }),
  getCascadeLog: vi.fn().mockResolvedValue({ windowMinutes: 60, since: new Date(), totalCascadeRows: 0, groups: [] }),
  getTeamMembersData: vi.fn().mockResolvedValue([]),
  getClientContacts: vi.fn().mockResolvedValue(null),
  updateProjectStatus: vi.fn().mockResolvedValue({ ok: true, message: "Updated" }),
  updateProjectField: vi.fn().mockResolvedValue({ ok: true, message: "Updated" }),
  deleteProject: vi.fn().mockResolvedValue({ ok: true, message: "Deleted" }),
  addProject: vi.fn().mockResolvedValue({ ok: true, message: "Added" }),
  addUpdate: vi.fn().mockResolvedValue({ ok: true, message: "Logged" }),
  createWeekItem: vi.fn().mockResolvedValue({ ok: true, message: "Created" }),
  updateWeekItemField: vi.fn().mockResolvedValue({ ok: true, message: "Updated" }),
  deleteWeekItem: vi.fn().mockResolvedValue({ ok: true, message: "Deleted" }),
  undoLastChange: vi.fn().mockResolvedValue({ ok: true, message: "Undone" }),
  createPipelineItem: vi.fn().mockResolvedValue({ ok: true, message: "Created" }),
  updatePipelineItem: vi.fn().mockResolvedValue({ ok: true, message: "Updated" }),
  deletePipelineItem: vi.fn().mockResolvedValue({ ok: true, message: "Deleted" }),
  updateClientField: vi.fn().mockResolvedValue({ ok: true, message: "Updated" }),
  createTeamMember: vi.fn().mockResolvedValue({ ok: true, message: "Created" }),
  updateTeamMember: vi.fn().mockResolvedValue({ ok: true, message: "Updated" }),
  setBatchId: vi.fn(),
  getBatchId: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/slack/updates-channel", () => ({
  safePostUpdate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/runway/operations-context", () => ({
  getClientContactsStructured: vi.fn().mockResolvedValue([]),
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
      // Read tools
      "get_clients",
      "get_projects",
      "get_retainer_team",
      "get_week_items",
      "get_week_items_by_project",
      "get_pipeline",
      "get_updates",
      "get_team_members",
      "get_person_workload",
      "get_project_status",
      "get_client_contacts",
      // Tier 2 read tools (PR #86 v4)
      "get_client_detail",
      "get_orphan_week_items",
      "get_week_items_range",
      "find_updates",
      "get_update_chain",
      // Tier 3 observability tools (PR #86 v4)
      "get_flags",
      "get_data_health",
      "get_current_batch",
      "get_batch_contents",
      "get_cascade_log",
      // Drift detection (PR #88 Chunk C)
      "get_rows_changed_since",
      // Mutation tools — project
      "update_project_status",
      "update_project_field",
      "delete_project",
      "add_project",
      // Mutation tools — week items
      "create_week_item",
      "update_week_item",
      "delete_week_item",
      // Mutation tools — pipeline
      "create_pipeline_item",
      "update_pipeline_item",
      "delete_pipeline_item",
      // Mutation tools — client
      "update_client_field",
      // Mutation tools — team
      "create_team_member",
      "update_team_member",
      // Notes & undo
      "add_update",
      "undo_last_change",
      // Batch mode
      "set_batch_mode",
      // Date override + parent helper + batch dispatch (commit 13)
      "override_project_date",
      "set_project_parent",
      "batch_apply",
    ];
    for (const name of expectedTools) {
      expect(registeredTools.has(name), `Missing tool: ${name}`).toBe(true);
    }
    expect(registeredTools.size).toBe(expectedTools.length);
  });
});
