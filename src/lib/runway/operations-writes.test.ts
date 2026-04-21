import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock state ───────────────��──────────────────────────
const mockInsertValues = vi.fn();
const mockUpdateSet = vi.fn();
const mockUpdateWhere = vi.fn();

vi.mock("@/lib/db/runway", () => {
  const tx = {
    insert: vi.fn(() => ({ values: mockInsertValues })),
    update: vi.fn(() => ({
      set: vi.fn((...args: unknown[]) => {
        mockUpdateSet(...args);
        return { where: mockUpdateWhere };
      }),
    })),
  };
  return {
    getRunwayDb: () => ({
      insert: vi.fn(() => ({ values: mockInsertValues })),
      update: vi.fn(() => ({
        set: vi.fn((...args: unknown[]) => {
          mockUpdateSet(...args);
          return { where: mockUpdateWhere };
        }),
      })),
      transaction: vi.fn(async (fn: (arg: typeof tx) => Promise<unknown>) => fn(tx)),
    }),
  };
});

vi.mock("@/lib/db/runway-schema", () => ({
  projects: { id: "id" },
  updates: {},
  weekItems: { id: "id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
}));

// Mock operations (reads) that writes depend on
const mockGetClientBySlug = vi.fn();
const mockFindProjectByFuzzyName = vi.fn();
const mockGetProjectsForClient = vi.fn();
const mockCheckIdempotency = vi.fn();
const mockGetLinkedWeekItems = vi.fn();

let _idCounter = 0;
vi.mock("./operations-utils", () => ({
  CASCADE_STATUSES: ["completed", "blocked", "on-hold"],
  TERMINAL_ITEM_STATUSES: ["completed", "canceled"],
  generateIdempotencyKey: (...parts: string[]) => parts.join("|"),
  generateId: () => `mock-id-${++_idCounter}`,
  getClientOrFail: async (slug: string) => {
    const client = await mockGetClientBySlug(slug);
    if (!client) return { ok: false, error: `Client '${slug}' not found.` };
    return { ok: true, client };
  },
  resolveProjectOrFail: async (_clientId: string, _clientName: string, projectName: string) => {
    const result = await mockFindProjectByFuzzyName(_clientId, projectName);
    if (!result) {
      const available = await mockGetProjectsForClient(_clientId);
      return { ok: false, error: `Project '${projectName}' not found.`, available: available?.map((p: { name: string }) => p.name) };
    }
    return { ok: true, project: result };
  },
  getProjectsForClient: (...args: unknown[]) =>
    mockGetProjectsForClient(...args),
  checkDuplicate: async (idemKey: string, dupResult: unknown) => {
    if (await mockCheckIdempotency(idemKey)) return dupResult;
    return null;
  },
  insertAuditRecord: async (params: Record<string, unknown>) => {
    const id = (params.id as string | undefined) ?? `mock-id-${++_idCounter}`;
    mockInsertValues({ ...params, id });
    return id;
  },
}));

vi.mock("./operations-reads-week", () => ({
  getLinkedWeekItems: (...args: unknown[]) => mockGetLinkedWeekItems(...args),
}));

const client = { id: "c1", name: "Convergix", slug: "convergix" };
const project = { id: "p1", name: "CDS Messaging", status: "in-production" };

beforeEach(() => {
  vi.clearAllMocks();
  _idCounter = 0;
  mockCheckIdempotency.mockResolvedValue(false);
  mockGetLinkedWeekItems.mockResolvedValue([]);
});

describe("updateProjectStatus", () => {
  it("updates project and inserts audit update", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);

    const { updateProjectStatus } = await import("./operations-writes");
    const result = await updateProjectStatus({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      newStatus: "awaiting-client",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    expect(result.message).toContain("in-production");
    expect(result.message).toContain("awaiting-client");
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "awaiting-client" })
    );
    expect(mockInsertValues).toHaveBeenCalled();
  });

  it("returns error when client not found", async () => {
    mockGetClientBySlug.mockResolvedValue(null);

    const { updateProjectStatus } = await import("./operations-writes");
    const result = await updateProjectStatus({
      clientSlug: "unknown",
      projectName: "Test",
      newStatus: "done",
      updatedBy: "jason",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("unknown");
    }
  });

  it("returns error with available projects when project not found", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(null);
    mockGetProjectsForClient.mockResolvedValue([
      { name: "CDS Messaging" },
      { name: "Website" },
    ]);

    const { updateProjectStatus } = await import("./operations-writes");
    const result = await updateProjectStatus({
      clientSlug: "convergix",
      projectName: "Nonexistent",
      newStatus: "done",
      updatedBy: "jason",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.available).toEqual(["CDS Messaging", "Website"]);
    }
  });

  it("returns success without writing when idempotency key matches", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);
    mockCheckIdempotency.mockResolvedValue(true);

    const { updateProjectStatus } = await import("./operations-writes");
    const result = await updateProjectStatus({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      newStatus: "done",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    expect(result.message).toContain("duplicate");
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });

  it("includes notes in audit summary when provided", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);

    const { updateProjectStatus } = await import("./operations-writes");
    await updateProjectStatus({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      newStatus: "blocked",
      updatedBy: "kathy",
      notes: "Waiting on client feedback",
    });

    const insertCall = mockInsertValues.mock.calls[0][0];
    expect(insertCall.summary).toContain("Waiting on client feedback");
  });

  it("omits notes from summary when not provided", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);

    const { updateProjectStatus } = await import("./operations-writes");
    await updateProjectStatus({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      newStatus: "awaiting-client",
      updatedBy: "kathy",
    });

    const insertCall = mockInsertValues.mock.calls[0][0];
    // Summary should end without ". " appended notes
    expect(insertCall.summary).toBe(
      "Convergix / CDS Messaging: in-production -> awaiting-client"
    );
  });

  it("returns data with status transition details on success", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);

    const { updateProjectStatus } = await import("./operations-writes");
    const result = await updateProjectStatus({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      newStatus: "completed",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({
        clientName: "Convergix",
        projectName: "CDS Messaging",
        previousStatus: "in-production",
        newStatus: "completed",
        cascadedItems: [],
        // PR #86: structured cascade trace (empty — no cascade statuses here).
        cascadeDetail: [],
        // PR #86: parent audit id — stable in this mock (`generateId` is a counter).
        auditId: expect.any(String),
      });
    }
  });

  it("sets updatedAt to a Date object", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);

    const { updateProjectStatus } = await import("./operations-writes");
    await updateProjectStatus({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      newStatus: "done",
      updatedBy: "kathy",
    });

    const setCall = mockUpdateSet.mock.calls[0][0];
    expect(setCall.updatedAt).toBeInstanceOf(Date);
  });

  it("logs correct update type and values in audit record", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);

    const { updateProjectStatus } = await import("./operations-writes");
    await updateProjectStatus({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      newStatus: "blocked",
      updatedBy: "kathy",
    });

    const insertCall = mockInsertValues.mock.calls[0][0];
    expect(insertCall.updateType).toBe("status-change");
    expect(insertCall.previousValue).toBe("in-production");
    expect(insertCall.newValue).toBe("blocked");
    expect(insertCall.clientId).toBe("c1");
    expect(insertCall.projectId).toBe("p1");
  });

  it("cascades completed status to linked non-terminal week items", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);
    mockGetLinkedWeekItems.mockResolvedValue([
      { id: "wi1", title: "CDS Review", status: null },
      { id: "wi2", title: "CDS Delivery", status: "in-progress" },
    ]);

    const { updateProjectStatus } = await import("./operations-writes");
    const result = await updateProjectStatus({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      newStatus: "completed",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.cascadedItems).toEqual(["CDS Review", "CDS Delivery"]);
    }
    // Two week item updates (one per linked item)
    expect(mockUpdateSet).toHaveBeenCalledTimes(3); // 1 project + 2 week items
  });

  it("does not cascade completed to already-completed week items", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);
    mockGetLinkedWeekItems.mockResolvedValue([
      { id: "wi1", title: "Already Done", status: "completed" },
      { id: "wi2", title: "Active Item", status: null },
    ]);

    const { updateProjectStatus } = await import("./operations-writes");
    const result = await updateProjectStatus({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      newStatus: "completed",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.cascadedItems).toEqual(["Active Item"]);
    }
  });

  it("does not cascade completed to canceled week items", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);
    mockGetLinkedWeekItems.mockResolvedValue([
      { id: "wi1", title: "Canceled Item", status: "canceled" },
    ]);

    const { updateProjectStatus } = await import("./operations-writes");
    const result = await updateProjectStatus({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      newStatus: "completed",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.cascadedItems).toEqual([]);
    }
  });

  it("does not cascade non-terminal status (in-production)", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);
    mockGetLinkedWeekItems.mockResolvedValue([
      { id: "wi1", title: "Active Item", status: null },
    ]);

    const { updateProjectStatus } = await import("./operations-writes");
    const result = await updateProjectStatus({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      newStatus: "in-production",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.cascadedItems).toEqual([]);
    }
    // getLinkedWeekItems should NOT be called for non-terminal statuses
    expect(mockGetLinkedWeekItems).not.toHaveBeenCalled();
  });

  it("cascades blocked status to linked active week items", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);
    mockGetLinkedWeekItems.mockResolvedValue([
      { id: "wi1", title: "Blocked Item", status: null },
    ]);

    const { updateProjectStatus } = await import("./operations-writes");
    const result = await updateProjectStatus({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      newStatus: "blocked",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.cascadedItems).toEqual(["Blocked Item"]);
    }
  });

  it("cascades on-hold status to linked active week items", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);
    mockGetLinkedWeekItems.mockResolvedValue([
      { id: "wi1", title: "Paused Item", status: "in-progress" },
    ]);

    const { updateProjectStatus } = await import("./operations-writes");
    const result = await updateProjectStatus({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      newStatus: "on-hold",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.cascadedItems).toEqual(["Paused Item"]);
    }
  });

  it("does not cascade awaiting-client status", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);

    const { updateProjectStatus } = await import("./operations-writes");
    const result = await updateProjectStatus({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      newStatus: "awaiting-client",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.cascadedItems).toEqual([]);
    }
    expect(mockGetLinkedWeekItems).not.toHaveBeenCalled();
  });

  // v4 §7: cascade fires for ALL L2 categories, not just `deadline`.
  it("cascades completed to L2s regardless of category (review, kickoff, delivery, launch, approval)", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);
    mockGetLinkedWeekItems.mockResolvedValue([
      { id: "wi1", title: "Review", status: null, category: "review" },
      { id: "wi2", title: "Kickoff", status: null, category: "kickoff" },
      { id: "wi3", title: "Delivery", status: "in-progress", category: "delivery" },
      { id: "wi4", title: "Launch", status: null, category: "launch" },
      { id: "wi5", title: "Approval", status: null, category: "approval" },
      { id: "wi6", title: "Deadline", status: null, category: "deadline" },
    ]);

    const { updateProjectStatus } = await import("./operations-writes");
    const result = await updateProjectStatus({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      newStatus: "completed",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.cascadedItems).toEqual([
        "Review", "Kickoff", "Delivery", "Launch", "Approval", "Deadline",
      ]);
    }
  });

  // v4 §8: cascade-generated audit rows carry triggeredByUpdateId FK.
  it("emits per-item cascade audit rows linked to parent via triggeredByUpdateId", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);
    mockGetLinkedWeekItems.mockResolvedValue([
      { id: "wi1", title: "CDS Review", status: null },
      { id: "wi2", title: "CDS Launch", status: "in-progress" },
    ]);

    const { updateProjectStatus } = await import("./operations-writes");
    await updateProjectStatus({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      newStatus: "completed",
      updatedBy: "kathy",
    });

    // First insert = parent status-change (with pre-generated id)
    // Next two = cascade rows referencing the parent
    const calls = mockInsertValues.mock.calls.map((c) => c[0]);
    expect(calls).toHaveLength(3);

    const parent = calls[0];
    expect(parent.updateType).toBe("status-change");
    expect(parent.id).toBeTruthy();

    const cascades = calls.slice(1);
    expect(cascades.every((c) => c.updateType === "cascade-status")).toBe(true);
    expect(cascades.every((c) => c.triggeredByUpdateId === parent.id)).toBe(true);
    expect(cascades.map((c) => c.summary)).toEqual([
      "Cascaded from CDS Messaging status change: CDS Review → completed",
      "Cascaded from CDS Messaging status change: CDS Launch → completed",
    ]);
  });

  it("does not emit cascade audit rows when no items were cascaded", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);
    mockGetLinkedWeekItems.mockResolvedValue([
      { id: "wi1", title: "Done", status: "completed" },
    ]);

    const { updateProjectStatus } = await import("./operations-writes");
    await updateProjectStatus({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      newStatus: "completed",
      updatedBy: "kathy",
    });

    // Only the parent audit row — no cascade children.
    expect(mockInsertValues.mock.calls).toHaveLength(1);
    expect(mockInsertValues.mock.calls[0][0].updateType).toBe("status-change");
  });

  // PR #86: MCP/bot consumers parse cascade outcomes from `data` rather than
  // scraping `message`. `cascadeDetail` carries per-item audit ids so callers
  // can resolve back to the `updates` row without a follow-up query.
  describe("structured response (cascadeDetail + auditId)", () => {
    it("includes cascadeDetail with audit ids for every cascaded item", async () => {
      mockGetClientBySlug.mockResolvedValue(client);
      mockFindProjectByFuzzyName.mockResolvedValue(project);
      mockGetLinkedWeekItems.mockResolvedValue([
        { id: "wi1", title: "CDS Review", status: null },
        { id: "wi2", title: "CDS Delivery", status: "in-progress" },
      ]);

      const { updateProjectStatus } = await import("./operations-writes");
      const result = await updateProjectStatus({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        newStatus: "completed",
        updatedBy: "kathy",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data?.cascadeDetail).toEqual([
        {
          itemId: "wi1",
          itemTitle: "CDS Review",
          field: "status",
          previousValue: null,
          newValue: "completed",
          auditId: expect.any(String),
        },
        {
          itemId: "wi2",
          itemTitle: "CDS Delivery",
          field: "status",
          previousValue: "in-progress",
          newValue: "completed",
          auditId: expect.any(String),
        },
      ]);

      // Back-compat: `cascadedItems` is still the array of titles.
      expect(result.data?.cascadedItems).toEqual(["CDS Review", "CDS Delivery"]);

      // auditId matches the parent `status-change` row id.
      const parentInsert = mockInsertValues.mock.calls[0][0];
      expect(result.data?.auditId).toBe(parentInsert.id);

      // Each cascadeDetail.auditId matches the corresponding child insert.
      const childInserts = mockInsertValues.mock.calls.slice(1).map((c) => c[0]);
      expect(result.data?.cascadeDetail[0].auditId).toBe(childInserts[0].id);
      expect(result.data?.cascadeDetail[1].auditId).toBe(childInserts[1].id);
    });

    it("emits empty cascadeDetail but populated auditId for non-cascade status", async () => {
      mockGetClientBySlug.mockResolvedValue(client);
      mockFindProjectByFuzzyName.mockResolvedValue(project);

      const { updateProjectStatus } = await import("./operations-writes");
      const result = await updateProjectStatus({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        newStatus: "in-production",
        updatedBy: "kathy",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data?.cascadeDetail).toEqual([]);
      expect(result.data?.auditId).toBeTruthy();
      // getLinkedWeekItems should not even run for non-cascade statuses.
      expect(mockGetLinkedWeekItems).not.toHaveBeenCalled();
    });
  });
});
