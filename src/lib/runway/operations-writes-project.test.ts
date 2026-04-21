import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb } from "./operations-writes-test-helpers";

// ── Mock state ──────────────────────────────────────────
const { db: mockDb, mockInsertValues, mockUpdateSet, mockTx } = createMockDb();

vi.mock("@/lib/db/runway", () => ({
  getRunwayDb: () => mockDb,
}));

vi.mock("@/lib/db/runway-schema", () => ({
  projects: { id: "id" },
  weekItems: { id: "id" },
  updates: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
}));

const mockGetClientBySlug = vi.fn();
const mockFindProjectByFuzzyName = vi.fn();
const mockGetProjectsForClient = vi.fn();
const mockCheckIdempotency = vi.fn();

let _idCounter = 0;
vi.mock("./operations-utils", () => ({
  PROJECT_FIELDS: [
    "name", "dueDate", "owner", "resources", "waitingOn", "notes", "category",
    "engagementType", "contractStart", "contractEnd",
  ],
  PROJECT_FIELD_TO_COLUMN: {
    name: "name", dueDate: "dueDate", owner: "owner", resources: "resources",
    waitingOn: "waitingOn", notes: "notes", category: "category",
    engagementType: "engagementType", contractStart: "contractStart", contractEnd: "contractEnd",
  },
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
      return { ok: false, error: `Project '${projectName}' not found for ${_clientName}.`, available: available?.map((p: { name: string }) => p.name) };
    }
    return { ok: true, project: result };
  },
  checkDuplicate: async (idemKey: string, dupResult: unknown) => {
    if (await mockCheckIdempotency(idemKey)) return dupResult;
    return null;
  },
  insertAuditRecord: async (params: Record<string, unknown>) => {
    const id = (params.id as string | undefined) ?? `mock-id-${++_idCounter}`;
    mockInsertValues({ ...params, id });
    return id;
  },
  getPreviousValue: (entity: Record<string, unknown>, columnKey: string) => String(entity[columnKey] ?? ""),
  validateAndResolveField: (field: string, allowed: readonly string[], fieldToColumn: Record<string, string>) => {
    if (!allowed.includes(field)) {
      return { ok: false, error: `Invalid field '${field}'. Allowed fields: ${allowed.join(", ")}` };
    }
    return { ok: true, typedField: field, columnKey: fieldToColumn[field] };
  },
  // v4 (Chunk 5): identity passthrough — real normalization asserted
  // separately in operations-utils.test.ts.
  normalizeResourcesString: (raw: string | null | undefined) => raw ?? "",
}));

const mockGetLinkedDeadlineItems = vi.fn();

vi.mock("./operations-reads-week", () => ({
  getLinkedDeadlineItems: (...args: unknown[]) => mockGetLinkedDeadlineItems(...args),
}));

const client = { id: "c1", name: "Convergix", slug: "convergix" };
const project = {
  id: "p1",
  name: "CDS Messaging",
  status: "in-production",
  category: "active",
  dueDate: "2026-04-15",
  owner: "Kathy",
  resources: "Roz",
  waitingOn: null,
  notes: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  _idCounter = 0;
  mockCheckIdempotency.mockResolvedValue(false);
  mockGetLinkedDeadlineItems.mockResolvedValue([]);
});

describe("updateProjectField", () => {
  it("updates dueDate field and inserts audit record", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);

    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "dueDate",
      newValue: "2026-04-25",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({
        clientName: "Convergix",
        projectName: "CDS Messaging",
        field: "dueDate",
        previousValue: "2026-04-15",
        newValue: "2026-04-25",
        cascadedItems: [],
        // PR #86: structured per-item trace (empty — no linked deadline items in this test).
        cascadeDetail: [],
        auditId: expect.any(String),
      });
    }
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ dueDate: "2026-04-25" })
    );
    expect(mockInsertValues).toHaveBeenCalled();
  });

  it("updates owner field", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);

    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "owner",
      newValue: "Lane",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "Lane" })
    );
  });

  it("updates name field", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);

    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "name",
      newValue: "CDS Engagement Videos",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ name: "CDS Engagement Videos" })
    );
  });

  it("updates category field and captures previous value in audit record", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);

    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "category",
      newValue: "awaiting-client",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({
        clientName: "Convergix",
        projectName: "CDS Messaging",
        field: "category",
        previousValue: "active",
        newValue: "awaiting-client",
        cascadedItems: [],
        cascadeDetail: [],
        auditId: expect.any(String),
      });
    }
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ category: "awaiting-client" })
    );
    // Audit record captures the category change
    const insertCall = mockInsertValues.mock.calls[0][0];
    expect(insertCall.updateType).toBe("field-change");
    expect(insertCall.previousValue).toBe("active");
    expect(insertCall.newValue).toBe("awaiting-client");
    expect(insertCall.metadata).toBe(JSON.stringify({ field: "category" }));
  });

  it("returns error when client not found", async () => {
    mockGetClientBySlug.mockResolvedValue(null);

    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "unknown",
      projectName: "Test",
      field: "dueDate",
      newValue: "2026-05-01",
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

    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "Nonexistent",
      field: "owner",
      newValue: "Lane",
      updatedBy: "jason",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.available).toEqual(["CDS Messaging", "Website"]);
    }
  });

  it("returns success without writing on duplicate request", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);
    mockCheckIdempotency.mockResolvedValue(true);

    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "dueDate",
      newValue: "2026-04-25",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toContain("duplicate");
      expect(result.data).toBeDefined();
    }
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });

  it("rejects invalid field name", async () => {
    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS",
      field: "invalid_field",
      newValue: "foo",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("invalid_field");
      expect(result.error).toContain("Allowed fields");
    }
  });

  it("captures previous value in audit record", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);

    const { updateProjectField } = await import("./operations-writes-project");
    await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "owner",
      newValue: "Lane",
      updatedBy: "kathy",
    });

    const insertCall = mockInsertValues.mock.calls[0][0];
    expect(insertCall.updateType).toBe("field-change");
    expect(insertCall.previousValue).toBe("Kathy");
    expect(insertCall.newValue).toBe("Lane");
  });

  it("includes metadata with field name in audit record", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);

    const { updateProjectField } = await import("./operations-writes-project");
    await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "dueDate",
      newValue: "2026-04-25",
      updatedBy: "kathy",
    });

    const insertCall = mockInsertValues.mock.calls[0][0];
    expect(insertCall.metadata).toBe(JSON.stringify({ field: "dueDate" }));
  });

  it("cascades dueDate to linked deadline week items", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);
    mockGetLinkedDeadlineItems.mockResolvedValue([
      { id: "wi-1", title: "Code handoff", category: "deadline" },
      { id: "wi-2", title: "Go live", category: "deadline" },
    ]);

    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "dueDate",
      newValue: "2026-04-28",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.cascadedItems).toEqual(["Code handoff", "Go live"]);
    }
    // project update + 2 week item updates = 3 calls to mockUpdateSet
    expect(mockUpdateSet).toHaveBeenCalledTimes(3);
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ date: "2026-04-28" })
    );
  });

  it("does not cascade non-dueDate field changes", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);

    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "owner",
      newValue: "Lane",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    expect(mockGetLinkedDeadlineItems).not.toHaveBeenCalled();
    if (result.ok) {
      expect(result.data?.cascadedItems).toEqual([]);
    }
  });

  it("handles no linked deadline items gracefully", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);
    mockGetLinkedDeadlineItems.mockResolvedValue([]);

    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "dueDate",
      newValue: "2026-04-28",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.cascadedItems).toEqual([]);
    }
    // Only the project update itself
    expect(mockUpdateSet).toHaveBeenCalledTimes(1);
  });

  // v4 §8: cascade-generated audit rows carry triggeredByUpdateId FK.
  it("emits per-item cascade audit rows linked to parent via triggeredByUpdateId", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);
    mockGetLinkedDeadlineItems.mockResolvedValue([
      { id: "wi-1", title: "Code handoff", category: "deadline" },
      { id: "wi-2", title: "Go live", category: "deadline" },
    ]);

    const { updateProjectField } = await import("./operations-writes-project");
    await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "dueDate",
      newValue: "2026-04-28",
      updatedBy: "kathy",
    });

    const calls = mockInsertValues.mock.calls.map((c) => c[0]);
    expect(calls).toHaveLength(3);

    const parent = calls[0];
    expect(parent.updateType).toBe("field-change");
    expect(parent.id).toBeTruthy();
    expect(parent.triggeredByUpdateId).toBeFalsy();

    const cascades = calls.slice(1);
    expect(cascades.every((c) => c.updateType === "cascade-duedate")).toBe(true);
    expect(cascades.every((c) => c.triggeredByUpdateId === parent.id)).toBe(true);
    expect(cascades.map((c) => c.summary)).toEqual([
      "Cascaded from CDS Messaging dueDate change: Code handoff → 2026-04-28",
      "Cascaded from CDS Messaging dueDate change: Go live → 2026-04-28",
    ]);
  });

  it("does not emit cascade audit rows when no linked deadline items", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);
    mockGetLinkedDeadlineItems.mockResolvedValue([]);

    const { updateProjectField } = await import("./operations-writes-project");
    await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "dueDate",
      newValue: "2026-04-28",
      updatedBy: "kathy",
    });

    expect(mockInsertValues.mock.calls).toHaveLength(1);
    expect(mockInsertValues.mock.calls[0][0].updateType).toBe("field-change");
  });

  // PR #86: MCP/bot consumers parse cascade outcomes from `data.cascadeDetail`
  // rather than the prose `message` string.
  describe("structured response (cascadeDetail + auditId)", () => {
    it("returns cascadeDetail with each linked deadline item's audit id", async () => {
      mockGetClientBySlug.mockResolvedValue(client);
      mockFindProjectByFuzzyName.mockResolvedValue(project);
      mockGetLinkedDeadlineItems.mockResolvedValue([
        { id: "wi-1", title: "Code handoff", category: "deadline", date: "2026-04-15" },
        { id: "wi-2", title: "Go live", category: "deadline", date: null },
      ]);

      const { updateProjectField } = await import("./operations-writes-project");
      const result = await updateProjectField({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        field: "dueDate",
        newValue: "2026-04-28",
        updatedBy: "kathy",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data?.cascadeDetail).toEqual([
        {
          itemId: "wi-1",
          itemTitle: "Code handoff",
          field: "date",
          previousValue: "2026-04-15",
          newValue: "2026-04-28",
          auditId: expect.any(String),
        },
        {
          itemId: "wi-2",
          itemTitle: "Go live",
          field: "date",
          previousValue: null,
          newValue: "2026-04-28",
          auditId: expect.any(String),
        },
      ]);

      // Back-compat: `cascadedItems` is still the title array.
      expect(result.data?.cascadedItems).toEqual(["Code handoff", "Go live"]);

      // cascadeDetail.auditId values match the child audit inserts.
      const calls = mockInsertValues.mock.calls.map((c) => c[0]);
      expect(result.data?.auditId).toBe(calls[0].id);
      expect(result.data?.cascadeDetail[0].auditId).toBe(calls[1].id);
      expect(result.data?.cascadeDetail[1].auditId).toBe(calls[2].id);
    });

    it("returns empty cascadeDetail for non-dueDate field changes", async () => {
      mockGetClientBySlug.mockResolvedValue(client);
      mockFindProjectByFuzzyName.mockResolvedValue(project);

      const { updateProjectField } = await import("./operations-writes-project");
      const result = await updateProjectField({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        field: "owner",
        newValue: "Lane",
        updatedBy: "kathy",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data?.cascadeDetail).toEqual([]);
      expect(result.data?.auditId).toBeTruthy();
      expect(mockGetLinkedDeadlineItems).not.toHaveBeenCalled();
    });
  });

  // Null newValue support: retainer/v4 cleanup migrations clear fields like
  // contractEnd, waitingOn, target. The helper accepts newValue: null as a
  // first-class write — storing SQL NULL and audit-logging "(null)".
  describe("null newValue writes", () => {
    it("writes SQL NULL when newValue is null", async () => {
      mockGetClientBySlug.mockResolvedValue(client);
      mockFindProjectByFuzzyName.mockResolvedValue({
        ...project,
        contractEnd: "2026-05-31",
      });

      const { updateProjectField } = await import("./operations-writes-project");
      const result = await updateProjectField({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        field: "contractEnd",
        newValue: null,
        updatedBy: "migration",
      });

      expect(result.ok).toBe(true);
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ contractEnd: null })
      );
    });

    it("audit row newValue is null for null writes", async () => {
      mockGetClientBySlug.mockResolvedValue(client);
      mockFindProjectByFuzzyName.mockResolvedValue(project);

      const { updateProjectField } = await import("./operations-writes-project");
      await updateProjectField({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        field: "waitingOn",
        newValue: null,
        updatedBy: "migration",
      });

      const insertCall = mockInsertValues.mock.calls[0][0];
      expect(insertCall.newValue).toBe(null);
      expect(insertCall.summary).toContain('"(null)"');
    });

    it("idempotency key uses (null) marker so null writes collapse on re-run", async () => {
      mockGetClientBySlug.mockResolvedValue(client);
      mockFindProjectByFuzzyName.mockResolvedValue(project);

      const { updateProjectField } = await import("./operations-writes-project");
      await updateProjectField({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        field: "waitingOn",
        newValue: null,
        updatedBy: "migration",
      });

      // Mocked generateIdempotencyKey joins parts with "|" — the idemKey must
      // contain the "(null)" marker rather than the literal string "null".
      const auditCall = mockInsertValues.mock.calls[0][0];
      expect(auditCall.idempotencyKey).toContain("|(null)|");
    });

    it("repeat null write returns duplicate result without re-writing", async () => {
      mockGetClientBySlug.mockResolvedValue(client);
      mockFindProjectByFuzzyName.mockResolvedValue(project);
      mockCheckIdempotency.mockResolvedValue(true);

      const { updateProjectField } = await import("./operations-writes-project");
      const result = await updateProjectField({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        field: "waitingOn",
        newValue: null,
        updatedBy: "migration",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.message).toContain("duplicate");
        expect(result.data?.newValue).toBe(null);
      }
      expect(mockUpdateSet).not.toHaveBeenCalled();
    });

    it("clearing resources with null skips normalizer and stores null", async () => {
      mockGetClientBySlug.mockResolvedValue(client);
      mockFindProjectByFuzzyName.mockResolvedValue(project);

      const { updateProjectField } = await import("./operations-writes-project");
      const result = await updateProjectField({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        field: "resources",
        newValue: null,
        updatedBy: "migration",
      });

      expect(result.ok).toBe(true);
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ resources: null })
      );
      if (result.ok) expect(result.data?.newValue).toBe(null);
    });
  });
});

describe("deleteProject", () => {
  it("deletes project and audits", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);

    const { deleteProject } = await import("./operations-writes-project");
    const result = await deleteProject({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toContain("CDS Messaging");
      expect(result.data).toEqual({ clientName: "Convergix", projectName: "CDS Messaging" });
    }
    // Audit record
    const auditCall = mockInsertValues.mock.calls[0][0];
    expect(auditCall.updateType).toBe("delete-project");
    expect(auditCall.previousValue).toBe("CDS Messaging");
  });

  it("returns error for unknown client", async () => {
    mockGetClientBySlug.mockResolvedValue(null);

    const { deleteProject } = await import("./operations-writes-project");
    const result = await deleteProject({
      clientSlug: "unknown",
      projectName: "Test",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(false);
  });

  it("returns error for unknown project", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(null);
    mockGetProjectsForClient.mockResolvedValue([{ name: "CDS Messaging" }]);

    const { deleteProject } = await import("./operations-writes-project");
    const result = await deleteProject({
      clientSlug: "convergix",
      projectName: "Nonexistent",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.available).toEqual(["CDS Messaging"]);
  });

  it("handles duplicate request", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);
    mockCheckIdempotency.mockResolvedValue(true);

    const { deleteProject } = await import("./operations-writes-project");
    const result = await deleteProject({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message).toContain("duplicate");
  });

  it("nulls out projectId on audit records before deleting project", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);

    const { deleteProject } = await import("./operations-writes-project");
    const result = await deleteProject({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);

    // Transaction should have 3 calls: unlink week items, null audit projectIds, delete project
    expect(mockTx.update).toHaveBeenCalledTimes(2);
    expect(mockTx.delete).toHaveBeenCalledTimes(1);

    // Second tx.update call should null out projectId on audit records
    const secondUpdateSetCall = mockUpdateSet.mock.calls.find(
      (call: unknown[]) => call[0] && typeof call[0] === "object" && "projectId" in (call[0] as Record<string, unknown>) && !("updatedAt" in (call[0] as Record<string, unknown>))
    );
    expect(secondUpdateSetCall).toBeDefined();
    expect(secondUpdateSetCall![0]).toEqual({ projectId: null });
  });
});
