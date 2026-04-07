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
    addProject: vi.fn().mockResolvedValue({ ok: true, message: "Added" }),
    addUpdate: vi.fn().mockResolvedValue({ ok: true, message: "Logged" }),
  };
  type ToolHandler = (params: Record<string, unknown>) => Promise<unknown>;
  const registeredTools = new Map<string, ToolHandler>();
  return { mockOps, registeredTools };
});

vi.mock("@/lib/runway/operations", () => mockOps);
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
});
