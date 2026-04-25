import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockOps, registeredTools, registeredDescriptions } = vi.hoisted(() => {
  const mockOps = {
    getClientsWithCounts: vi.fn().mockResolvedValue([{ name: "Convergix", projectCount: 3 }]),
    getClientDetail: vi.fn().mockResolvedValue({
      id: "c1", name: "Convergix", slug: "convergix", projects: [], pipelineItems: [], recentUpdates: [],
    }),
    getProjectsFiltered: vi.fn().mockResolvedValue([{ name: "CDS", status: "in-production" }]),
    getWeekItemsData: vi.fn().mockResolvedValue([{ date: "2026-04-06", title: "Review" }]),
    getWeekItemsByProject: vi.fn().mockResolvedValue([]),
    getWeekItemsInRange: vi.fn().mockResolvedValue([{ id: "w1", title: "Launch" }]),
    getOrphanWeekItems: vi.fn().mockResolvedValue([{ id: "w2", title: "Orphan", projectId: null }]),
    getPersonWorkload: vi.fn().mockResolvedValue({ person: "Kathy", projects: [], weekItems: [], totalProjects: 0, totalWeekItems: 0 }),
    getProjectStatus: vi.fn().mockResolvedValue({
      ok: true,
      status: {
        name: "CDS", client: "Convergix", owner: "Kathy", status: "in-production",
        engagement_type: "project", contractRange: {}, current: {}, inFlight: [], upcoming: [],
        team: "", recentUpdates: [], suggestedActions: [],
      },
    }),
    getPipelineData: vi.fn().mockResolvedValue([{ name: "New SOW", status: "sow-sent" }]),
    getUpdatesData: vi.fn().mockResolvedValue([{ summary: "Status changed" }]),
    findUpdates: vi.fn().mockResolvedValue([{ id: "u1", summary: "Changed", updateType: "status-change" }]),
    getUpdateChain: vi.fn().mockResolvedValue({ root: { id: "u1" }, chain: [{ id: "u1" }, { id: "u2" }] }),
    getFlags: vi.fn().mockResolvedValue({ flags: [], retainerRenewalDue: [], contractExpired: [] }),
    getDataHealth: vi.fn().mockResolvedValue({
      totals: { projects: 10, weekItems: 20, clients: 5, updates: 50, pipelineItems: 3 },
      orphans: { weekItemsWithoutProject: 0, projectsWithoutClient: 0, updatesWithDanglingTriggeredBy: 0 },
      stale: { staleProjects: 0, pastEndL2s: 0 },
      batch: { activeBatchId: null, distinctBatchIdsLast7Days: 0 },
      lastUpdateAt: null,
    }),
    getCurrentBatch: vi.fn().mockResolvedValue({ active: false }),
    getBatchContents: vi.fn().mockResolvedValue({ batchId: "b1", totalUpdates: 0, groups: [] }),
    getCascadeLog: vi.fn().mockResolvedValue({ windowMinutes: 60, since: new Date(), totalCascadeRows: 0, groups: [] }),
    getRowsChangedSince: vi.fn().mockResolvedValue({
      since: "2026-04-20T00:00:00.000Z",
      counts: { projects: 0, weekItems: 0, clients: 0, pipelineItems: 0 },
      projects: [], weekItems: [], clients: [], pipelineItems: [],
    }),
    getTeamMembersData: vi.fn().mockResolvedValue([{ name: "Kathy", title: "Account Manager" }]),
    getClientContacts: vi.fn().mockResolvedValue({ client: "Convergix", contacts: ["Daniel"] }),
    updateProjectStatus: vi.fn().mockResolvedValue({ ok: true, message: "Updated" }),
    updateProjectField: vi.fn().mockResolvedValue({ ok: true, message: "Updated" }),
    overrideProjectDate: vi.fn().mockResolvedValue({ ok: true, message: "Overrode" }),
    setProjectParent: vi.fn().mockResolvedValue({ ok: true, message: "Updated" }),
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
  const registeredDescriptions = new Map<string, string>();
  return { mockOps, registeredTools, registeredDescriptions };
});

// Mock the operations barrel: real shared validators come through via
// `importOriginal()`, then `mockOps` (DB-touching helpers) overlay on top.
// Inline validator reimplementations would silently drift from the production
// source — wrapper-side rejection assertions in the tests below would pass
// for the wrong reason if `validateEngagementType` etc. were redefined here
// instead of forwarded from `operations-utils`.
vi.mock("@/lib/runway/operations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/runway/operations")>();
  return { ...actual, ...mockOps };
});
vi.mock("@/lib/slack/updates-channel", () => ({
  postMutationUpdate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    tool(name: string, desc: string, _schema: unknown, handler: (params: Record<string, unknown>) => Promise<unknown>) {
      registeredTools.set(name, handler);
      registeredDescriptions.set(name, desc);
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
    expect(mockOps.getProjectsFiltered).toHaveBeenCalledWith({ clientSlug: "convergix", status: "blocked", owner: "Kathy", waitingOn: "Daniel", engagementType: undefined, parentProjectId: undefined });
  });

  it("get_projects passes engagementType filter (PR #88 Chunk B)", async () => {
    await registeredTools.get("get_projects")!({ engagementType: "retainer" });
    expect(mockOps.getProjectsFiltered).toHaveBeenCalledWith({
      clientSlug: undefined,
      status: undefined,
      owner: undefined,
      waitingOn: undefined,
      engagementType: "retainer",
      parentProjectId: undefined,
    });
  });

  it("get_projects passes engagementType='__null__' sentinel through", async () => {
    await registeredTools.get("get_projects")!({ engagementType: "__null__" });
    expect(mockOps.getProjectsFiltered).toHaveBeenCalledWith({
      clientSlug: undefined,
      status: undefined,
      owner: undefined,
      waitingOn: undefined,
      engagementType: "__null__",
      parentProjectId: undefined,
    });
  });

  it("get_projects passes parentProjectId filter (PR #88 Chunk F)", async () => {
    await registeredTools.get("get_projects")!({ parentProjectId: "pj-wrap" });
    expect(mockOps.getProjectsFiltered).toHaveBeenCalledWith({
      clientSlug: undefined,
      status: undefined,
      owner: undefined,
      waitingOn: undefined,
      engagementType: undefined,
      parentProjectId: "pj-wrap",
    });
  });

  it("get_projects passes parentProjectId='__null__' sentinel through", async () => {
    await registeredTools.get("get_projects")!({ parentProjectId: "__null__" });
    expect(mockOps.getProjectsFiltered).toHaveBeenCalledWith({
      clientSlug: undefined,
      status: undefined,
      owner: undefined,
      waitingOn: undefined,
      engagementType: undefined,
      parentProjectId: "__null__",
    });
  });

  it("get_week_items passes weekOf, owner, resource, and person", async () => {
    await registeredTools.get("get_week_items")!({ weekOf: "2026-04-06", owner: "Kathy", resource: "Roz", person: "Lane" });
    expect(mockOps.getWeekItemsData).toHaveBeenCalledWith("2026-04-06", "Kathy", "Roz", "Lane", undefined, undefined);
  });

  it("get_week_items passes status filter (PR #88 Chunk B)", async () => {
    await registeredTools.get("get_week_items")!({ weekOf: "2026-04-06", status: "blocked" });
    expect(mockOps.getWeekItemsData).toHaveBeenCalledWith("2026-04-06", undefined, undefined, undefined, "blocked", undefined);
  });

  it("get_week_items passes clientSlug filter (PR #88 Chunk B)", async () => {
    await registeredTools.get("get_week_items")!({ clientSlug: "convergix" });
    expect(mockOps.getWeekItemsData).toHaveBeenCalledWith(undefined, undefined, undefined, undefined, undefined, "convergix");
  });

  it("get_week_items passes status='scheduled' sentinel through", async () => {
    await registeredTools.get("get_week_items")!({ status: "scheduled" });
    expect(mockOps.getWeekItemsData).toHaveBeenCalledWith(undefined, undefined, undefined, undefined, "scheduled", undefined);
  });

  it("get_week_items_by_project calls getWeekItemsByProject", async () => {
    await registeredTools.get("get_week_items_by_project")!({ projectId: "p1" });
    expect(mockOps.getWeekItemsByProject).toHaveBeenCalledWith("p1");
  });

  it("get_project_status returns structured data when ok", async () => {
    const result = await registeredTools.get("get_project_status")!({ clientSlug: "convergix", projectName: "CDS" });
    expect(mockOps.getProjectStatus).toHaveBeenCalledWith({ clientSlug: "convergix", projectName: "CDS" });
    expect(result).toEqual({
      content: [{ type: "text", text: expect.stringContaining("CDS") }],
    });
  });

  it("get_project_status returns error message on not-found", async () => {
    mockOps.getProjectStatus.mockResolvedValueOnce({ ok: false, error: "Project 'nope' not found." });
    const result = await registeredTools.get("get_project_status")!({ clientSlug: "convergix", projectName: "nope" });
    expect(result).toEqual({ content: [{ type: "text", text: "Project 'nope' not found." }] });
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
    expect(mockOps.getUpdatesData).toHaveBeenCalledWith({
      clientSlug: "lppc",
      limit: 5,
      since: undefined,
      until: undefined,
      batchId: undefined,
      updateType: undefined,
      projectName: undefined,
    });
  });

  it("get_updates passes v4 filters (since/until/batchId/updateType/projectName)", async () => {
    await registeredTools.get("get_updates")!({
      clientSlug: "convergix",
      since: "2026-04-01",
      until: "2026-04-30",
      batchId: "cleanup-2026-04-18",
      updateType: "status-change",
      projectName: "CDS",
    });
    expect(mockOps.getUpdatesData).toHaveBeenCalledWith({
      clientSlug: "convergix",
      limit: undefined,
      since: "2026-04-01",
      until: "2026-04-30",
      batchId: "cleanup-2026-04-18",
      updateType: "status-change",
      projectName: "CDS",
    });
  });

  it("get_clients passes includeProjects option", async () => {
    await registeredTools.get("get_clients")!({ includeProjects: true });
    expect(mockOps.getClientsWithCounts).toHaveBeenCalledWith({ includeProjects: true });
  });

  it("get_clients defaults includeProjects to undefined when omitted", async () => {
    await registeredTools.get("get_clients")!({});
    expect(mockOps.getClientsWithCounts).toHaveBeenCalledWith({ includeProjects: undefined });
  });

  it("update_project_status calls operation and returns message when no data", async () => {
    const params = { clientSlug: "convergix", projectName: "CDS", newStatus: "completed", updatedBy: "Kathy", notes: "Delivered" };
    const result = await registeredTools.get("update_project_status")!(params);
    expect(mockOps.updateProjectStatus).toHaveBeenCalledWith(params);
    expect(result).toEqual({ content: [{ type: "text", text: "Updated" }] });
  });

  it("update_project_status surfaces cascadeDetail + auditId in structured JSON", async () => {
    mockOps.updateProjectStatus.mockResolvedValueOnce({
      ok: true,
      message: "Updated Convergix / CDS: in-production -> completed",
      data: {
        clientName: "Convergix",
        projectName: "CDS",
        previousStatus: "in-production",
        newStatus: "completed",
        cascadedItems: ["CDS Review"],
        cascadeDetail: [
          { itemId: "w1", itemTitle: "CDS Review", field: "status", previousValue: "in-progress", newValue: "completed", auditId: "u2" },
        ],
        auditId: "u1",
      },
    });
    const result = await registeredTools.get("update_project_status")!({
      clientSlug: "convergix", projectName: "CDS", newStatus: "completed", updatedBy: "Kathy",
    });
    const text = (result as { content: [{ text: string }] }).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.message).toContain("in-production -> completed");
    expect(parsed.data.cascadeDetail).toHaveLength(1);
    expect(parsed.data.cascadeDetail[0]).toMatchObject({ itemId: "w1", field: "status", auditId: "u2" });
    expect(parsed.data.auditId).toBe("u1");
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

  it("add_project rejects invalid engagementType at tool boundary", async () => {
    const result = await registeredTools.get("add_project")!({
      clientSlug: "convergix",
      name: "Bad Engagement",
      engagementType: "retainer-v2",
      updatedBy: "Jason",
    });
    expect(mockOps.addProject).not.toHaveBeenCalled();
    const text = (result as { content: [{ text: string }] }).content[0].text;
    expect(text).toMatch(/engagementType must be/);
  });

  it("add_project rejects shape-invalid contractStart at tool boundary", async () => {
    const result = await registeredTools.get("add_project")!({
      clientSlug: "convergix",
      name: "Bad Date",
      contractStart: "2026-13-45",
      updatedBy: "Jason",
    });
    expect(mockOps.addProject).not.toHaveBeenCalled();
    const text = (result as { content: [{ text: string }] }).content[0].text;
    expect(text).toMatch(/contractStart must be a valid ISO/);
  });

  it("add_project forwards valid v4 metadata to helper", async () => {
    const params = {
      clientSlug: "convergix",
      name: "1H 2027 Convergix Retainer",
      engagementType: "retainer",
      contractStart: "2027-02-01",
      contractEnd: "2027-07-31",
      owner: "Kathy",
      updatedBy: "Jason",
    };
    await registeredTools.get("add_project")!(params);
    expect(mockOps.addProject).toHaveBeenCalledWith(params);
  });

  it("update_week_item rejects invalid status at tool boundary", async () => {
    const result = await registeredTools.get("update_week_item")!({
      weekOf: "2026-04-13",
      weekItemTitle: "CDS Review",
      field: "status",
      newValue: "Done",
      updatedBy: "test",
    });
    expect(mockOps.updateWeekItemField).not.toHaveBeenCalled();
    const text = (result as { content: [{ text: string }] }).content[0].text;
    expect(text).toMatch(/status must be one of/);
  });

  it("update_week_item rejects invalid category at tool boundary", async () => {
    const result = await registeredTools.get("update_week_item")!({
      weekOf: "2026-04-13",
      weekItemTitle: "CDS Review",
      field: "category",
      newValue: "meeting",
      updatedBy: "test",
    });
    expect(mockOps.updateWeekItemField).not.toHaveBeenCalled();
    const text = (result as { content: [{ text: string }] }).content[0].text;
    expect(text).toMatch(/category must be one of/);
  });

  it("update_week_item rejects shape-invalid startDate at tool boundary", async () => {
    const result = await registeredTools.get("update_week_item")!({
      weekOf: "2026-04-13",
      weekItemTitle: "CDS Review",
      field: "startDate",
      newValue: "not-a-date",
      updatedBy: "test",
    });
    expect(mockOps.updateWeekItemField).not.toHaveBeenCalled();
    const text = (result as { content: [{ text: string }] }).content[0].text;
    expect(text).toMatch(/startDate must be a valid ISO/);
  });

  it("update_week_item accepts valid startDate and forwards to helper", async () => {
    const params = {
      weekOf: "2026-04-13",
      weekItemTitle: "CDS Review",
      field: "startDate",
      newValue: "2026-04-14",
      updatedBy: "test",
    };
    await registeredTools.get("update_week_item")!(params);
    expect(mockOps.updateWeekItemField).toHaveBeenCalledWith(params);
  });

  it("create_week_item rejects shape-invalid startDate at tool boundary", async () => {
    const result = await registeredTools.get("create_week_item")!({
      clientSlug: "convergix",
      title: "Bad",
      weekOf: "2026-04-13",
      startDate: "2026-13-45",
      updatedBy: "test",
    });
    expect(mockOps.createWeekItem).not.toHaveBeenCalled();
    const text = (result as { content: [{ text: string }] }).content[0].text;
    expect(text).toMatch(/startDate must be a valid ISO/);
  });

  it("create_week_item forwards blockedBy to helper", async () => {
    const params = {
      clientSlug: "convergix",
      title: "Blocked Item",
      weekOf: "2026-04-13",
      blockedBy: '["wi-1","wi-2"]',
      updatedBy: "test",
    };
    await registeredTools.get("create_week_item")!(params);
    expect(mockOps.createWeekItem).toHaveBeenCalledWith(params);
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

  // ── Tier 2 read tools ──────────────────────────────────────

  it("get_client_detail returns deep view when client exists", async () => {
    const result = await registeredTools.get("get_client_detail")!({ slug: "convergix" });
    expect(mockOps.getClientDetail).toHaveBeenCalledWith("convergix", { recentUpdatesLimit: undefined });
    expect(result).toEqual({ content: [{ type: "text", text: expect.stringContaining("Convergix") }] });
  });

  it("get_client_detail passes recentUpdatesLimit when provided", async () => {
    await registeredTools.get("get_client_detail")!({ slug: "convergix", recentUpdatesLimit: 5 });
    expect(mockOps.getClientDetail).toHaveBeenCalledWith("convergix", { recentUpdatesLimit: 5 });
  });

  it("get_client_detail returns error message when slug missing", async () => {
    mockOps.getClientDetail.mockResolvedValueOnce(null);
    const result = await registeredTools.get("get_client_detail")!({ slug: "nope" });
    expect(result).toEqual({ content: [{ type: "text", text: "Client 'nope' not found." }] });
  });

  it("get_orphan_week_items calls getOrphanWeekItems without slug", async () => {
    const result = await registeredTools.get("get_orphan_week_items")!({});
    expect(mockOps.getOrphanWeekItems).toHaveBeenCalledWith(undefined);
    expect(result).toEqual({ content: [{ type: "text", text: expect.stringContaining("Orphan") }] });
  });

  it("get_orphan_week_items passes clientSlug when provided", async () => {
    await registeredTools.get("get_orphan_week_items")!({ clientSlug: "convergix" });
    expect(mockOps.getOrphanWeekItems).toHaveBeenCalledWith("convergix");
  });

  it("get_week_items_range passes all filters", async () => {
    await registeredTools.get("get_week_items_range")!({
      fromDate: "2026-04-01",
      toDate: "2026-04-30",
      clientSlug: "convergix",
      owner: "Kathy",
      category: "deadline",
    });
    expect(mockOps.getWeekItemsInRange).toHaveBeenCalledWith(
      "2026-04-01", "2026-04-30", "convergix", "Kathy", "deadline",
    );
  });

  it("get_week_items_range passes only required params", async () => {
    await registeredTools.get("get_week_items_range")!({ fromDate: "2026-04-01", toDate: "2026-04-07" });
    expect(mockOps.getWeekItemsInRange).toHaveBeenCalledWith(
      "2026-04-01", "2026-04-07", undefined, undefined, undefined,
    );
  });

  it("find_updates passes all filters", async () => {
    const params = {
      since: "2026-04-01",
      until: "2026-04-30",
      clientSlug: "convergix",
      updatedBy: "Kathy",
      updateType: "cascade-status-change",
      batchId: "b1",
      projectName: "CDS",
      limit: 50,
    };
    const result = await registeredTools.get("find_updates")!(params);
    expect(mockOps.findUpdates).toHaveBeenCalledWith(params);
    expect(result).toEqual({ content: [{ type: "text", text: expect.stringContaining("u1") }] });
  });

  it("find_updates works with no filters", async () => {
    await registeredTools.get("find_updates")!({});
    expect(mockOps.findUpdates).toHaveBeenCalledWith({});
  });

  it("get_update_chain passes updateId", async () => {
    const result = await registeredTools.get("get_update_chain")!({ updateId: "u1" });
    expect(mockOps.getUpdateChain).toHaveBeenCalledWith("u1");
    expect(result).toEqual({ content: [{ type: "text", text: expect.stringContaining("u1") }] });
  });

  // ── Tier 3 read tools ──────────────────────────────────────

  it("get_flags calls getFlags without args", async () => {
    const result = await registeredTools.get("get_flags")!({});
    expect(mockOps.getFlags).toHaveBeenCalledWith({ clientSlug: undefined, personName: undefined });
    expect(result).toEqual({ content: [{ type: "text", text: expect.stringContaining("flags") }] });
  });

  it("get_flags passes clientSlug and personName", async () => {
    await registeredTools.get("get_flags")!({ clientSlug: "convergix", personName: "Kathy" });
    expect(mockOps.getFlags).toHaveBeenCalledWith({ clientSlug: "convergix", personName: "Kathy" });
  });

  it("get_data_health returns snapshot", async () => {
    const result = await registeredTools.get("get_data_health")!({});
    expect(mockOps.getDataHealth).toHaveBeenCalledOnce();
    expect(result).toEqual({ content: [{ type: "text", text: expect.stringContaining("totals") }] });
  });

  it("get_current_batch returns active=false when no batch", async () => {
    const result = await registeredTools.get("get_current_batch")!({});
    expect(mockOps.getCurrentBatch).toHaveBeenCalledOnce();
    expect(result).toEqual({ content: [{ type: "text", text: expect.stringContaining("active") }] });
  });

  it("get_batch_contents passes batchId", async () => {
    await registeredTools.get("get_batch_contents")!({ batchId: "cleanup-2026-04-18" });
    expect(mockOps.getBatchContents).toHaveBeenCalledWith("cleanup-2026-04-18");
  });

  it("get_cascade_log passes windowMinutes", async () => {
    await registeredTools.get("get_cascade_log")!({ windowMinutes: 30 });
    expect(mockOps.getCascadeLog).toHaveBeenCalledWith(30);
  });

  it("get_cascade_log defaults windowMinutes to undefined (operation defaults to 60)", async () => {
    await registeredTools.get("get_cascade_log")!({});
    expect(mockOps.getCascadeLog).toHaveBeenCalledWith(undefined);
  });

  it("get_rows_changed_since passes since with no options", async () => {
    await registeredTools.get("get_rows_changed_since")!({ since: "2026-04-20T00:00:00.000Z" });
    expect(mockOps.getRowsChangedSince).toHaveBeenCalledWith(
      "2026-04-20T00:00:00.000Z",
      { tables: undefined, clientSlug: undefined },
    );
  });

  it("get_rows_changed_since forwards tables + clientSlug filters", async () => {
    await registeredTools.get("get_rows_changed_since")!({
      since: "2026-04-20T00:00:00.000Z",
      tables: ["projects", "clients"],
      clientSlug: "convergix",
    });
    expect(mockOps.getRowsChangedSince).toHaveBeenCalledWith(
      "2026-04-20T00:00:00.000Z",
      { tables: ["projects", "clients"], clientSlug: "convergix" },
    );
  });

  // ── New mutation tool execution tests ──────────────────────

  it("update_project_field calls operation and returns message when no data", async () => {
    const params = { clientSlug: "convergix", projectName: "CDS", field: "owner", newValue: "Lane", updatedBy: "mcp" };
    const result = await registeredTools.get("update_project_field")!(params);
    expect(mockOps.updateProjectField).toHaveBeenCalledWith(params);
    expect(result).toEqual({ content: [{ type: "text", text: "Updated" }] });
  });

  it("update_project_field forwards parentProjectId field (PR #88 Chunk F)", async () => {
    const params = { clientSlug: "convergix", projectName: "CDS", field: "parentProjectId", newValue: "pj-wrap", updatedBy: "mcp" };
    await registeredTools.get("update_project_field")!(params);
    expect(mockOps.updateProjectField).toHaveBeenCalledWith(params);
  });

  it("update_project_field rejects invalid engagementType at tool boundary", async () => {
    const result = await registeredTools.get("update_project_field")!({
      clientSlug: "convergix",
      projectName: "CDS",
      field: "engagementType",
      newValue: "retainer-v2",
      updatedBy: "mcp",
    });
    expect(mockOps.updateProjectField).not.toHaveBeenCalled();
    const text = (result as { content: [{ text: string }] }).content[0].text;
    expect(text).toMatch(/engagementType must be/);
  });

  it("update_project_field rejects shape-invalid contractStart at tool boundary", async () => {
    const result = await registeredTools.get("update_project_field")!({
      clientSlug: "convergix",
      projectName: "CDS",
      field: "contractStart",
      newValue: "not-a-date",
      updatedBy: "mcp",
    });
    expect(mockOps.updateProjectField).not.toHaveBeenCalled();
    const text = (result as { content: [{ text: string }] }).content[0].text;
    expect(text).toMatch(/contractStart must be a valid ISO/);
  });

  it("update_project_field rejects date-invalid contractStart (2026-13-45) at tool boundary", async () => {
    const result = await registeredTools.get("update_project_field")!({
      clientSlug: "convergix",
      projectName: "CDS",
      field: "contractStart",
      newValue: "2026-13-45",
      updatedBy: "mcp",
    });
    expect(mockOps.updateProjectField).not.toHaveBeenCalled();
    const text = (result as { content: [{ text: string }] }).content[0].text;
    expect(text).toMatch(/contractStart must be a valid ISO/);
  });

  it("update_project_field accepts valid engagementType and forwards to helper", async () => {
    const params = { clientSlug: "convergix", projectName: "CDS", field: "engagementType", newValue: "retainer", updatedBy: "mcp" };
    await registeredTools.get("update_project_field")!(params);
    expect(mockOps.updateProjectField).toHaveBeenCalledWith(params);
  });

  it("update_project_field accepts valid contractStart and forwards to helper", async () => {
    const params = { clientSlug: "convergix", projectName: "CDS", field: "contractStart", newValue: "2026-02-01", updatedBy: "mcp" };
    await registeredTools.get("update_project_field")!(params);
    expect(mockOps.updateProjectField).toHaveBeenCalledWith(params);
  });

  it("update_project_field accepts empty string to clear engagementType", async () => {
    const params = { clientSlug: "convergix", projectName: "CDS", field: "engagementType", newValue: "", updatedBy: "mcp" };
    await registeredTools.get("update_project_field")!(params);
    expect(mockOps.updateProjectField).toHaveBeenCalledWith(params);
  });

  it("update_project_field surfaces cascadeDetail for dueDate changes", async () => {
    mockOps.updateProjectField.mockResolvedValueOnce({
      ok: true,
      message: "Updated dueDate for Convergix / CDS.",
      data: {
        clientName: "Convergix", projectName: "CDS", field: "dueDate",
        previousValue: "2026-04-15", newValue: "2026-04-25",
        cascadedItems: ["Code handoff"],
        cascadeDetail: [
          { itemId: "w1", itemTitle: "Code handoff", field: "date", previousValue: "2026-04-15", newValue: "2026-04-25", auditId: "u3" },
        ],
        auditId: "u4",
      },
    });
    const result = await registeredTools.get("update_project_field")!({
      clientSlug: "convergix", projectName: "CDS", field: "dueDate", newValue: "2026-04-25", updatedBy: "mcp",
    });
    const text = (result as { content: [{ text: string }] }).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.data.cascadeDetail).toHaveLength(1);
    expect(parsed.data.cascadeDetail[0].itemTitle).toBe("Code handoff");
    expect(parsed.data.auditId).toBe("u4");
  });

  it("update_week_item surfaces reverseCascadeDetail for deadline date changes", async () => {
    mockOps.updateWeekItemField.mockResolvedValueOnce({
      ok: true,
      message: "Updated date for 'CDS Deadline'.",
      data: {
        weekItemTitle: "CDS Deadline",
        field: "date",
        previousValue: "2026-04-15",
        newValue: "2026-04-28",
        clientName: "Convergix",
        reverseCascaded: true,
        reverseCascadeDetail: {
          projectId: "p1",
          projectName: "CDS",
          field: "dueDate",
          previousDueDate: "2026-04-15",
          newDueDate: "2026-04-28",
          auditId: "u5",
        },
        auditId: "u6",
      },
    });
    const result = await registeredTools.get("update_week_item")!({
      weekOf: "2026-04-06", weekItemTitle: "CDS Deadline", field: "date", newValue: "2026-04-28", updatedBy: "mcp",
    });
    const text = (result as { content: [{ text: string }] }).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.data.reverseCascadeDetail).toMatchObject({ projectId: "p1", field: "dueDate", auditId: "u5" });
    expect(parsed.data.auditId).toBe("u6");
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
    const params = { weekOf: "2026-04-06", weekItemTitle: "Review", field: "status", newValue: "completed", updatedBy: "mcp" };
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
    const { postMutationUpdate } = await import("@/lib/slack/updates-channel");
    mockOps.getBatchId.mockReturnValue(null);
    mockOps.updateProjectStatus.mockResolvedValue({
      ok: true, message: "Updated",
      data: { clientName: "Convergix", projectName: "CDS", previousStatus: "active", newStatus: "done" },
    });
    await registeredTools.get("update_project_status")!({
      clientSlug: "convergix", projectName: "CDS", newStatus: "done", updatedBy: "mcp",
    });
    expect(postMutationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackClientName: "convergix", updatedBy: "mcp" })
    );
  });

  it("delete tools pass result with clientName data", async () => {
    const { postMutationUpdate } = await import("@/lib/slack/updates-channel");
    mockOps.getBatchId.mockReturnValue(null);
    mockOps.deletePipelineItem.mockResolvedValue({
      ok: true, message: "Deleted",
      data: { clientName: "Convergix", pipelineName: "SOW Expansion" },
    });
    await registeredTools.get("delete_pipeline_item")!({
      clientSlug: "convergix", pipelineName: "SOW Expansion", updatedBy: "mcp",
    });
    expect(postMutationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({ data: expect.objectContaining({ clientName: "Convergix" }) }),
        fallbackClientName: "convergix",
      })
    );
  });

  it("delete tools pass slug as fallback when result.data is missing", async () => {
    const { postMutationUpdate } = await import("@/lib/slack/updates-channel");
    mockOps.getBatchId.mockReturnValue(null);
    mockOps.deleteProject.mockResolvedValue({ ok: true, message: "Deleted" });
    await registeredTools.get("delete_project")!({
      clientSlug: "convergix", projectName: "CDS", updatedBy: "mcp",
    });
    expect(postMutationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackClientName: "convergix" })
    );
  });

  it("mutation tools suppress Slack when in batch mode", async () => {
    const { postMutationUpdate } = await import("@/lib/slack/updates-channel");
    mockOps.getBatchId.mockReturnValue("batch-2026-04-18");
    mockOps.addProject.mockResolvedValue({ ok: true, message: "Added" });
    await registeredTools.get("add_project")!({
      clientSlug: "convergix", name: "New Site", updatedBy: "mcp",
    });
    expect(postMutationUpdate).not.toHaveBeenCalled();
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
      weekOf: "2026-04-06", weekItemTitle: "nope", field: "status", newValue: "completed", updatedBy: "mcp",
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

  // ── Description drift assertions ───────────────────────────
  // These guard against descriptions that claim one return shape but the
  // function actually returns another. Failures here mean the tool
  // description is lying to the LLM.

  it("get_person_workload description describes v4 buckets + flags (not 'grouped by client')", () => {
    const desc = registeredDescriptions.get("get_person_workload")!;
    // v4 shape keys must appear
    expect(desc).toContain("ownedProjects");
    expect(desc).toContain("weekItems");
    expect(desc).toContain("overdue");
    expect(desc).toContain("thisWeek");
    expect(desc).toContain("flags");
    expect(desc).toContain("contractExpired");
    expect(desc).toContain("retainerRenewalDue");
    // Old lie must not appear
    expect(desc).not.toMatch(/grouped by client/i);
  });

  it("get_projects description describes v4 enrichment keys", () => {
    const desc = registeredDescriptions.get("get_projects")!;
    expect(desc).toContain("dueDate");
    expect(desc).toContain("engagementType");
    expect(desc).toContain("contractStart");
    expect(desc).toContain("contractEnd");
  });

  it("get_week_items description describes v4 shape keys", () => {
    const desc = registeredDescriptions.get("get_week_items")!;
    expect(desc).toContain("id");
    expect(desc).toContain("startDate");
    expect(desc).toContain("endDate");
    expect(desc).toContain("blockedBy");
    expect(desc).toContain("projectId");
  });

  it("get_updates description describes v4 filter params", () => {
    const desc = registeredDescriptions.get("get_updates")!;
    expect(desc).toContain("since");
    expect(desc).toContain("until");
    expect(desc).toContain("batchId");
    expect(desc).toContain("updateType");
    expect(desc).toContain("projectName");
  });

  it("update_project_status description mentions cascadeDetail + auditId", () => {
    const desc = registeredDescriptions.get("update_project_status")!;
    expect(desc).toContain("cascadeDetail");
    expect(desc).toContain("auditId");
  });

  it("update_week_item description mentions reverseCascadeDetail", () => {
    const desc = registeredDescriptions.get("update_week_item")!;
    expect(desc).toContain("reverseCascadeDetail");
  });

  // ── override_project_date / set_project_parent / batch_apply ──────────

  it("override_project_date forwards params to helper", async () => {
    const params = {
      clientSlug: "convergix",
      projectName: "CDS",
      field: "startDate",
      newValue: "2026-05-01",
      updatedBy: "tester",
    };
    await registeredTools.get("override_project_date")!(params);
    expect(mockOps.overrideProjectDate).toHaveBeenCalledWith(params);
  });

  it("override_project_date rejects shape-invalid newValue at tool boundary", async () => {
    const result = await registeredTools.get("override_project_date")!({
      clientSlug: "convergix",
      projectName: "CDS",
      field: "endDate",
      newValue: "2026-13-45",
      updatedBy: "tester",
    });
    expect(mockOps.overrideProjectDate).not.toHaveBeenCalled();
    const text = (result as { content: [{ text: string }] }).content[0].text;
    expect(text).toMatch(/endDate must be a valid ISO/);
  });

  it("set_project_parent forwards params to helper", async () => {
    const params = {
      clientSlug: "convergix",
      projectName: "CDS",
      parentProjectName: "Wrapper",
      updatedBy: "tester",
    };
    await registeredTools.get("set_project_parent")!(params);
    expect(mockOps.setProjectParent).toHaveBeenCalledWith(params);
  });

  it("batch_apply runs ops sequentially via dispatch table", async () => {
    mockOps.setBatchId.mockClear();
    const result = await registeredTools.get("batch_apply")!({
      batchId: "test-batch-001",
      updatedBy: "tester",
      ops: [
        { tool: "update_project_field", args: { clientSlug: "convergix", projectName: "CDS", field: "owner", newValue: "Lane" } },
        { tool: "create_week_item", args: { clientSlug: "convergix", title: "Drop 1", weekOf: "2026-04-13" } },
        { tool: "update_project_status", args: { clientSlug: "convergix", projectName: "CDS", newStatus: "completed" } },
      ],
    });
    // setBatchId called twice: once with batchId, once with null on cleanup
    expect(mockOps.setBatchId).toHaveBeenCalledWith("test-batch-001");
    expect(mockOps.setBatchId).toHaveBeenCalledWith(null);
    expect(mockOps.updateProjectField).toHaveBeenCalled();
    expect(mockOps.createWeekItem).toHaveBeenCalled();
    expect(mockOps.updateProjectStatus).toHaveBeenCalled();

    const text = (result as { content: [{ text: string }] }).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.results).toHaveLength(3);
    expect(parsed.data.results.every((r: { ok: boolean }) => r.ok)).toBe(true);
  });

  it("batch_apply with haltOnError=true stops after first failed op", async () => {
    mockOps.updateProjectField
      .mockResolvedValueOnce({ ok: true, message: "Updated" })
      .mockResolvedValueOnce({ ok: false, error: "Validator rejected" });
    const result = await registeredTools.get("batch_apply")!({
      batchId: "test-batch-halt",
      updatedBy: "tester",
      ops: [
        { tool: "update_project_field", args: { clientSlug: "convergix", projectName: "CDS", field: "owner", newValue: "A" } },
        { tool: "update_project_field", args: { clientSlug: "convergix", projectName: "CDS", field: "owner", newValue: "B" } },
        { tool: "update_project_field", args: { clientSlug: "convergix", projectName: "CDS", field: "owner", newValue: "C" } },
      ],
      haltOnError: true,
    });
    // Only 2 calls — third should not run after halt.
    expect(mockOps.updateProjectField).toHaveBeenCalledTimes(2);
    const text = (result as { content: [{ text: string }] }).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.ok).toBe(false);
    expect(parsed.data.results).toHaveLength(2);
    expect(parsed.data.results[1].ok).toBe(false);
    expect(parsed.data.results[1].error).toMatch(/Validator rejected/);
  });

  it("batch_apply with haltOnError=false runs every op and reports mixed results", async () => {
    mockOps.updateProjectField
      .mockResolvedValueOnce({ ok: true, message: "Updated" })
      .mockResolvedValueOnce({ ok: false, error: "Validator rejected" })
      .mockResolvedValueOnce({ ok: true, message: "Updated" });
    const result = await registeredTools.get("batch_apply")!({
      batchId: "test-batch-continue",
      updatedBy: "tester",
      ops: [
        { tool: "update_project_field", args: { clientSlug: "convergix", projectName: "CDS", field: "owner", newValue: "A" } },
        { tool: "update_project_field", args: { clientSlug: "convergix", projectName: "CDS", field: "owner", newValue: "B" } },
        { tool: "update_project_field", args: { clientSlug: "convergix", projectName: "CDS", field: "owner", newValue: "C" } },
      ],
      haltOnError: false,
    });
    expect(mockOps.updateProjectField).toHaveBeenCalledTimes(3);
    const text = (result as { content: [{ text: string }] }).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.ok).toBe(false);
    expect(parsed.data.results).toHaveLength(3);
    expect(parsed.data.results[0].ok).toBe(true);
    expect(parsed.data.results[1].ok).toBe(false);
    expect(parsed.data.results[2].ok).toBe(true);
  });

  it("batch_apply unknown tool name records error result without dispatching", async () => {
    const result = await registeredTools.get("batch_apply")!({
      batchId: "test-batch-unknown",
      updatedBy: "tester",
      ops: [{ tool: "no_such_tool", args: {} }],
    });
    const text = (result as { content: [{ text: string }] }).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.ok).toBe(false);
    expect(parsed.data.results[0].error).toMatch(/Unknown tool/);
  });

  it("batch_apply clears setBatchId in finally even when a handler throws", async () => {
    mockOps.setBatchId.mockClear();
    mockOps.updateProjectField.mockRejectedValueOnce(new Error("kaboom"));
    const result = await registeredTools.get("batch_apply")!({
      batchId: "test-batch-throw",
      updatedBy: "tester",
      ops: [
        { tool: "update_project_field", args: { clientSlug: "convergix", projectName: "CDS", field: "owner", newValue: "A" } },
      ],
    });
    expect(mockOps.setBatchId).toHaveBeenCalledWith("test-batch-throw");
    expect(mockOps.setBatchId).toHaveBeenCalledWith(null);
    const text = (result as { content: [{ text: string }] }).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.data.results[0].ok).toBe(false);
    expect(parsed.data.results[0].error).toMatch(/kaboom/);
  });

  it("batch_apply description excludes recursion (no batch_apply in dispatch table)", () => {
    const desc = registeredDescriptions.get("batch_apply")!;
    expect(desc).toMatch(/Recursive batch_apply is not allowed/);
  });

  // The 4 batch_apply rejection tests covering helper-level validators live
  // in batch-apply-validators.test.ts — that file uses the real helpers
  // backed by an in-memory DB (no operations-barrel mocks) so the validator
  // code path is genuinely exercised end-to-end. A regression that deletes
  // a validator from operations-utils would break those tests.
});
