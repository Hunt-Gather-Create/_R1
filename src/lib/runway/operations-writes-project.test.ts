import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock state ──────────────────────────────────────────
const mockInsertValues = vi.fn();
const mockUpdateSet = vi.fn();
const mockUpdateWhere = vi.fn();

vi.mock("@/lib/db/runway", () => ({
  getRunwayDb: () => ({
    insert: vi.fn(() => ({ values: mockInsertValues })),
    update: vi.fn(() => ({
      set: vi.fn((...args: unknown[]) => {
        mockUpdateSet(...args);
        return { where: mockUpdateWhere };
      }),
    })),
  }),
}));

vi.mock("@/lib/db/runway-schema", () => ({
  projects: { id: "id" },
  updates: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
}));

const mockGetClientBySlug = vi.fn();
const mockFindProjectByFuzzyName = vi.fn();
const mockGetProjectsForClient = vi.fn();
const mockCheckIdempotency = vi.fn();

vi.mock("./operations-utils", () => ({
  PROJECT_FIELDS: ["name", "dueDate", "owner", "resources", "waitingOn", "target", "notes"],
  PROJECT_FIELD_TO_COLUMN: {
    name: "name", dueDate: "dueDate", owner: "owner", resources: "resources",
    waitingOn: "waitingOn", target: "target", notes: "notes",
  },
  generateIdempotencyKey: (...parts: string[]) => parts.join("|"),
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
    mockInsertValues(params);
  },
  validateField: (field: string, allowed: readonly string[]) => {
    if (!allowed.includes(field)) {
      return { ok: false, error: `Invalid field '${field}'. Allowed fields: ${allowed.join(", ")}` };
    }
    return null;
  },
}));

const client = { id: "c1", name: "Convergix", slug: "convergix" };
const project = {
  id: "p1",
  name: "CDS Messaging",
  status: "in-production",
  dueDate: "2026-04-15",
  owner: "Kathy",
  resources: "Roz",
  waitingOn: null,
  target: null,
  notes: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckIdempotency.mockResolvedValue(false);
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
});
