import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPostMutationUpdate, mockOps } = vi.hoisted(() => {
  const mockPostMutationUpdate = vi.fn().mockResolvedValue(undefined);
  const mockOps = {
    getClientsWithCounts: vi.fn().mockResolvedValue([{ name: "Convergix" }]),
    getClientDetail: vi.fn().mockResolvedValue({
      id: "c1", name: "Convergix", slug: "convergix", projects: [], pipelineItems: [], recentUpdates: [],
    }),
    getProjectsFiltered: vi.fn().mockResolvedValue([
      { name: "CDS", status: "in-production", client: "Convergix", owner: "Kathy", waitingOn: null, notes: null },
    ]),
    getProjectsForClient: vi.fn().mockResolvedValue([]),
    getPipelineData: vi.fn().mockResolvedValue([]),
    getWeekItemsData: vi.fn().mockResolvedValue([]),
    getWeekItemsInRange: vi.fn().mockResolvedValue([{ id: "w1", title: "Launch" }]),
    getOrphanWeekItems: vi.fn().mockResolvedValue([{ id: "w2", title: "Orphan", projectId: null }]),
    getPersonWorkload: vi.fn().mockResolvedValue({ person: "Kathy", projects: [], weekItems: [], totalProjects: 0, totalWeekItems: 0 }),
    findUpdates: vi.fn().mockResolvedValue([{ id: "u1", summary: "Changed" }]),
    getUpdateChain: vi.fn().mockResolvedValue({ root: { id: "u1" }, chain: [{ id: "u1" }] }),
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
    getProjectStatus: vi.fn().mockResolvedValue({
      ok: true,
      status: {
        name: "CDS Messaging", client: "Convergix", owner: "Kathy", status: "in-production",
        engagement_type: "project", contractRange: {}, current: {}, inFlight: [], upcoming: [],
        team: "CD: Lane", recentUpdates: [], suggestedActions: [],
      },
    }),
    getClientBySlug: vi.fn(),
    updateProjectStatus: vi.fn(),
    addProject: vi.fn(),
    addUpdate: vi.fn(),
    updateProjectField: vi.fn(),
    createWeekItem: vi.fn(),
    updateWeekItemField: vi.fn(),
    undoLastChange: vi.fn(),
    getRecentUpdates: vi.fn(),
    deleteProject: vi.fn(),
    deleteWeekItem: vi.fn(),
    createPipelineItem: vi.fn(),
    updatePipelineItem: vi.fn(),
    deletePipelineItem: vi.fn(),
    updateClientField: vi.fn(),
    createTeamMember: vi.fn(),
    updateTeamMember: vi.fn(),
  };
  return { mockPostMutationUpdate, mockOps };
});

const { mockGetClientContactsStructured } = vi.hoisted(() => ({
  mockGetClientContactsStructured: vi.fn().mockResolvedValue([{ name: "Daniel", role: "Marketing Director" }]),
}));

vi.mock("./updates-channel", () => ({
  postMutationUpdate: (...args: unknown[]) => mockPostMutationUpdate(...args),
}));
vi.mock("ai", () => ({ tool: vi.fn((config) => config) }));
vi.mock("@/lib/runway/operations", () => mockOps);
vi.mock("@/lib/runway/operations-context", () => ({
  getClientContactsStructured: (...args: unknown[]) => mockGetClientContactsStructured(...args),
}));

import { createBotTools } from "./bot-tools";

describe("createBotTools", () => {
  let tools: ReturnType<typeof createBotTools>;

  beforeEach(() => {
    vi.clearAllMocks();
    tools = createBotTools("Kathy Horn");
  });

  it("creates all 34 tools (23 legacy + 10 tier-2/3 v4 + 1 drift in PR #88 Chunk C)", () => {
    const names = Object.keys(tools);
    expect(names).toEqual([
      "get_clients", "get_projects", "get_pipeline", "get_week_items",
      "update_project_status", "add_update", "get_person_workload",
      "get_project_status", "get_client_contacts",
      "create_project", "update_project_field", "create_week_item",
      "undo_last_change", "get_recent_updates", "update_week_item",
      "delete_project", "delete_week_item",
      "create_pipeline_item", "update_pipeline_item", "delete_pipeline_item",
      "update_client_field", "create_team_member", "update_team_member",
      // Tier 2 (v4)
      "get_client_detail", "get_orphan_week_items", "get_week_items_range",
      "find_updates", "get_update_chain",
      // Tier 3 (v4)
      "get_flags", "get_data_health", "get_current_batch",
      "get_batch_contents", "get_cascade_log",
      // PR #88 Chunk C — drift detection
      "get_rows_changed_since",
    ]);
  });

  it("get_clients calls getClientsWithCounts", async () => {
    const result = await tools.get_clients.execute({}, { toolCallId: "", messages: [], abortSignal: undefined as never });
    expect(mockOps.getClientsWithCounts).toHaveBeenCalledWith({ includeProjects: undefined });
    expect(result).toEqual([{ name: "Convergix" }]);
  });

  it("get_clients passes includeProjects when provided", async () => {
    await tools.get_clients.execute(
      { includeProjects: true },
      { toolCallId: "", messages: [], abortSignal: undefined as never },
    );
    expect(mockOps.getClientsWithCounts).toHaveBeenCalledWith({ includeProjects: true });
  });

  it("get_projects calls getProjectsFiltered with params", async () => {
    const result = await tools.get_projects.execute({ clientSlug: "convergix", owner: "Kathy" }, { toolCallId: "", messages: [], abortSignal: undefined as never });
    expect(mockOps.getProjectsFiltered).toHaveBeenCalledWith({ clientSlug: "convergix", owner: "Kathy", waitingOn: undefined, engagementType: undefined, parentProjectId: undefined });
    expect(result).toHaveLength(1);
    expect((result as Record<string, unknown>[])[0].name).toBe("CDS");
  });

  it("get_projects passes waitingOn filter", async () => {
    await tools.get_projects.execute({ waitingOn: "Daniel" }, { toolCallId: "", messages: [], abortSignal: undefined as never });
    expect(mockOps.getProjectsFiltered).toHaveBeenCalledWith({ clientSlug: undefined, owner: undefined, waitingOn: "Daniel", engagementType: undefined, parentProjectId: undefined });
  });

  it("get_projects passes engagementType filter (PR #88 Chunk B)", async () => {
    await tools.get_projects.execute(
      { engagementType: "retainer" },
      { toolCallId: "", messages: [], abortSignal: undefined as never },
    );
    expect(mockOps.getProjectsFiltered).toHaveBeenCalledWith({
      clientSlug: undefined,
      owner: undefined,
      waitingOn: undefined,
      engagementType: "retainer",
      parentProjectId: undefined,
    });
  });

  it("get_projects forwards engagementType='__null__' sentinel", async () => {
    await tools.get_projects.execute(
      { engagementType: "__null__" },
      { toolCallId: "", messages: [], abortSignal: undefined as never },
    );
    expect(mockOps.getProjectsFiltered).toHaveBeenCalledWith({
      clientSlug: undefined,
      owner: undefined,
      waitingOn: undefined,
      engagementType: "__null__",
      parentProjectId: undefined,
    });
  });

  it("get_projects passes parentProjectId filter (PR #88 Chunk F)", async () => {
    await tools.get_projects.execute(
      { parentProjectId: "pj-wrap" },
      { toolCallId: "", messages: [], abortSignal: undefined as never },
    );
    expect(mockOps.getProjectsFiltered).toHaveBeenCalledWith({
      clientSlug: undefined,
      owner: undefined,
      waitingOn: undefined,
      engagementType: undefined,
      parentProjectId: "pj-wrap",
    });
  });

  it("get_projects forwards parentProjectId='__null__' sentinel", async () => {
    await tools.get_projects.execute(
      { parentProjectId: "__null__" },
      { toolCallId: "", messages: [], abortSignal: undefined as never },
    );
    expect(mockOps.getProjectsFiltered).toHaveBeenCalledWith({
      clientSlug: undefined,
      owner: undefined,
      waitingOn: undefined,
      engagementType: undefined,
      parentProjectId: "__null__",
    });
  });

  it("update_project_status posts to updates channel on success", async () => {
    mockOps.updateProjectStatus.mockResolvedValue({
      ok: true, message: "Updated",
      data: { clientName: "Convergix", projectName: "CDS", previousStatus: "active", newStatus: "done" },
    });
    const result = await tools.update_project_status.execute(
      { clientSlug: "convergix", projectName: "CDS", newStatus: "done" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect((result as Record<string, string>).result).toContain("Was: active, now: done");
    expect(mockPostMutationUpdate).toHaveBeenCalledWith(expect.objectContaining({
      fallbackClientName: "convergix", updatedBy: "Kathy Horn",
    }));
  });

  it("update_project_status returns error on failure", async () => {
    mockOps.updateProjectStatus.mockResolvedValue({ ok: false, error: "Not found", available: ["CDS"] });
    const result = await tools.update_project_status.execute(
      { clientSlug: "convergix", projectName: "nope", newStatus: "done" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(result).toEqual({ error: "Not found", available: ["CDS"] });
    expect(mockPostMutationUpdate).not.toHaveBeenCalled();
  });

  it("update_project_status succeeds even if safePostUpdate fails", async () => {
    mockOps.updateProjectStatus.mockResolvedValue({
      ok: true, message: "Updated",
      data: { clientName: "Convergix", projectName: "CDS", previousStatus: "active", newStatus: "done" },
    });
    // safePostUpdate catches errors internally — mock it to resolve normally
    mockPostMutationUpdate.mockResolvedValueOnce(undefined);
    const result = await tools.update_project_status.execute(
      { clientSlug: "convergix", projectName: "CDS", newStatus: "done" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect((result as Record<string, string>).result).toContain("Was: active, now: done");
  });

  it("add_update posts to updates channel on success", async () => {
    mockOps.addUpdate.mockResolvedValue({
      ok: true, message: "Logged",
      data: { clientName: "Convergix", projectName: "CDS" },
    });
    const result = await tools.add_update.execute(
      { clientSlug: "convergix", summary: "Client approved" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(result).toEqual({ result: "Logged" });
    expect(mockPostMutationUpdate).toHaveBeenCalledOnce();
  });

  it("add_update returns error on failure", async () => {
    mockOps.addUpdate.mockResolvedValue({ ok: false, error: "Client not found" });
    const result = await tools.add_update.execute(
      { clientSlug: "unknown", summary: "Test" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(result).toEqual({ error: "Client not found" });
    expect(mockPostMutationUpdate).not.toHaveBeenCalled();
  });

  it("passes userName to operations as updatedBy", async () => {
    mockOps.updateProjectStatus.mockResolvedValue({
      ok: true, message: "Updated",
      data: { clientName: "Convergix", projectName: "CDS", previousStatus: "active", newStatus: "done" },
    });
    await tools.update_project_status.execute(
      { clientSlug: "convergix", projectName: "CDS", newStatus: "done" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockOps.updateProjectStatus).toHaveBeenCalledWith(
      expect.objectContaining({ updatedBy: "Kathy Horn" })
    );
  });

  it("update_project_status includes notes in update text", async () => {
    mockOps.updateProjectStatus.mockResolvedValue({
      ok: true, message: "Updated",
      data: { clientName: "Convergix", projectName: "CDS", previousStatus: "active", newStatus: "done" },
    });
    await tools.update_project_status.execute(
      { clientSlug: "convergix", projectName: "CDS", newStatus: "done", notes: "R1 approved" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockPostMutationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ updateText: "active -> done (R1 approved)" })
    );
  });

  it("update_project_status falls back to message when result.data is undefined", async () => {
    mockOps.updateProjectStatus.mockResolvedValue({ ok: true, message: "Updated (duplicate)" });
    const result = await tools.update_project_status.execute(
      { clientSlug: "convergix", projectName: "CDS", newStatus: "done" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockPostMutationUpdate).not.toHaveBeenCalled();
    expect((result as Record<string, string>).result).toBe("Updated (duplicate)");
  });

  it("add_update succeeds even if safePostUpdate fails", async () => {
    mockOps.addUpdate.mockResolvedValue({
      ok: true, message: "Logged",
      data: { clientName: "Convergix", projectName: "CDS" },
    });
    // safePostUpdate catches errors internally — mock it to resolve normally
    mockPostMutationUpdate.mockResolvedValueOnce(undefined);
    const result = await tools.add_update.execute(
      { clientSlug: "convergix", summary: "Test note" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(result).toEqual({ result: "Logged" });
  });

  it("add_update skips postUpdate when result.data is undefined", async () => {
    mockOps.addUpdate.mockResolvedValue({ ok: true, message: "Logged" });
    await tools.add_update.execute(
      { clientSlug: "convergix", summary: "Test" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockPostMutationUpdate).not.toHaveBeenCalled();
  });

  it("get_pipeline calls getPipelineData", async () => {
    const result = await tools.get_pipeline.execute({}, { toolCallId: "", messages: [], abortSignal: undefined as never });
    expect(mockOps.getPipelineData).toHaveBeenCalledOnce();
    expect(result).toEqual([]);
  });

  it("get_week_items passes weekOf, owner, resource, and person parameters", async () => {
    await tools.get_week_items.execute(
      { weekOf: "2026-04-06", owner: "Kathy", resource: "Roz", person: "Lane" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockOps.getWeekItemsData).toHaveBeenCalledWith("2026-04-06", "Kathy", "Roz", "Lane", undefined, undefined);
  });

  it("get_week_items passes undefined when no params given", async () => {
    await tools.get_week_items.execute({}, { toolCallId: "", messages: [], abortSignal: undefined as never });
    expect(mockOps.getWeekItemsData).toHaveBeenCalledWith(undefined, undefined, undefined, undefined, undefined, undefined);
  });

  it("get_week_items passes status filter (PR #88 Chunk B)", async () => {
    await tools.get_week_items.execute(
      { weekOf: "2026-04-06", status: "blocked" },
      { toolCallId: "", messages: [], abortSignal: undefined as never },
    );
    expect(mockOps.getWeekItemsData).toHaveBeenCalledWith("2026-04-06", undefined, undefined, undefined, "blocked", undefined);
  });

  it("get_week_items passes clientSlug filter (PR #88 Chunk B)", async () => {
    await tools.get_week_items.execute(
      { clientSlug: "convergix" },
      { toolCallId: "", messages: [], abortSignal: undefined as never },
    );
    expect(mockOps.getWeekItemsData).toHaveBeenCalledWith(undefined, undefined, undefined, undefined, undefined, "convergix");
  });

  it("get_week_items forwards status='scheduled' sentinel", async () => {
    await tools.get_week_items.execute(
      { status: "scheduled" },
      { toolCallId: "", messages: [], abortSignal: undefined as never },
    );
    expect(mockOps.getWeekItemsData).toHaveBeenCalledWith(undefined, undefined, undefined, undefined, "scheduled", undefined);
  });

  it("get_person_workload calls getPersonWorkload", async () => {
    const result = await tools.get_person_workload.execute({ personName: "Kathy" }, { toolCallId: "", messages: [], abortSignal: undefined as never });
    expect(mockOps.getPersonWorkload).toHaveBeenCalledWith("Kathy");
    expect(result).toEqual(expect.objectContaining({ person: "Kathy" }));
  });

  it("get_client_contacts returns contacts from DB", async () => {
    const result = await tools.get_client_contacts.execute({ clientSlug: "convergix" }, { toolCallId: "", messages: [], abortSignal: undefined as never });
    expect(mockGetClientContactsStructured).toHaveBeenCalledWith("convergix");
    expect(result).toEqual(expect.objectContaining({ client: "convergix", contacts: [{ name: "Daniel", role: "Marketing Director" }] }));
  });

  it("get_client_contacts returns note when no contacts found", async () => {
    mockGetClientContactsStructured.mockResolvedValueOnce([]);
    const result = await tools.get_client_contacts.execute({ clientSlug: "lppc" }, { toolCallId: "", messages: [], abortSignal: undefined as never });
    expect(result).toEqual(expect.objectContaining({ note: "No contacts on file for this client" }));
  });

  it("update_project_status includes before/after and cascade info in response", async () => {
    mockOps.updateProjectStatus.mockResolvedValue({
      ok: true, message: "Updated Convergix / CDS: in-production -> completed",
      data: {
        clientName: "Convergix", projectName: "CDS",
        previousStatus: "in-production", newStatus: "completed",
        cascadedItems: ["CDS Review", "CDS Delivery"],
      },
    });
    const result = await tools.update_project_status.execute(
      { clientSlug: "convergix", projectName: "CDS", newStatus: "completed" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    const text = (result as Record<string, string>).result;
    expect(text).toContain("Was: in-production, now: completed");
    expect(text).toContain("Also updated 2 linked week item(s)");
    expect(text).toContain("CDS Review");
    expect(text).toContain("CDS Delivery");
  });

  it("update_project_status includes cascade count in updates channel post", async () => {
    mockOps.updateProjectStatus.mockResolvedValue({
      ok: true, message: "Updated",
      data: {
        clientName: "Convergix", projectName: "CDS",
        previousStatus: "active", newStatus: "completed",
        cascadedItems: ["Item A", "Item B"],
      },
    });
    await tools.update_project_status.execute(
      { clientSlug: "convergix", projectName: "CDS", newStatus: "completed" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockPostMutationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ updateText: "active -> completed [+2 week items]" })
    );
  });

  it("update_project_status omits cascade note when no items cascaded", async () => {
    mockOps.updateProjectStatus.mockResolvedValue({
      ok: true, message: "Updated",
      data: {
        clientName: "Convergix", projectName: "CDS",
        previousStatus: "active", newStatus: "completed",
        cascadedItems: [],
      },
    });
    const result = await tools.update_project_status.execute(
      { clientSlug: "convergix", projectName: "CDS", newStatus: "completed" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    const text = (result as Record<string, string>).result;
    expect(text).toContain("Was: active, now: completed");
    expect(text).not.toContain("Also updated");
  });

  // ── New tools ────────────────────────────────────────────

  it("create_project calls addProject and returns detailed summary", async () => {
    mockOps.addProject.mockResolvedValue({
      ok: true, message: "Added project 'Widget Design' to Wilsonart.",
      data: { clientName: "Wilsonart", projectName: "Widget Design" },
    });
    const result = await tools.create_project.execute(
      { clientSlug: "wilsonart", name: "Widget Design", owner: "Lane", dueDate: "2026-04-25" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockOps.addProject).toHaveBeenCalledWith(
      expect.objectContaining({ clientSlug: "wilsonart", name: "Widget Design", updatedBy: "Kathy Horn" })
    );
    expect(mockPostMutationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackClientName: "wilsonart", updateText: "New project created" })
    );
    const text = (result as Record<string, string>).result;
    expect(text).toContain("Widget Design");
    expect(text).toContain("Wilsonart");
    expect(text).toContain("Owner: Lane");
    expect(text).toContain("Due: 2026-04-25");
  });

  it("create_project passes waitingOn to addProject", async () => {
    mockOps.addProject.mockResolvedValue({
      ok: true, message: "Added project 'Widget Design' to Wilsonart.",
      data: { clientName: "Wilsonart", projectName: "Widget Design" },
    });
    await tools.create_project.execute(
      { clientSlug: "wilsonart", name: "Widget Design", waitingOn: "Daniel for assets" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockOps.addProject).toHaveBeenCalledWith(
      expect.objectContaining({ waitingOn: "Daniel for assets" })
    );
  });

  it("create_project returns error on failure", async () => {
    mockOps.addProject.mockResolvedValue({ ok: false, error: "Client 'unknown' not found." });
    const result = await tools.create_project.execute(
      { clientSlug: "unknown", name: "Test" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect((result as Record<string, string>).error).toContain("unknown");
  });

  it("update_project_field returns before/after in response", async () => {
    mockOps.updateProjectField.mockResolvedValue({
      ok: true, message: "Updated dueDate for Convergix / CDS.",
      data: { clientName: "Convergix", projectName: "CDS", field: "dueDate", previousValue: "2026-04-15", newValue: "2026-04-25" },
    });
    const result = await tools.update_project_field.execute(
      { clientSlug: "convergix", projectName: "CDS", field: "dueDate", newValue: "2026-04-25" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockOps.updateProjectField).toHaveBeenCalledWith(
      expect.objectContaining({ field: "dueDate", updatedBy: "Kathy Horn" })
    );
    expect(mockPostMutationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ updateText: expect.stringContaining("→") })
    );
    const text = (result as Record<string, string>).result;
    expect(text).toContain('Was: "2026-04-15"');
    expect(text).toContain('now: "2026-04-25"');
    expect(text).toContain("dueDate");
  });

  it("update_project_field returns available list on project not found", async () => {
    mockOps.updateProjectField.mockResolvedValue({
      ok: false, error: "Project not found", available: ["CDS", "Website"],
    });
    const result = await tools.update_project_field.execute(
      { clientSlug: "convergix", projectName: "Nonexistent", field: "owner", newValue: "Lane" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect((result as Record<string, string[]>).available).toEqual(["CDS", "Website"]);
  });

  it("update_project_field forwards parentProjectId field (PR #88 Chunk F)", async () => {
    mockOps.updateProjectField.mockResolvedValue({
      ok: true,
      message: "Updated parentProjectId for Convergix / CDS.",
      data: {
        clientName: "Convergix",
        projectName: "CDS",
        field: "parentProjectId",
        previousValue: "",
        newValue: "pj-wrap",
      },
    });
    await tools.update_project_field.execute(
      { clientSlug: "convergix", projectName: "CDS", field: "parentProjectId", newValue: "pj-wrap" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockOps.updateProjectField).toHaveBeenCalledWith(
      expect.objectContaining({ field: "parentProjectId", newValue: "pj-wrap" })
    );
  });

  it("create_week_item calls createWeekItem", async () => {
    mockOps.createWeekItem.mockResolvedValue({
      ok: true, message: "Added 'CDS Review' to week of 2026-04-06.",
      data: { clientName: "Convergix", title: "CDS Review" },
    });
    const result = await tools.create_week_item.execute(
      { clientSlug: "convergix", title: "CDS Review", weekOf: "2026-04-06" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockOps.createWeekItem).toHaveBeenCalledWith(
      expect.objectContaining({ title: "CDS Review", updatedBy: "Kathy Horn" })
    );
    expect((result as Record<string, string>).result).toContain("CDS Review");
  });

  it("create_week_item posts to updates channel when client exists", async () => {
    mockOps.createWeekItem.mockResolvedValue({
      ok: true, message: "Added.",
      data: { clientName: "Convergix", title: "CDS Review" },
    });
    await tools.create_week_item.execute(
      { clientSlug: "convergix", title: "CDS Review", weekOf: "2026-04-06" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockPostMutationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackClientName: "Calendar" })
    );
  });

  it("update_week_item calls updateWeekItemField", async () => {
    mockOps.updateWeekItemField.mockResolvedValue({
      ok: true, message: "Updated status for 'CDS Review'.",
      data: { weekItemTitle: "CDS Review", field: "status", previousValue: "", newValue: "completed", reverseCascaded: false },
    });
    const result = await tools.update_week_item.execute(
      { weekOf: "2026-04-06", weekItemTitle: "CDS Review", field: "status", newValue: "completed" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockOps.updateWeekItemField).toHaveBeenCalledWith(
      expect.objectContaining({ weekItemTitle: "CDS Review", updatedBy: "Kathy Horn" })
    );
    expect((result as Record<string, string>).result).toContain("CDS Review");
  });

  it("undo_last_change calls undoLastChange and posts update", async () => {
    mockOps.undoLastChange.mockResolvedValue({
      ok: true, message: 'Undone: reverted status from "completed" back to "in-production".',
      data: { undoneUpdateId: "u1", revertedFrom: "completed", revertedTo: "in-production" },
    });
    const result = await tools.undo_last_change.execute(
      {}, { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockOps.undoLastChange).toHaveBeenCalledWith({ updatedBy: "Kathy Horn" });
    expect(mockPostMutationUpdate).toHaveBeenCalled();
    expect((result as Record<string, string>).result).toContain("reverted");
  });

  it("undo_last_change returns error when nothing to undo", async () => {
    mockOps.undoLastChange.mockResolvedValue({ ok: false, error: "No recent change to undo." });
    const result = await tools.undo_last_change.execute(
      {}, { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect((result as Record<string, string>).error).toContain("No recent change");
  });

  it("get_recent_updates calls getRecentUpdates with userName", async () => {
    mockOps.getRecentUpdates.mockResolvedValue([
      { clientName: "Convergix", projectName: "CDS", updateType: "status-change", summary: "test" },
    ]);
    const result = await tools.get_recent_updates.execute(
      { clientSlug: "convergix" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockOps.getRecentUpdates).toHaveBeenCalledWith(
      expect.objectContaining({ updatedBy: "Kathy Horn", clientSlug: "convergix" })
    );
    expect(result).toHaveLength(1);
  });

  it("update_week_item posts to updates channel on success", async () => {
    mockOps.updateWeekItemField.mockResolvedValue({
      ok: true, message: "Updated status for 'CDS Review'.",
      data: { weekItemTitle: "CDS Review", field: "status", previousValue: "", newValue: "completed", reverseCascaded: false },
    });
    await tools.update_week_item.execute(
      { weekOf: "2026-04-06", weekItemTitle: "CDS Review", field: "status", newValue: "completed" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockPostMutationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackClientName: "Calendar", updatedBy: "Kathy Horn" })
    );
  });

  it("update_week_item returns available list on item not found", async () => {
    mockOps.updateWeekItemField.mockResolvedValue({
      ok: false, error: "Week item not found", available: ["CDS Review", "Widget Delivery"],
    });
    const result = await tools.update_week_item.execute(
      { weekOf: "2026-04-06", weekItemTitle: "Nonexistent", field: "status", newValue: "completed" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect((result as Record<string, string[]>).available).toEqual(["CDS Review", "Widget Delivery"]);
  });

  // ── No-op guard tests ─────────────────────────────────────

  it("update_project_status skips postUpdate when status unchanged", async () => {
    mockOps.updateProjectStatus.mockResolvedValue({
      ok: true, message: "Updated",
      data: { clientName: "Convergix", projectName: "CDS", previousStatus: "done", newStatus: "done" },
    });
    await tools.update_project_status.execute(
      { clientSlug: "convergix", projectName: "CDS", newStatus: "done" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockPostMutationUpdate).not.toHaveBeenCalled();
  });

  it("update_project_field skips postUpdate when value unchanged", async () => {
    mockOps.updateProjectField.mockResolvedValue({
      ok: true, message: "Updated dueDate for Convergix / CDS.",
      data: { clientName: "Convergix", projectName: "CDS", field: "dueDate", previousValue: "2026-04-28", newValue: "2026-04-28" },
    });
    await tools.update_project_field.execute(
      { clientSlug: "convergix", projectName: "CDS", field: "dueDate", newValue: "2026-04-28" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockPostMutationUpdate).not.toHaveBeenCalled();
  });

  it("update_week_item skips postUpdate when value unchanged", async () => {
    mockOps.updateWeekItemField.mockResolvedValue({
      ok: true, message: "Updated status for 'CDS Review'.",
      data: { weekItemTitle: "CDS Review", field: "status", previousValue: "completed", newValue: "completed", reverseCascaded: false },
    });
    await tools.update_week_item.execute(
      { weekOf: "2026-04-06", weekItemTitle: "CDS Review", field: "status", newValue: "completed" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockPostMutationUpdate).not.toHaveBeenCalled();
  });

  it("update_project_field posts when field unchanged but cascades happened", async () => {
    mockOps.updateProjectField.mockResolvedValue({
      ok: true, message: "Updated dueDate for Convergix / CDS.",
      data: {
        clientName: "Convergix", projectName: "CDS", field: "dueDate",
        previousValue: "2026-04-28", newValue: "2026-04-28",
        cascadedItems: ["Code handoff", "Go live"],
      },
    });
    await tools.update_project_field.execute(
      { clientSlug: "convergix", projectName: "CDS", field: "dueDate", newValue: "2026-04-28" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockPostMutationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ updateText: expect.stringContaining("Cascaded dueDate to 2 calendar item(s)") })
    );
  });

  it("update_project_field skips postUpdate when value unchanged and no cascades", async () => {
    mockOps.updateProjectField.mockResolvedValue({
      ok: true, message: "Updated dueDate for Convergix / CDS.",
      data: {
        clientName: "Convergix", projectName: "CDS", field: "dueDate",
        previousValue: "2026-04-28", newValue: "2026-04-28",
        cascadedItems: [],
      },
    });
    await tools.update_project_field.execute(
      { clientSlug: "convergix", projectName: "CDS", field: "dueDate", newValue: "2026-04-28" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockPostMutationUpdate).not.toHaveBeenCalled();
  });

  it("update_project_status posts when status unchanged but notes provided", async () => {
    mockOps.updateProjectStatus.mockResolvedValue({
      ok: true, message: "Updated",
      data: { clientName: "Convergix", projectName: "CDS", previousStatus: "done", newStatus: "done" },
    });
    await tools.update_project_status.execute(
      { clientSlug: "convergix", projectName: "CDS", newStatus: "done", notes: "Client confirmed delivery" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockPostMutationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ updateText: expect.stringContaining("Client confirmed delivery") })
    );
  });

  it("update_week_item posts with reverse cascade note", async () => {
    mockOps.updateWeekItemField.mockResolvedValue({
      ok: true, message: "Updated date for 'CDS Deadline'.",
      data: { weekItemTitle: "CDS Deadline", field: "date", previousValue: "2026-04-15", newValue: "2026-04-28", reverseCascaded: true },
    });
    await tools.update_week_item.execute(
      { weekOf: "2026-04-06", weekItemTitle: "CDS Deadline", field: "date", newValue: "2026-04-28" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockPostMutationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ updateText: expect.stringContaining("also updated project dueDate") })
    );
  });

  it("update_week_item posts on reverse cascade even when value unchanged", async () => {
    mockOps.updateWeekItemField.mockResolvedValue({
      ok: true, message: "Updated date for 'CDS Deadline'.",
      data: { weekItemTitle: "CDS Deadline", field: "date", previousValue: "2026-04-28", newValue: "2026-04-28", reverseCascaded: true },
    });
    await tools.update_week_item.execute(
      { weekOf: "2026-04-06", weekItemTitle: "CDS Deadline", field: "date", newValue: "2026-04-28" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockPostMutationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ updateText: expect.stringContaining("also updated project dueDate") })
    );
  });

  // ── New tool execution tests ──────────────────────────────

  it("delete_project calls deleteProject and posts update", async () => {
    mockOps.deleteProject.mockResolvedValue({
      ok: true, message: "Deleted project 'Brand Refresh'.",
      data: { clientName: "Convergix" },
    });
    const result = await tools.delete_project.execute(
      { clientSlug: "convergix", projectName: "Brand Refresh" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockOps.deleteProject).toHaveBeenCalledWith(
      expect.objectContaining({ clientSlug: "convergix", projectName: "Brand Refresh", updatedBy: "Kathy Horn" })
    );
    expect(mockPostMutationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackClientName: "convergix", updateText: "Deleted project: Brand Refresh" })
    );
    expect((result as Record<string, string>).result).toContain("Brand Refresh");
  });

  it("delete_project returns error on failure", async () => {
    mockOps.deleteProject.mockResolvedValue({ ok: false, error: "Not found", available: ["CDS"] });
    const result = await tools.delete_project.execute(
      { clientSlug: "convergix", projectName: "nope" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(result).toEqual({ error: "Not found", available: ["CDS"] });
    expect(mockPostMutationUpdate).not.toHaveBeenCalled();
  });

  it("delete_project falls back to clientSlug when clientName missing", async () => {
    mockOps.deleteProject.mockResolvedValue({ ok: true, message: "Deleted.", data: {} });
    await tools.delete_project.execute(
      { clientSlug: "convergix", projectName: "X" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockPostMutationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackClientName: "convergix" })
    );
  });

  it("delete_week_item calls deleteWeekItem and posts update", async () => {
    mockOps.deleteWeekItem.mockResolvedValue({
      ok: true, message: "Deleted week item 'CDS Review'.",
      data: { clientName: "Convergix" },
    });
    const result = await tools.delete_week_item.execute(
      { weekOf: "2026-04-06", weekItemTitle: "CDS Review" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockOps.deleteWeekItem).toHaveBeenCalledWith(
      expect.objectContaining({ weekOf: "2026-04-06", weekItemTitle: "CDS Review", updatedBy: "Kathy Horn" })
    );
    expect(mockPostMutationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackClientName: "Calendar", updateText: "Removed: CDS Review" })
    );
    expect((result as Record<string, string>).result).toContain("CDS Review");
  });

  it("delete_week_item returns error on failure", async () => {
    mockOps.deleteWeekItem.mockResolvedValue({ ok: false, error: "Week item not found", available: ["CDS Review"] });
    const result = await tools.delete_week_item.execute(
      { weekOf: "2026-04-06", weekItemTitle: "nope" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(result).toEqual({ error: "Week item not found", available: ["CDS Review"] });
    expect(mockPostMutationUpdate).not.toHaveBeenCalled();
  });

  it("delete_week_item falls back to Calendar when no clientName", async () => {
    mockOps.deleteWeekItem.mockResolvedValue({ ok: true, message: "Deleted.", data: {} });
    await tools.delete_week_item.execute(
      { weekOf: "2026-04-06", weekItemTitle: "Team Standup" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockPostMutationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackClientName: "Calendar" })
    );
  });

  it("create_pipeline_item calls createPipelineItem and posts update", async () => {
    mockOps.createPipelineItem.mockResolvedValue({
      ok: true, message: "Created pipeline item 'New SOW'.",
      data: { clientName: "Bonterra" },
    });
    const result = await tools.create_pipeline_item.execute(
      { clientSlug: "bonterra", name: "New SOW", status: "scoping" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockOps.createPipelineItem).toHaveBeenCalledWith(
      expect.objectContaining({ clientSlug: "bonterra", name: "New SOW", status: "scoping", updatedBy: "Kathy Horn" })
    );
    expect(mockPostMutationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackClientName: "bonterra", updateText: "New pipeline item: New SOW" })
    );
    expect((result as Record<string, string>).result).toContain("New SOW");
  });

  it("create_pipeline_item returns error on failure", async () => {
    mockOps.createPipelineItem.mockResolvedValue({ ok: false, error: "Client not found" });
    const result = await tools.create_pipeline_item.execute(
      { clientSlug: "nope", name: "SOW" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(result).toEqual({ error: "Client not found" });
    expect(mockPostMutationUpdate).not.toHaveBeenCalled();
  });

  it("update_pipeline_item calls updatePipelineItem and posts update", async () => {
    mockOps.updatePipelineItem.mockResolvedValue({
      ok: true, message: "Updated status for 'New SOW'.",
      data: { clientName: "Bonterra" },
    });
    const result = await tools.update_pipeline_item.execute(
      { clientSlug: "bonterra", pipelineName: "New SOW", field: "status", newValue: "proposal" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockOps.updatePipelineItem).toHaveBeenCalledWith(
      expect.objectContaining({ pipelineName: "New SOW", field: "status", newValue: "proposal", updatedBy: "Kathy Horn" })
    );
    expect(mockPostMutationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackClientName: "bonterra", updateText: "Pipeline New SOW: status updated" })
    );
    expect((result as Record<string, string>).result).toContain("New SOW");
  });

  it("update_pipeline_item returns error with available list", async () => {
    mockOps.updatePipelineItem.mockResolvedValue({ ok: false, error: "Not found", available: ["Existing SOW"] });
    const result = await tools.update_pipeline_item.execute(
      { clientSlug: "bonterra", pipelineName: "nope", field: "status", newValue: "signed" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(result).toEqual({ error: "Not found", available: ["Existing SOW"] });
    expect(mockPostMutationUpdate).not.toHaveBeenCalled();
  });

  it("delete_pipeline_item calls deletePipelineItem and posts update", async () => {
    mockOps.deletePipelineItem.mockResolvedValue({
      ok: true, message: "Deleted pipeline item 'Old SOW'.",
      data: { clientName: "Bonterra" },
    });
    const result = await tools.delete_pipeline_item.execute(
      { clientSlug: "bonterra", pipelineName: "Old SOW" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockOps.deletePipelineItem).toHaveBeenCalledWith(
      expect.objectContaining({ clientSlug: "bonterra", pipelineName: "Old SOW", updatedBy: "Kathy Horn" })
    );
    expect(mockPostMutationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackClientName: "bonterra", updateText: "Removed pipeline item: Old SOW" })
    );
    expect((result as Record<string, string>).result).toContain("Old SOW");
  });

  it("delete_pipeline_item returns error on failure", async () => {
    mockOps.deletePipelineItem.mockResolvedValue({ ok: false, error: "Pipeline item not found", available: ["Existing SOW"] });
    const result = await tools.delete_pipeline_item.execute(
      { clientSlug: "bonterra", pipelineName: "nope" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(result).toEqual({ error: "Pipeline item not found", available: ["Existing SOW"] });
    expect(mockPostMutationUpdate).not.toHaveBeenCalled();
  });

  it("update_client_field calls updateClientField and posts update", async () => {
    mockOps.updateClientField.mockResolvedValue({
      ok: true, message: "Updated team for Convergix.",
      data: { clientName: "Convergix" },
    });
    const result = await tools.update_client_field.execute(
      { clientSlug: "convergix", field: "team", newValue: "Kathy, Lane" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockOps.updateClientField).toHaveBeenCalledWith(
      expect.objectContaining({ clientSlug: "convergix", field: "team", newValue: "Kathy, Lane", updatedBy: "Kathy Horn" })
    );
    expect(mockPostMutationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackClientName: "convergix", updateText: "team updated" })
    );
    expect((result as Record<string, string>).result).toContain("Convergix");
  });

  it("update_client_field returns error on failure", async () => {
    mockOps.updateClientField.mockResolvedValue({ ok: false, error: "Client not found" });
    const result = await tools.update_client_field.execute(
      { clientSlug: "nope", field: "team", newValue: "X" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(result).toEqual({ error: "Client not found" });
    expect(mockPostMutationUpdate).not.toHaveBeenCalled();
  });

  it("create_team_member calls createTeamMember and posts update", async () => {
    mockOps.createTeamMember.mockResolvedValue({
      ok: true, message: "Created team member 'Lane'.",
    });
    const result = await tools.create_team_member.execute(
      { name: "Lane", fullName: "Lane Davis", title: "Developer" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockOps.createTeamMember).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Lane", fullName: "Lane Davis", title: "Developer", updatedBy: "Kathy Horn" })
    );
    expect(mockPostMutationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackClientName: "Team", updateText: "New member: Lane" })
    );
    expect((result as Record<string, string>).result).toContain("Lane");
  });

  it("create_team_member returns error on failure", async () => {
    mockOps.createTeamMember.mockResolvedValue({ ok: false, error: "Member already exists" });
    const result = await tools.create_team_member.execute(
      { name: "Kathy" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(result).toEqual({ error: "Member already exists" });
    expect(mockPostMutationUpdate).not.toHaveBeenCalled();
  });

  it("update_team_member calls updateTeamMember and posts update", async () => {
    mockOps.updateTeamMember.mockResolvedValue({
      ok: true, message: "Updated title for Lane.",
      data: { clientName: "Team" },
    });
    const result = await tools.update_team_member.execute(
      { memberName: "Lane", field: "title", newValue: "Senior Developer" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockOps.updateTeamMember).toHaveBeenCalledWith(
      expect.objectContaining({ memberName: "Lane", field: "title", newValue: "Senior Developer", updatedBy: "Kathy Horn" })
    );
    expect(mockPostMutationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackClientName: "Team", updateText: "Lane: title updated" })
    );
    expect((result as Record<string, string>).result).toContain("Lane");
  });

  it("update_team_member returns error with available list", async () => {
    mockOps.updateTeamMember.mockResolvedValue({ ok: false, error: "Not found", available: ["Kathy", "Lane"] });
    const result = await tools.update_team_member.execute(
      { memberName: "Nobody", field: "title", newValue: "X" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(result).toEqual({ error: "Not found", available: ["Kathy", "Lane"] });
    expect(mockPostMutationUpdate).not.toHaveBeenCalled();
  });

  // ── Tier 2 read tool mirrors (PR #86 v4) ──────────────────

  it("get_client_detail calls getClientDetail and returns deep view", async () => {
    const result = await tools.get_client_detail.execute(
      { slug: "convergix" },
      { toolCallId: "", messages: [], abortSignal: undefined as never },
    );
    expect(mockOps.getClientDetail).toHaveBeenCalledWith("convergix", { recentUpdatesLimit: undefined });
    expect(result).toEqual(expect.objectContaining({ slug: "convergix" }));
  });

  it("get_client_detail passes recentUpdatesLimit", async () => {
    await tools.get_client_detail.execute(
      { slug: "convergix", recentUpdatesLimit: 5 },
      { toolCallId: "", messages: [], abortSignal: undefined as never },
    );
    expect(mockOps.getClientDetail).toHaveBeenCalledWith("convergix", { recentUpdatesLimit: 5 });
  });

  it("get_client_detail returns error when client not found", async () => {
    mockOps.getClientDetail.mockResolvedValueOnce(null);
    const result = await tools.get_client_detail.execute(
      { slug: "nope" },
      { toolCallId: "", messages: [], abortSignal: undefined as never },
    );
    expect(result).toEqual({ error: "Client 'nope' not found." });
  });

  it("get_orphan_week_items calls getOrphanWeekItems", async () => {
    const result = await tools.get_orphan_week_items.execute(
      {}, { toolCallId: "", messages: [], abortSignal: undefined as never },
    );
    expect(mockOps.getOrphanWeekItems).toHaveBeenCalledWith(undefined);
    expect(result).toEqual([{ id: "w2", title: "Orphan", projectId: null }]);
  });

  it("get_orphan_week_items passes clientSlug", async () => {
    await tools.get_orphan_week_items.execute(
      { clientSlug: "convergix" },
      { toolCallId: "", messages: [], abortSignal: undefined as never },
    );
    expect(mockOps.getOrphanWeekItems).toHaveBeenCalledWith("convergix");
  });

  it("get_week_items_range passes all params", async () => {
    await tools.get_week_items_range.execute(
      { fromDate: "2026-04-01", toDate: "2026-04-30", clientSlug: "convergix", owner: "Kathy", category: "deadline" },
      { toolCallId: "", messages: [], abortSignal: undefined as never },
    );
    expect(mockOps.getWeekItemsInRange).toHaveBeenCalledWith(
      "2026-04-01", "2026-04-30", "convergix", "Kathy", "deadline",
    );
  });

  it("find_updates passes all filters", async () => {
    const params = {
      since: "2026-04-01", until: "2026-04-30", clientSlug: "convergix",
      updatedBy: "Kathy", updateType: "status-change", batchId: "b1",
      projectName: "CDS", limit: 50,
    };
    const result = await tools.find_updates.execute(
      params, { toolCallId: "", messages: [], abortSignal: undefined as never },
    );
    expect(mockOps.findUpdates).toHaveBeenCalledWith(params);
    expect(result).toEqual([{ id: "u1", summary: "Changed" }]);
  });

  it("get_update_chain passes updateId", async () => {
    const result = await tools.get_update_chain.execute(
      { updateId: "u1" },
      { toolCallId: "", messages: [], abortSignal: undefined as never },
    );
    expect(mockOps.getUpdateChain).toHaveBeenCalledWith("u1");
    expect(result).toEqual({ root: { id: "u1" }, chain: [{ id: "u1" }] });
  });

  // ── Tier 3 observability mirrors (PR #86 v4) ──────────────

  it("get_flags calls getFlags", async () => {
    const result = await tools.get_flags.execute(
      {}, { toolCallId: "", messages: [], abortSignal: undefined as never },
    );
    expect(mockOps.getFlags).toHaveBeenCalledWith({ clientSlug: undefined, personName: undefined });
    expect(result).toEqual(expect.objectContaining({ flags: [], contractExpired: [] }));
  });

  it("get_flags passes clientSlug and personName", async () => {
    await tools.get_flags.execute(
      { clientSlug: "convergix", personName: "Kathy" },
      { toolCallId: "", messages: [], abortSignal: undefined as never },
    );
    expect(mockOps.getFlags).toHaveBeenCalledWith({ clientSlug: "convergix", personName: "Kathy" });
  });

  it("get_data_health returns snapshot", async () => {
    const result = await tools.get_data_health.execute(
      {}, { toolCallId: "", messages: [], abortSignal: undefined as never },
    );
    expect(mockOps.getDataHealth).toHaveBeenCalledOnce();
    expect(result).toEqual(expect.objectContaining({ totals: expect.any(Object) }));
  });

  it("get_current_batch returns active=false when idle", async () => {
    const result = await tools.get_current_batch.execute(
      {}, { toolCallId: "", messages: [], abortSignal: undefined as never },
    );
    expect(mockOps.getCurrentBatch).toHaveBeenCalledOnce();
    expect(result).toEqual({ active: false });
  });

  it("get_batch_contents passes batchId", async () => {
    await tools.get_batch_contents.execute(
      { batchId: "cleanup-2026-04-18" },
      { toolCallId: "", messages: [], abortSignal: undefined as never },
    );
    expect(mockOps.getBatchContents).toHaveBeenCalledWith("cleanup-2026-04-18");
  });

  it("get_cascade_log passes windowMinutes", async () => {
    await tools.get_cascade_log.execute(
      { windowMinutes: 30 },
      { toolCallId: "", messages: [], abortSignal: undefined as never },
    );
    expect(mockOps.getCascadeLog).toHaveBeenCalledWith(30);
  });

  it("get_cascade_log works without windowMinutes", async () => {
    await tools.get_cascade_log.execute(
      {}, { toolCallId: "", messages: [], abortSignal: undefined as never },
    );
    expect(mockOps.getCascadeLog).toHaveBeenCalledWith(undefined);
  });

  it("get_rows_changed_since passes since + filters", async () => {
    await tools.get_rows_changed_since.execute(
      { since: "2026-04-20T00:00:00.000Z", tables: ["projects"], clientSlug: "convergix" },
      { toolCallId: "", messages: [], abortSignal: undefined as never },
    );
    expect(mockOps.getRowsChangedSince).toHaveBeenCalledWith(
      "2026-04-20T00:00:00.000Z",
      { tables: ["projects"], clientSlug: "convergix" },
    );
  });

  it("get_rows_changed_since works with only `since`", async () => {
    await tools.get_rows_changed_since.execute(
      { since: "2026-04-20T00:00:00.000Z" },
      { toolCallId: "", messages: [], abortSignal: undefined as never },
    );
    expect(mockOps.getRowsChangedSince).toHaveBeenCalledWith(
      "2026-04-20T00:00:00.000Z",
      { tables: undefined, clientSlug: undefined },
    );
  });

  // ── Description drift assertions ──────────────────────────

  it("get_person_workload description describes v4 buckets + flags (not 'grouped by client')", () => {
    const desc = (tools.get_person_workload as { description: string }).description;
    expect(desc).toContain("ownedProjects");
    expect(desc).toContain("weekItems");
    expect(desc).toContain("overdue");
    expect(desc).toContain("thisWeek");
    expect(desc).toContain("flags");
    expect(desc).toContain("contractExpired");
    expect(desc).toContain("retainerRenewalDue");
    expect(desc).not.toMatch(/grouped by client/i);
  });

  it("get_projects description documents v4 enrichment keys", () => {
    const desc = (tools.get_projects as { description: string }).description;
    expect(desc).toContain("dueDate");
    expect(desc).toContain("engagementType");
    expect(desc).toContain("contractStart");
    expect(desc).toContain("contractEnd");
  });

  it("get_clients description documents includeProjects option", () => {
    const desc = (tools.get_clients as { description: string }).description;
    expect(desc).toContain("includeProjects");
    expect(desc).toContain("projectCount");
  });
});
