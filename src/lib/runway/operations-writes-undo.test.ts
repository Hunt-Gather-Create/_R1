import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInsertValues = vi.fn();
const mockUpdateSet = vi.fn();
const mockUpdateWhere = vi.fn();
const mockSelectFrom = vi.fn();
const mockSelectWhere = vi.fn();
const mockSelectOrderBy = vi.fn();

vi.mock("@/lib/db/runway", () => ({
  getRunwayDb: () => ({
    insert: vi.fn(() => ({ values: mockInsertValues })),
    update: vi.fn(() => ({
      set: vi.fn((...args: unknown[]) => {
        mockUpdateSet(...args);
        return { where: mockUpdateWhere };
      }),
    })),
    select: vi.fn(() => ({
      from: vi.fn((...args: unknown[]) => {
        mockSelectFrom(...args);
        return {
          where: vi.fn((...wArgs: unknown[]) => {
            mockSelectWhere(...wArgs);
            return {
              orderBy: vi.fn((...oArgs: unknown[]) => {
                return {
                  limit: vi.fn(() => mockSelectOrderBy(...oArgs)),
                };
              }),
            };
          }),
        };
      }),
    })),
  }),
}));

vi.mock("@/lib/db/runway-schema", () => ({
  projects: { id: "id" },
  updates: { updatedBy: "updated_by", createdAt: "created_at", metadata: "metadata" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
  desc: vi.fn((a) => ({ desc: a })),
}));

const mockCheckIdempotency = vi.fn();

vi.mock("./operations-utils", () => ({
  UNDO_FIELDS: ["name", "dueDate", "owner", "resources", "waitingOn", "target", "notes", "status", "category"],
  generateIdempotencyKey: (...parts: string[]) => parts.join("|"),
  checkIdempotency: (...args: unknown[]) => mockCheckIdempotency(...args),
  insertAuditRecord: async (params: Record<string, unknown>) => {
    mockInsertValues(params);
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckIdempotency.mockResolvedValue(false);
});

describe("undoLastChange", () => {
  it("reverts a status change", async () => {
    mockSelectOrderBy.mockResolvedValue([
      {
        id: "u1",
        updateType: "status-change",
        projectId: "p1",
        clientId: "c1",
        previousValue: "in-production",
        newValue: "completed",
        summary: "Convergix / CDS: in-production -> completed",
        updatedBy: "kathy",
      },
    ]);

    const { undoLastChange } = await import("./operations-writes-undo");
    const result = await undoLastChange({ updatedBy: "kathy" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toContain("reverted status");
      expect(result.message).toContain("in-production");
      expect(result.data?.revertedFrom).toBe("completed");
      expect(result.data?.revertedTo).toBe("in-production");
    }
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "in-production" })
    );
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ updateType: "undo" })
    );
  });

  it("reverts a field change using metadata", async () => {
    mockSelectOrderBy.mockResolvedValue([
      {
        id: "u2",
        updateType: "field-change",
        projectId: "p1",
        clientId: "c1",
        previousValue: "2026-04-15",
        newValue: "2026-04-25",
        metadata: JSON.stringify({ field: "dueDate" }),
        summary: 'Convergix / CDS: dueDate changed from "2026-04-15" to "2026-04-25"',
        updatedBy: "kathy",
      },
    ]);

    const { undoLastChange } = await import("./operations-writes-undo");
    const result = await undoLastChange({ updatedBy: "kathy" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toContain("reverted field");
      expect(result.message).toContain("2026-04-15");
    }
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ dueDate: "2026-04-15" })
    );
  });

  it("falls back to regex when metadata is null (pre-migration records)", async () => {
    mockSelectOrderBy.mockResolvedValue([
      {
        id: "u2b",
        updateType: "field-change",
        projectId: "p1",
        clientId: "c1",
        previousValue: "2026-04-15",
        newValue: "2026-04-25",
        metadata: null,
        summary: 'Convergix / CDS: dueDate changed from "2026-04-15" to "2026-04-25"',
        updatedBy: "kathy",
      },
    ]);

    const { undoLastChange } = await import("./operations-writes-undo");
    const result = await undoLastChange({ updatedBy: "kathy" });

    expect(result.ok).toBe(true);
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ dueDate: "2026-04-15" })
    );
  });

  it("falls back to regex when metadata is invalid JSON", async () => {
    mockSelectOrderBy.mockResolvedValue([
      {
        id: "u2c",
        updateType: "field-change",
        projectId: "p1",
        clientId: "c1",
        previousValue: "Kathy",
        newValue: "Lane",
        metadata: "not-valid-json",
        summary: 'Convergix / CDS: owner changed from "Kathy" to "Lane"',
        updatedBy: "kathy",
      },
    ]);

    const { undoLastChange } = await import("./operations-writes-undo");
    const result = await undoLastChange({ updatedBy: "kathy" });

    expect(result.ok).toBe(true);
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "Kathy" })
    );
  });

  it("returns error when no recent change exists", async () => {
    mockSelectOrderBy.mockResolvedValue([]);

    const { undoLastChange } = await import("./operations-writes-undo");
    const result = await undoLastChange({ updatedBy: "kathy" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("No recent change");
    }
  });

  it("skips non-undoable types (notes)", async () => {
    mockSelectOrderBy.mockResolvedValue([
      {
        id: "u3",
        updateType: "note",
        projectId: "p1",
        clientId: "c1",
        previousValue: null,
        newValue: null,
        summary: "Just a note",
        updatedBy: "kathy",
      },
    ]);

    const { undoLastChange } = await import("./operations-writes-undo");
    const result = await undoLastChange({ updatedBy: "kathy" });

    expect(result.ok).toBe(false);
  });

  it("returns no recent change when only non-undoable records exist", async () => {
    mockSelectOrderBy.mockResolvedValue([
      {
        id: "n1",
        updateType: "note",
        projectId: "p1",
        clientId: "c1",
        previousValue: null,
        newValue: null,
        summary: "Just a note",
        updatedBy: "kathy",
      },
      {
        id: "n2",
        updateType: "new-item",
        projectId: "p2",
        clientId: "c1",
        previousValue: null,
        newValue: "New Project",
        summary: "New project added",
        updatedBy: "kathy",
      },
    ]);

    const { undoLastChange } = await import("./operations-writes-undo");
    const result = await undoLastChange({ updatedBy: "kathy" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("No recent change");
    }
  });

  it("returns error when field-change summary is malformed", async () => {
    mockSelectOrderBy.mockResolvedValue([
      {
        id: "u3",
        updateType: "field-change",
        projectId: "p1",
        clientId: "c1",
        previousValue: "old value",
        newValue: "new value",
        summary: "Malformed summary with no field pattern",
        updatedBy: "kathy",
      },
    ]);

    const { undoLastChange } = await import("./operations-writes-undo");
    const result = await undoLastChange({ updatedBy: "kathy" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("unable to determine which field");
    }
  });

  it("returns error when field name in metadata is not recognized", async () => {
    mockSelectOrderBy.mockResolvedValue([
      {
        id: "u-bogus",
        updateType: "field-change",
        projectId: "p1",
        clientId: "c1",
        previousValue: "old",
        newValue: "new",
        metadata: JSON.stringify({ field: "maliciousField" }),
        summary: "test",
        updatedBy: "kathy",
      },
    ]);

    const { undoLastChange } = await import("./operations-writes-undo");
    const result = await undoLastChange({ updatedBy: "kathy" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("maliciousField");
      expect(result.error).toContain("not a recognized");
    }
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });

  it("reverts status to not-started when previousValue was null", async () => {
    mockSelectOrderBy.mockResolvedValue([
      {
        id: "u4",
        updateType: "status-change",
        projectId: "p1",
        clientId: "c1",
        previousValue: null,
        newValue: "completed",
        summary: "test",
        updatedBy: "kathy",
      },
    ]);

    const { undoLastChange } = await import("./operations-writes-undo");
    const result = await undoLastChange({ updatedBy: "kathy" });

    expect(result.ok).toBe(true);
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "not-started" })
    );
  });

  it("reverts field to null when previousValue was empty string", async () => {
    mockSelectOrderBy.mockResolvedValue([
      {
        id: "u5",
        updateType: "field-change",
        projectId: "p1",
        clientId: "c1",
        previousValue: "",
        newValue: "2026-05-01",
        metadata: JSON.stringify({ field: "dueDate" }),
        summary: "test",
        updatedBy: "kathy",
      },
    ]);

    const { undoLastChange } = await import("./operations-writes-undo");
    const result = await undoLastChange({ updatedBy: "kathy" });

    expect(result.ok).toBe(true);
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ dueDate: null })
    );
  });

  it("reverts field to null when previousValue was null", async () => {
    mockSelectOrderBy.mockResolvedValue([
      {
        id: "u6",
        updateType: "field-change",
        projectId: "p1",
        clientId: "c1",
        previousValue: null,
        newValue: "Lane",
        metadata: JSON.stringify({ field: "owner" }),
        summary: "test",
        updatedBy: "kathy",
      },
    ]);

    const { undoLastChange } = await import("./operations-writes-undo");
    const result = await undoLastChange({ updatedBy: "kathy" });

    expect(result.ok).toBe(true);
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ owner: null })
    );
  });

  it("returns error when projectId is missing", async () => {
    mockSelectOrderBy.mockResolvedValue([
      {
        id: "u7",
        updateType: "status-change",
        projectId: null,
        clientId: "c1",
        previousValue: "active",
        newValue: "completed",
        summary: "test",
        updatedBy: "kathy",
      },
    ]);

    const { undoLastChange } = await import("./operations-writes-undo");
    const result = await undoLastChange({ updatedBy: "kathy" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("missing project reference");
    }
  });

  it("sequential undo reverts second-most-recent when first is already undone", async () => {
    mockSelectOrderBy.mockResolvedValue([
      {
        id: "u2",
        updateType: "field-change",
        projectId: "p1",
        clientId: "c1",
        previousValue: "2026-04-15",
        newValue: "2026-04-25",
        metadata: JSON.stringify({ field: "dueDate" }),
        summary: "test",
        updatedBy: "kathy",
      },
      {
        id: "u1",
        updateType: "status-change",
        projectId: "p1",
        clientId: "c1",
        previousValue: "active",
        newValue: "in-production",
        summary: "test",
        updatedBy: "kathy",
      },
    ]);
    // u2 already undone, u1 not
    mockCheckIdempotency.mockImplementation(async (key: string) => {
      return key === "undo|u2|kathy";
    });

    const { undoLastChange } = await import("./operations-writes-undo");
    const result = await undoLastChange({ updatedBy: "kathy" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.revertedTo).toBe("active");
    }
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "active" })
    );
  });

  it("returns no recent change when all undoable records are already undone", async () => {
    mockSelectOrderBy.mockResolvedValue([
      {
        id: "u1",
        updateType: "status-change",
        projectId: "p1",
        clientId: "c1",
        previousValue: "active",
        newValue: "completed",
        summary: "test",
        updatedBy: "kathy",
      },
    ]);
    // u1 already undone
    mockCheckIdempotency.mockResolvedValue(true);

    const { undoLastChange } = await import("./operations-writes-undo");
    const result = await undoLastChange({ updatedBy: "kathy" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("No recent change");
    }
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });

  it("undoes changes in reverse chronological order (B first, then A)", async () => {
    // Records returned in DESC order: B (newest) first, then A
    const records = [
      {
        id: "uB",
        updateType: "field-change",
        projectId: "p1",
        clientId: "c1",
        previousValue: "Kathy",
        newValue: "Lane",
        metadata: JSON.stringify({ field: "owner" }),
        summary: "B",
        updatedBy: "kathy",
      },
      {
        id: "uA",
        updateType: "status-change",
        projectId: "p1",
        clientId: "c1",
        previousValue: "active",
        newValue: "in-production",
        summary: "A",
        updatedBy: "kathy",
      },
    ];

    // First undo: nothing undone yet — should pick B (newest)
    mockSelectOrderBy.mockResolvedValue(records);
    mockCheckIdempotency.mockResolvedValue(false);

    const { undoLastChange } = await import("./operations-writes-undo");
    const result1 = await undoLastChange({ updatedBy: "kathy" });

    expect(result1.ok).toBe(true);
    if (result1.ok) {
      expect(result1.data?.revertedFrom).toBe("Lane");
      expect(result1.data?.revertedTo).toBe("Kathy");
    }

    // Second undo: B is now undone — should pick A
    vi.clearAllMocks();
    mockSelectOrderBy.mockResolvedValue(records);
    mockCheckIdempotency.mockImplementation(async (key: string) => {
      return key === "undo|uB|kathy";
    });

    const result2 = await undoLastChange({ updatedBy: "kathy" });

    expect(result2.ok).toBe(true);
    if (result2.ok) {
      expect(result2.data?.revertedFrom).toBe("in-production");
      expect(result2.data?.revertedTo).toBe("active");
    }

    // Third undo: both undone — no recent change
    vi.clearAllMocks();
    mockSelectOrderBy.mockResolvedValue(records);
    mockCheckIdempotency.mockResolvedValue(true);

    const result3 = await undoLastChange({ updatedBy: "kathy" });

    expect(result3.ok).toBe(false);
    if (!result3.ok) {
      expect(result3.error).toContain("No recent change");
    }
  });
});
