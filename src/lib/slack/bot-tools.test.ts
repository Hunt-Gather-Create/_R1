import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPostUpdate, mockOps } = vi.hoisted(() => {
  const mockPostUpdate = vi.fn().mockResolvedValue("ts123");
  const mockOps = {
    getClientsWithCounts: vi.fn().mockResolvedValue([{ name: "Convergix" }]),
    getProjectsFiltered: vi.fn().mockResolvedValue([
      { name: "CDS", status: "in-production", client: "Convergix", owner: "Kathy", waitingOn: null, notes: null },
    ]),
    getProjectsForClient: vi.fn().mockResolvedValue([]),
    getPipelineData: vi.fn().mockResolvedValue([]),
    getWeekItemsData: vi.fn().mockResolvedValue([]),
    getPersonWorkload: vi.fn().mockResolvedValue({ person: "Kathy", projects: [], weekItems: [], totalProjects: 0, totalWeekItems: 0 }),
    getClientBySlug: vi.fn(),
    updateProjectStatus: vi.fn(),
    addProject: vi.fn(),
    addUpdate: vi.fn(),
    updateProjectField: vi.fn(),
    createWeekItem: vi.fn(),
    updateWeekItemField: vi.fn(),
    undoLastChange: vi.fn(),
    getRecentUpdates: vi.fn(),
  };
  return { mockPostUpdate, mockOps };
});

const { mockGetClientContactsStructured } = vi.hoisted(() => ({
  mockGetClientContactsStructured: vi.fn().mockResolvedValue([{ name: "Daniel", role: "Marketing Director" }]),
}));

vi.mock("./updates-channel", () => ({
  postUpdate: (...args: unknown[]) => mockPostUpdate(...args),
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

  it("creates all 14 tools", () => {
    const names = Object.keys(tools);
    expect(names).toEqual([
      "get_clients", "get_projects", "get_pipeline", "get_week_items",
      "update_project_status", "add_update", "get_person_workload", "get_client_contacts",
      "create_project", "update_project_field", "create_week_item",
      "undo_last_change", "get_recent_updates", "update_week_item",
    ]);
  });

  it("get_clients calls getClientsWithCounts", async () => {
    const result = await tools.get_clients.execute({}, { toolCallId: "", messages: [], abortSignal: undefined as never });
    expect(mockOps.getClientsWithCounts).toHaveBeenCalledOnce();
    expect(result).toEqual([{ name: "Convergix" }]);
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
    expect(mockPostUpdate).toHaveBeenCalledWith(expect.objectContaining({
      clientName: "Convergix", updatedBy: "Kathy Horn",
    }));
  });

  it("update_project_status returns error on failure", async () => {
    mockOps.updateProjectStatus.mockResolvedValue({ ok: false, error: "Not found", available: ["CDS"] });
    const result = await tools.update_project_status.execute(
      { clientSlug: "convergix", projectName: "nope", newStatus: "done" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(result).toEqual({ error: "Not found", available: ["CDS"] });
    expect(mockPostUpdate).not.toHaveBeenCalled();
  });

  it("update_project_status swallows postUpdate errors", async () => {
    mockOps.updateProjectStatus.mockResolvedValue({
      ok: true, message: "Updated",
      data: { clientName: "Convergix", projectName: "CDS", previousStatus: "active", newStatus: "done" },
    });
    mockPostUpdate.mockRejectedValueOnce(new Error("Slack down"));
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
    expect(mockPostUpdate).toHaveBeenCalledOnce();
  });

  it("add_update returns error on failure", async () => {
    mockOps.addUpdate.mockResolvedValue({ ok: false, error: "Client not found" });
    const result = await tools.add_update.execute(
      { clientSlug: "unknown", summary: "Test" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(result).toEqual({ error: "Client not found" });
    expect(mockPostUpdate).not.toHaveBeenCalled();
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
    expect(mockPostUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ updateText: "active -> done (R1 approved)" })
    );
  });

  it("update_project_status falls back to message when result.data is undefined", async () => {
    mockOps.updateProjectStatus.mockResolvedValue({ ok: true, message: "Updated (duplicate)" });
    const result = await tools.update_project_status.execute(
      { clientSlug: "convergix", projectName: "CDS", newStatus: "done" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockPostUpdate).not.toHaveBeenCalled();
    expect((result as Record<string, string>).result).toBe("Updated (duplicate)");
  });

  it("add_update swallows postUpdate errors", async () => {
    mockOps.addUpdate.mockResolvedValue({
      ok: true, message: "Logged",
      data: { clientName: "Convergix", projectName: "CDS" },
    });
    mockPostUpdate.mockRejectedValueOnce(new Error("Slack down"));
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
    expect(mockPostUpdate).not.toHaveBeenCalled();
  });

  it("get_pipeline calls getPipelineData", async () => {
    const result = await tools.get_pipeline.execute({}, { toolCallId: "", messages: [], abortSignal: undefined as never });
    expect(mockOps.getPipelineData).toHaveBeenCalledOnce();
    expect(result).toEqual([]);
  });

  it("get_week_items passes weekOf, owner, and resource parameters", async () => {
    await tools.get_week_items.execute({ weekOf: "2026-04-06", owner: "Kathy", resource: "Roz" }, { toolCallId: "", messages: [], abortSignal: undefined as never });
    expect(mockOps.getWeekItemsData).toHaveBeenCalledWith("2026-04-06", "Kathy", "Roz");
  });

  it("get_week_items passes undefined when no params given", async () => {
    await tools.get_week_items.execute({}, { toolCallId: "", messages: [], abortSignal: undefined as never });
    expect(mockOps.getWeekItemsData).toHaveBeenCalledWith(undefined, undefined, undefined);
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
    expect(mockPostUpdate).toHaveBeenCalledWith(
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
    expect(mockPostUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ clientName: "Wilsonart", projectName: "Widget Design" })
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
    expect(mockPostUpdate).toHaveBeenCalledWith(
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
    expect(mockPostUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ clientName: "Convergix" })
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
    expect(mockPostUpdate).toHaveBeenCalled();
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
    expect(mockPostUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ clientName: "Calendar", updatedBy: "Kathy Horn" })
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
    expect(mockPostUpdate).not.toHaveBeenCalled();
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
    expect(mockPostUpdate).not.toHaveBeenCalled();
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
    expect(mockPostUpdate).not.toHaveBeenCalled();
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
    expect(mockPostUpdate).toHaveBeenCalledWith(
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
    expect(mockPostUpdate).not.toHaveBeenCalled();
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
    expect(mockPostUpdate).toHaveBeenCalledWith(
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
    expect(mockPostUpdate).toHaveBeenCalledWith(
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
    expect(mockPostUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ updateText: expect.stringContaining("also updated project dueDate") })
    );
  });
});
