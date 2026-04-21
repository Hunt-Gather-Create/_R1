import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPostMutationUpdate, mockOps } = vi.hoisted(() => {
  const mockPostMutationUpdate = vi.fn().mockResolvedValue(undefined);
  const mockOps = {
    getClientsWithCounts: vi.fn().mockResolvedValue([{ name: "Convergix" }]),
    getProjectsFiltered: vi.fn().mockResolvedValue([
      { name: "CDS", status: "in-production", client: "Convergix", owner: "Kathy", waitingOn: null, notes: null },
    ]),
    getProjectsForClient: vi.fn().mockResolvedValue([]),
    getPipelineData: vi.fn().mockResolvedValue([]),
    getWeekItemsData: vi.fn().mockResolvedValue([]),
    getPersonWorkload: vi.fn().mockResolvedValue({ person: "Kathy", projects: [], weekItems: [], totalProjects: 0, totalWeekItems: 0 }),
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

  it("creates all 23 tools", () => {
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
    expect(mockOps.getProjectsFiltered).toHaveBeenCalledWith({ clientSlug: "convergix", owner: "Kathy", waitingOn: undefined });
    expect(result).toHaveLength(1);
    expect((result as Record<string, unknown>[])[0].name).toBe("CDS");
  });

  it("get_projects passes waitingOn filter", async () => {
    await tools.get_projects.execute({ waitingOn: "Daniel" }, { toolCallId: "", messages: [], abortSignal: undefined as never });
    expect(mockOps.getProjectsFiltered).toHaveBeenCalledWith({ clientSlug: undefined, owner: undefined, waitingOn: "Daniel" });
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
    expect(mockOps.getWeekItemsData).toHaveBeenCalledWith("2026-04-06", "Kathy", "Roz", "Lane");
  });

  it("get_week_items passes undefined when no params given", async () => {
    await tools.get_week_items.execute({}, { toolCallId: "", messages: [], abortSignal: undefined as never });
    expect(mockOps.getWeekItemsData).toHaveBeenCalledWith(undefined, undefined, undefined, undefined);
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

  it("create_project passes target and waitingOn to addProject", async () => {
    mockOps.addProject.mockResolvedValue({
      ok: true, message: "Added project 'Widget Design' to Wilsonart.",
      data: { clientName: "Wilsonart", projectName: "Widget Design" },
    });
    await tools.create_project.execute(
      { clientSlug: "wilsonart", name: "Widget Design", target: "Q2 launch", waitingOn: "Daniel for assets" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockOps.addProject).toHaveBeenCalledWith(
      expect.objectContaining({ target: "Q2 launch", waitingOn: "Daniel for assets" })
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
});
