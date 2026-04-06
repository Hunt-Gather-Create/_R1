import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPostUpdate, mockOps } = vi.hoisted(() => {
  const mockPostUpdate = vi.fn().mockResolvedValue("ts123");
  const mockOps = {
    getClientsWithCounts: vi.fn().mockResolvedValue([{ name: "Convergix" }]),
    getProjectsForClient: vi.fn().mockResolvedValue([
      { name: "CDS", status: "in-production", owner: "Kathy", waitingOn: null, notes: null },
    ]),
    getPipelineData: vi.fn().mockResolvedValue([]),
    getWeekItemsData: vi.fn().mockResolvedValue([]),
    getClientBySlug: vi.fn(),
    updateProjectStatus: vi.fn(),
    addUpdate: vi.fn(),
  };
  return { mockPostUpdate, mockOps };
});

vi.mock("./updates-channel", () => ({
  postUpdate: (...args: unknown[]) => mockPostUpdate(...args),
}));
vi.mock("ai", () => ({ tool: vi.fn((config) => config) }));
vi.mock("@/lib/runway/operations", () => mockOps);

import { createBotTools } from "./bot-tools";

describe("createBotTools", () => {
  let tools: ReturnType<typeof createBotTools>;

  beforeEach(() => {
    vi.clearAllMocks();
    tools = createBotTools("Kathy Horn");
  });

  it("creates all 6 tools", () => {
    const names = Object.keys(tools);
    expect(names).toEqual(["get_clients", "get_projects", "get_pipeline", "get_week_items", "update_project_status", "add_update"]);
  });

  it("get_clients calls getClientsWithCounts", async () => {
    const result = await tools.get_clients.execute({}, { toolCallId: "", messages: [], abortSignal: undefined as never });
    expect(mockOps.getClientsWithCounts).toHaveBeenCalledOnce();
    expect(result).toEqual([{ name: "Convergix" }]);
  });

  it("get_projects returns error when client not found", async () => {
    mockOps.getClientBySlug.mockResolvedValue(null);
    const result = await tools.get_projects.execute({ clientSlug: "unknown" }, { toolCallId: "", messages: [], abortSignal: undefined as never });
    expect(result).toEqual({ error: "Client 'unknown' not found" });
  });

  it("get_projects returns project list when client found", async () => {
    mockOps.getClientBySlug.mockResolvedValue({ id: "c1" });
    const result = await tools.get_projects.execute({ clientSlug: "convergix" }, { toolCallId: "", messages: [], abortSignal: undefined as never });
    expect(result).toHaveLength(1);
    expect((result as Record<string, unknown>[])[0].name).toBe("CDS");
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
});
