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
    addUpdate: vi.fn(),
  };
  return { mockPostUpdate, mockOps };
});

const { mockGetClientContactsRef } = vi.hoisted(() => ({
  mockGetClientContactsRef: vi.fn().mockReturnValue([{ name: "Daniel", role: "Marketing Director" }]),
}));

vi.mock("./updates-channel", () => ({
  postUpdate: (...args: unknown[]) => mockPostUpdate(...args),
}));
vi.mock("ai", () => ({ tool: vi.fn((config) => config) }));
vi.mock("@/lib/runway/operations", () => mockOps);
vi.mock("@/lib/runway/reference/clients", () => ({
  getClientContactsRef: (...args: unknown[]) => mockGetClientContactsRef(...args),
}));

import { createBotTools } from "./bot-tools";

describe("createBotTools", () => {
  let tools: ReturnType<typeof createBotTools>;

  beforeEach(() => {
    vi.clearAllMocks();
    tools = createBotTools("Kathy Horn");
  });

  it("creates all 8 tools", () => {
    const names = Object.keys(tools);
    expect(names).toEqual([
      "get_clients", "get_projects", "get_pipeline", "get_week_items",
      "update_project_status", "add_update", "get_person_workload", "get_client_contacts",
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
    expect(result).toEqual({ result: "Updated" });
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
    expect(result).toEqual({ result: "Updated" });
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
    mockOps.updateProjectStatus.mockResolvedValue({ ok: true, message: "Updated" });
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

  it("update_project_status skips postUpdate when result.data is undefined", async () => {
    mockOps.updateProjectStatus.mockResolvedValue({ ok: true, message: "Updated" });
    await tools.update_project_status.execute(
      { clientSlug: "convergix", projectName: "CDS", newStatus: "done" },
      { toolCallId: "", messages: [], abortSignal: undefined as never }
    );
    expect(mockPostUpdate).not.toHaveBeenCalled();
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

  it("get_client_contacts returns contacts from reference data", async () => {
    const result = await tools.get_client_contacts.execute({ clientSlug: "convergix" }, { toolCallId: "", messages: [], abortSignal: undefined as never });
    expect(mockGetClientContactsRef).toHaveBeenCalledWith("convergix");
    expect(result).toEqual(expect.objectContaining({ client: "convergix", contacts: [{ name: "Daniel", role: "Marketing Director" }] }));
  });

  it("get_client_contacts returns note when no contacts found", async () => {
    mockGetClientContactsRef.mockReturnValueOnce([]);
    const result = await tools.get_client_contacts.execute({ clientSlug: "lppc" }, { toolCallId: "", messages: [], abortSignal: undefined as never });
    expect(result).toEqual(expect.objectContaining({ note: "No contacts on file for this client" }));
  });

  it("update_project_status includes cascade info in response when items cascaded", async () => {
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
    expect((result as Record<string, string>).result).toContain("Also updated 2 linked week item(s)");
    expect((result as Record<string, string>).result).toContain("CDS Review");
    expect((result as Record<string, string>).result).toContain("CDS Delivery");
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
    expect((result as Record<string, string>).result).toBe("Updated");
  });
});
