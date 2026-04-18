import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockOps, registeredTools } = vi.hoisted(() => {
  const mockOps = {
    getClientsWithCounts: vi.fn().mockResolvedValue([{ name: "Convergix", projectCount: 3 }]),
    getProjectsFiltered: vi.fn().mockResolvedValue([{ name: "CDS", status: "in-production" }]),
    getWeekItemsData: vi.fn().mockResolvedValue([{ date: "2026-04-06", title: "Review" }]),
    getPersonWorkload: vi.fn().mockResolvedValue({ person: "Kathy", projects: [], weekItems: [], totalProjects: 0, totalWeekItems: 0 }),
    getPipelineData: vi.fn().mockResolvedValue([{ name: "New SOW", status: "sow-sent" }]),
    getUpdatesData: vi.fn().mockResolvedValue([{ summary: "Status changed" }]),
    getTeamMembersData: vi.fn().mockResolvedValue([{ name: "Kathy", title: "Account Manager" }]),
    getClientContacts: vi.fn().mockResolvedValue({ client: "Convergix", contacts: ["Daniel"] }),
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
  };
  type ToolHandler = (params: Record<string, unknown>) => Promise<unknown>;
  const registeredTools = new Map<string, ToolHandler>();
  return { mockOps, registeredTools };
});

vi.mock("@/lib/runway/operations", () => mockOps);
vi.mock("@/lib/slack/updates-channel", () => ({
  safePostUpdate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    tool(name: string, _desc: string, _schema: unknown, handler: (params: Record<string, unknown>) => Promise<unknown>) {
      registeredTools.set(name, handler);
    }
  },
}));

import { registerRunwayTools } from "./runway-tools";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

describe("registerRunwayTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registeredTools.clear();
    registerRunwayTools(new McpServer({ name: "test", version: "1.0.0" }));
  });

  it("get_clients calls getClientsWithCounts", async () => {
    const result = await registeredTools.get("get_clients")!({});
    expect(mockOps.getClientsWithCounts).toHaveBeenCalledOnce();
    expect(result).toEqual({ content: [{ type: "text", text: expect.stringContaining("Convergix") }] });
  });

  it("get_projects passes all filters", async () => {
    await registeredTools.get("get_projects")!({ clientSlug: "convergix", status: "blocked", owner: "Kathy", waitingOn: "Daniel" });
    expect(mockOps.getProjectsFiltered).toHaveBeenCalledWith({ clientSlug: "convergix", status: "blocked", owner: "Kathy", waitingOn: "Daniel" });
  });

  it("get_week_items passes weekOf and owner", async () => {
    await registeredTools.get("get_week_items")!({ weekOf: "2026-04-06", owner: "Kathy" });
    expect(mockOps.getWeekItemsData).toHaveBeenCalledWith("2026-04-06", "Kathy");
  });

  it("get_person_workload calls getPersonWorkload", async () => {
    const result = await registeredTools.get("get_person_workload")!({ personName: "Kathy" });
    expect(mockOps.getPersonWorkload).toHaveBeenCalledWith("Kathy");
    expect(result).toEqual({ content: [{ type: "text", text: expect.stringContaining("Kathy") }] });
  });

  it("get_pipeline calls getPipelineData", async () => {
    await registeredTools.get("get_pipeline")!({});
    expect(mockOps.getPipelineData).toHaveBeenCalledOnce();
  });

  it("get_updates passes options", async () => {
    await registeredTools.get("get_updates")!({ clientSlug: "lppc", limit: 5 });
    expect(mockOps.getUpdatesData).toHaveBeenCalledWith({ clientSlug: "lppc", limit: 5 });
  });

  it("update_project_status calls operation and returns message", async () => {
    const params = { clientSlug: "convergix", projectName: "CDS", newStatus: "completed", updatedBy: "Kathy", notes: "Delivered" };
    const result = await registeredTools.get("update_project_status")!(params);
    expect(mockOps.updateProjectStatus).toHaveBeenCalledWith(params);
    expect(result).toEqual({ content: [{ type: "text", text: "Updated" }] });
  });

  it("update_project_status returns error on failure", async () => {
    mockOps.updateProjectStatus.mockResolvedValueOnce({ ok: false, error: "Project not found" });
    const result = await registeredTools.get("update_project_status")!({
      clientSlug: "convergix", projectName: "nonexistent", newStatus: "done", updatedBy: "Kathy",
    });
    expect(result).toEqual({ content: [{ type: "text", text: "Project not found" }] });
  });

  it("add_project calls operation", async () => {
    const params = { clientSlug: "convergix", name: "New Site", updatedBy: "Jason" };
    await registeredTools.get("add_project")!(params);
    expect(mockOps.addProject).toHaveBeenCalledWith(params);
  });

  it("add_update calls operation", async () => {
    const params = { clientSlug: "convergix", summary: "Met with Daniel", updatedBy: "Kathy" };
    await registeredTools.get("add_update")!(params);
    expect(mockOps.addUpdate).toHaveBeenCalledWith(params);
  });

  it("get_team_members calls getTeamMembersData", async () => {
    const result = await registeredTools.get("get_team_members")!({});
    expect(mockOps.getTeamMembersData).toHaveBeenCalledOnce();
    expect(result).toEqual({ content: [{ type: "text", text: expect.stringContaining("Kathy") }] });
  });

  it("get_client_contacts returns contacts when client exists", async () => {
    const result = await registeredTools.get("get_client_contacts")!({ clientSlug: "convergix" });
    expect(mockOps.getClientContacts).toHaveBeenCalledWith("convergix");
    expect(result).toEqual({ content: [{ type: "text", text: expect.stringContaining("Daniel") }] });
  });

  it("get_client_contacts returns error when client not found", async () => {
    mockOps.getClientContacts.mockResolvedValueOnce(null);
    const result = await registeredTools.get("get_client_contacts")!({ clientSlug: "nonexistent" });
    expect(result).toEqual({ content: [{ type: "text", text: "Client 'nonexistent' not found." }] });
  });

  // ── New mutation tool execution tests ──────────────────────

  it("update_project_field calls operation and returns message", async () => {
    const params = { clientSlug: "convergix", projectName: "CDS", field: "owner", newValue: "Lane", updatedBy: "mcp" };
    const result = await registeredTools.get("update_project_field")!(params);
    expect(mockOps.updateProjectField).toHaveBeenCalledWith(params);
    expect(result).toEqual({ content: [{ type: "text", text: "Updated" }] });
  });

  it("delete_project calls operation and returns message", async () => {
    const params = { clientSlug: "convergix", projectName: "CDS", updatedBy: "mcp" };
    const result = await registeredTools.get("delete_project")!(params);
    expect(mockOps.deleteProject).toHaveBeenCalledWith(params);
    expect(result).toEqual({ content: [{ type: "text", text: "Deleted" }] });
  });

  it("create_week_item calls operation", async () => {
    const params = { clientSlug: "convergix", title: "Review", weekOf: "2026-04-06", updatedBy: "mcp" };
    const result = await registeredTools.get("create_week_item")!(params);
    expect(mockOps.createWeekItem).toHaveBeenCalledWith(params);
    expect(result).toEqual({ content: [{ type: "text", text: "Created" }] });
  });

  it("update_week_item calls operation", async () => {
    const params = { weekOf: "2026-04-06", weekItemTitle: "Review", field: "status", newValue: "done", updatedBy: "mcp" };
    const result = await registeredTools.get("update_week_item")!(params);
    expect(mockOps.updateWeekItemField).toHaveBeenCalledWith(params);
    expect(result).toEqual({ content: [{ type: "text", text: "Updated" }] });
  });

  it("delete_week_item calls operation", async () => {
    const params = { weekOf: "2026-04-06", weekItemTitle: "Review", updatedBy: "mcp" };
    const result = await registeredTools.get("delete_week_item")!(params);
    expect(mockOps.deleteWeekItem).toHaveBeenCalledWith(params);
    expect(result).toEqual({ content: [{ type: "text", text: "Deleted" }] });
  });

  it("undo_last_change calls operation", async () => {
    const params = { updatedBy: "mcp" };
    const result = await registeredTools.get("undo_last_change")!(params);
    expect(mockOps.undoLastChange).toHaveBeenCalledWith(params);
    expect(result).toEqual({ content: [{ type: "text", text: "Undone" }] });
  });

  it("create_pipeline_item calls operation", async () => {
    const params = { clientSlug: "bonterra", name: "New SOW", updatedBy: "mcp" };
    const result = await registeredTools.get("create_pipeline_item")!(params);
    expect(mockOps.createPipelineItem).toHaveBeenCalledWith(params);
    expect(result).toEqual({ content: [{ type: "text", text: "Created" }] });
  });

  it("update_pipeline_item calls operation", async () => {
    const params = { clientSlug: "bonterra", pipelineName: "SOW", field: "status", newValue: "signed", updatedBy: "mcp" };
    const result = await registeredTools.get("update_pipeline_item")!(params);
    expect(mockOps.updatePipelineItem).toHaveBeenCalledWith(params);
    expect(result).toEqual({ content: [{ type: "text", text: "Updated" }] });
  });

  it("delete_pipeline_item calls operation", async () => {
    const params = { clientSlug: "bonterra", pipelineName: "SOW", updatedBy: "mcp" };
    const result = await registeredTools.get("delete_pipeline_item")!(params);
    expect(mockOps.deletePipelineItem).toHaveBeenCalledWith(params);
    expect(result).toEqual({ content: [{ type: "text", text: "Deleted" }] });
  });

  it("update_client_field calls operation", async () => {
    const params = { clientSlug: "convergix", field: "team", newValue: "Kathy, Lane", updatedBy: "mcp" };
    const result = await registeredTools.get("update_client_field")!(params);
    expect(mockOps.updateClientField).toHaveBeenCalledWith(params);
    expect(result).toEqual({ content: [{ type: "text", text: "Updated" }] });
  });

  it("create_team_member calls operation", async () => {
    const params = { name: "Lane", fullName: "Lane Davis", updatedBy: "mcp" };
    const result = await registeredTools.get("create_team_member")!(params);
    expect(mockOps.createTeamMember).toHaveBeenCalledWith(params);
    expect(result).toEqual({ content: [{ type: "text", text: "Created" }] });
  });

  it("update_team_member calls operation", async () => {
    const params = { memberName: "Lane", field: "title", newValue: "Senior Dev", updatedBy: "mcp" };
    const result = await registeredTools.get("update_team_member")!(params);
    expect(mockOps.updateTeamMember).toHaveBeenCalledWith(params);
    expect(result).toEqual({ content: [{ type: "text", text: "Updated" }] });
  });

  it("set_batch_mode sets and clears batchId", async () => {
    await registeredTools.get("set_batch_mode")!({ batchId: "batch-2026-04-18" });
    expect(mockOps.setBatchId).toHaveBeenCalledWith("batch-2026-04-18");

    await registeredTools.get("set_batch_mode")!({ batchId: null });
    expect(mockOps.setBatchId).toHaveBeenCalledWith(null);
  });

  it("mutation tools post to Slack when not in batch mode", async () => {
    const { safePostUpdate } = await import("@/lib/slack/updates-channel");
    mockOps.getBatchId.mockReturnValue(null);
    mockOps.updateProjectStatus.mockResolvedValue({
      ok: true, message: "Updated",
      data: { clientName: "Convergix", projectName: "CDS", previousStatus: "active", newStatus: "done" },
    });
    await registeredTools.get("update_project_status")!({
      clientSlug: "convergix", projectName: "CDS", newStatus: "done", updatedBy: "mcp",
    });
    expect(safePostUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ clientName: "Convergix" })
    );
  });

  it("mutation tools suppress Slack when in batch mode", async () => {
    const { safePostUpdate } = await import("@/lib/slack/updates-channel");
    mockOps.getBatchId.mockReturnValue("batch-2026-04-18");
    mockOps.addProject.mockResolvedValue({ ok: true, message: "Added" });
    await registeredTools.get("add_project")!({
      clientSlug: "convergix", name: "New Site", updatedBy: "mcp",
    });
    expect(safePostUpdate).not.toHaveBeenCalled();
  });

  it("mutation tools return error message on failure", async () => {
    mockOps.deleteProject.mockResolvedValueOnce({ ok: false, error: "Project not found" });
    const result = await registeredTools.get("delete_project")!({
      clientSlug: "convergix", projectName: "nope", updatedBy: "mcp",
    });
    expect(result).toEqual({ content: [{ type: "text", text: "Project not found" }] });
  });

  // ── Error path tests for all mutation tools ─────────────────

  it("update_project_field returns error on failure", async () => {
    mockOps.updateProjectField.mockResolvedValueOnce({ ok: false, error: "Project not found" });
    const result = await registeredTools.get("update_project_field")!({
      clientSlug: "convergix", projectName: "nope", field: "owner", newValue: "X", updatedBy: "mcp",
    });
    expect(result).toEqual({ content: [{ type: "text", text: "Project not found" }] });
  });

  it("add_project returns error on failure", async () => {
    mockOps.addProject.mockResolvedValueOnce({ ok: false, error: "Client not found" });
    const result = await registeredTools.get("add_project")!({
      clientSlug: "nope", name: "Test", updatedBy: "mcp",
    });
    expect(result).toEqual({ content: [{ type: "text", text: "Client not found" }] });
  });

  it("add_update returns error on failure", async () => {
    mockOps.addUpdate.mockResolvedValueOnce({ ok: false, error: "Client not found" });
    const result = await registeredTools.get("add_update")!({
      clientSlug: "nope", summary: "Test", updatedBy: "mcp",
    });
    expect(result).toEqual({ content: [{ type: "text", text: "Client not found" }] });
  });

  it("create_week_item returns error on failure", async () => {
    mockOps.createWeekItem.mockResolvedValueOnce({ ok: false, error: "Provide weekOf or date" });
    const result = await registeredTools.get("create_week_item")!({
      title: "Review", updatedBy: "mcp",
    });
    expect(result).toEqual({ content: [{ type: "text", text: "Provide weekOf or date" }] });
  });

  it("update_week_item returns error on failure", async () => {
    mockOps.updateWeekItemField.mockResolvedValueOnce({ ok: false, error: "Week item not found" });
    const result = await registeredTools.get("update_week_item")!({
      weekOf: "2026-04-06", weekItemTitle: "nope", field: "status", newValue: "done", updatedBy: "mcp",
    });
    expect(result).toEqual({ content: [{ type: "text", text: "Week item not found" }] });
  });

  it("delete_week_item returns error on failure", async () => {
    mockOps.deleteWeekItem.mockResolvedValueOnce({ ok: false, error: "Week item not found" });
    const result = await registeredTools.get("delete_week_item")!({
      weekOf: "2026-04-06", weekItemTitle: "nope", updatedBy: "mcp",
    });
    expect(result).toEqual({ content: [{ type: "text", text: "Week item not found" }] });
  });

  it("undo_last_change returns error on failure", async () => {
    mockOps.undoLastChange.mockResolvedValueOnce({ ok: false, error: "No recent change to undo" });
    const result = await registeredTools.get("undo_last_change")!({ updatedBy: "mcp" });
    expect(result).toEqual({ content: [{ type: "text", text: "No recent change to undo" }] });
  });

  it("create_pipeline_item returns error on failure", async () => {
    mockOps.createPipelineItem.mockResolvedValueOnce({ ok: false, error: "Client not found" });
    const result = await registeredTools.get("create_pipeline_item")!({
      clientSlug: "nope", name: "SOW", updatedBy: "mcp",
    });
    expect(result).toEqual({ content: [{ type: "text", text: "Client not found" }] });
  });

  it("update_pipeline_item returns error on failure", async () => {
    mockOps.updatePipelineItem.mockResolvedValueOnce({ ok: false, error: "Pipeline item not found" });
    const result = await registeredTools.get("update_pipeline_item")!({
      clientSlug: "convergix", pipelineName: "nope", field: "status", newValue: "signed", updatedBy: "mcp",
    });
    expect(result).toEqual({ content: [{ type: "text", text: "Pipeline item not found" }] });
  });

  it("delete_pipeline_item returns error on failure", async () => {
    mockOps.deletePipelineItem.mockResolvedValueOnce({ ok: false, error: "Pipeline item not found" });
    const result = await registeredTools.get("delete_pipeline_item")!({
      clientSlug: "convergix", pipelineName: "nope", updatedBy: "mcp",
    });
    expect(result).toEqual({ content: [{ type: "text", text: "Pipeline item not found" }] });
  });

  it("update_client_field returns error on failure", async () => {
    mockOps.updateClientField.mockResolvedValueOnce({ ok: false, error: "Client not found" });
    const result = await registeredTools.get("update_client_field")!({
      clientSlug: "nope", field: "team", newValue: "X", updatedBy: "mcp",
    });
    expect(result).toEqual({ content: [{ type: "text", text: "Client not found" }] });
  });

  it("create_team_member returns error on failure", async () => {
    mockOps.createTeamMember.mockResolvedValueOnce({ ok: false, error: "Member already exists" });
    const result = await registeredTools.get("create_team_member")!({
      name: "Kathy", updatedBy: "mcp",
    });
    expect(result).toEqual({ content: [{ type: "text", text: "Member already exists" }] });
  });

  it("update_team_member returns error on failure", async () => {
    mockOps.updateTeamMember.mockResolvedValueOnce({ ok: false, error: "Member not found" });
    const result = await registeredTools.get("update_team_member")!({
      memberName: "nope", field: "title", newValue: "X", updatedBy: "mcp",
    });
    expect(result).toEqual({ content: [{ type: "text", text: "Member not found" }] });
  });
});
