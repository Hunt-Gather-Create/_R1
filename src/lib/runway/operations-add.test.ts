import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInsertValues = vi.fn();
vi.mock("@/lib/db/runway", () => ({
  getRunwayDb: () => ({ insert: vi.fn(() => ({ values: mockInsertValues })) }),
}));
vi.mock("@/lib/db/runway-schema", () => ({ projects: {}, updates: {} }));

const mockGetClientBySlug = vi.fn();
const mockFindProjectByFuzzyName = vi.fn();
const mockResolveProjectOrFail = vi.fn();
const mockCheckIdempotency = vi.fn();
vi.mock("./operations", () => ({
  generateIdempotencyKey: (...parts: string[]) => parts.join("|"),
  generateId: () => "mock-id-12345678901234",
  getClientOrFail: async (slug: string) => {
    const client = await mockGetClientBySlug(slug);
    if (!client) return { ok: false, error: `Client '${slug}' not found.` };
    return { ok: true, client };
  },
  findProjectByFuzzyName: (...args: unknown[]) => mockFindProjectByFuzzyName(...args),
  resolveProjectOrFail: (...args: unknown[]) => mockResolveProjectOrFail(...args),
  normalizeForMatch: (text: string) =>
    text.replace(/[\u2014\u2013\-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase(),
  checkDuplicate: async (idemKey: string, dupResult: unknown) => {
    if (await mockCheckIdempotency(idemKey)) return dupResult;
    return null;
  },
  insertAuditRecord: async (params: Record<string, unknown>) => {
    mockInsertValues(params);
  },
}));

const client = { id: "c1", name: "Convergix", slug: "convergix" };
const project = { id: "p1", name: "CDS Messaging", status: "in-production" };

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckIdempotency.mockResolvedValue(false);
});

describe("addProject", () => {
  it("inserts project and audit update", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    const { addProject } = await import("./operations-add");
    const result = await addProject({
      clientSlug: "convergix", name: "New Website", owner: "Leslie", updatedBy: "jason",
    });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("New Website");
    expect(result.message).toContain("Convergix");
    expect(mockInsertValues).toHaveBeenCalledTimes(2);
  });

  it("returns error when client not found", async () => {
    mockGetClientBySlug.mockResolvedValue(null);
    const { addProject } = await import("./operations-add");
    const result = await addProject({ clientSlug: "unknown", name: "Test", updatedBy: "jason" });
    expect(result.ok).toBe(false);
  });

  it("skips on duplicate idempotency key", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockCheckIdempotency.mockResolvedValue(true);
    const { addProject } = await import("./operations-add");
    const result = await addProject({
      clientSlug: "convergix", name: "Dup Project", updatedBy: "jason",
    });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("duplicate");
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("uses default status and category when not provided", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    const { addProject } = await import("./operations-add");
    await addProject({ clientSlug: "convergix", name: "Default Project", updatedBy: "jason" });
    const projectInsert = mockInsertValues.mock.calls[0][0];
    expect(projectInsert.status).toBe("not-started");
    expect(projectInsert.category).toBe("active");
  });

  it("sets owner and notes to null when not provided", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    const { addProject } = await import("./operations-add");
    await addProject({ clientSlug: "convergix", name: "Minimal", updatedBy: "jason" });
    const projectInsert = mockInsertValues.mock.calls[0][0];
    expect(projectInsert.owner).toBeNull();
    expect(projectInsert.notes).toBeNull();
  });

  it("returns data with clientName and projectName on success", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    const { addProject } = await import("./operations-add");
    const result = await addProject({
      clientSlug: "convergix", name: "New Thing", updatedBy: "jason",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ clientName: "Convergix", projectName: "New Thing" });
    }
  });

  it("returns error when project with same name already exists under client", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue({ id: "p1", name: "Engagement Videos" });
    const { addProject } = await import("./operations-add");
    const result = await addProject({
      clientSlug: "convergix", name: "Engagement Videos", updatedBy: "jason",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("already exists");
      expect(result.error).toContain("Convergix");
    }
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("detects duplicate when existing name uses em dash", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue({ id: "p1", name: "Impact Report \u2014 Dev" });
    const { addProject } = await import("./operations-add");
    const result = await addProject({
      clientSlug: "convergix", name: "Impact Report Dev", updatedBy: "jason",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("already exists");
    }
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("allows project creation when fuzzy match finds similar but not exact name", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue({ id: "p1", name: "Chester Claws" });
    const { addProject } = await import("./operations-add");
    const result = await addProject({
      clientSlug: "convergix", name: "Chester Claws - Music Videos", updatedBy: "jason",
    });
    expect(result.ok).toBe(true);
  });

  it("logs audit record with correct fields", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    const { addProject } = await import("./operations-add");
    await addProject({
      clientSlug: "convergix", name: "Audit Test", updatedBy: "jason",
    });
    // Second insert is the audit update
    const auditInsert = mockInsertValues.mock.calls[1][0];
    expect(auditInsert.updateType).toBe("new-item");
    expect(auditInsert.newValue).toBe("Audit Test");
    expect(auditInsert.clientId).toBe("c1");
    expect(auditInsert.summary).toContain("Convergix");
    expect(auditInsert.summary).toContain("Audit Test");
  });
});

describe("addUpdate — edge cases", () => {
  it("sets projectId to null when projectName not provided", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    const { addUpdate } = await import("./operations-add");
    await addUpdate({
      clientSlug: "convergix", summary: "General note", updatedBy: "kathy",
    });
    const insertCall = mockInsertValues.mock.calls[0][0];
    expect(insertCall.projectId).toBeNull();
  });

  it("sets projectId to null when project not found by fuzzy name", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockResolveProjectOrFail.mockResolvedValue({
      ok: false, error: "Project 'nonexistent' not found for Convergix.",
      available: ["CDS Messaging"],
    });
    const { addUpdate } = await import("./operations-add");
    const result = await addUpdate({
      clientSlug: "convergix", projectName: "nonexistent", summary: "Note", updatedBy: "kathy",
    });
    expect(result.ok).toBe(true);
    const insertCall = mockInsertValues.mock.calls[0][0];
    expect(insertCall.projectId).toBeNull();
  });

  it("returns undefined projectName in data when project not matched", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockResolveProjectOrFail.mockResolvedValue({
      ok: false, error: "Project 'nonexistent' not found for Convergix.",
    });
    const { addUpdate } = await import("./operations-add");
    const result = await addUpdate({
      clientSlug: "convergix", projectName: "nonexistent", summary: "Note", updatedBy: "kathy",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.projectName).toBeUndefined();
    }
  });

  it("returns disambiguation error when multiple projects match", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockResolveProjectOrFail.mockResolvedValue({
      ok: false,
      error: "Multiple projects match 'Impact Report': Impact Report Dev, Impact Report Design. Which one?",
      available: ["Impact Report Dev", "Impact Report Design"],
    });
    const { addUpdate } = await import("./operations-add");
    const result = await addUpdate({
      clientSlug: "convergix", projectName: "Impact Report", summary: "Note", updatedBy: "kathy",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Multiple projects match");
      expect(result.error).toContain("Impact Report Dev");
      expect(result.error).toContain("Impact Report Design");
      expect(result.available).toEqual(["Impact Report Dev", "Impact Report Design"]);
    }
  });
});

describe("addUpdate", () => {
  it("inserts an update note", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    const { addUpdate } = await import("./operations-add");
    const result = await addUpdate({
      clientSlug: "convergix", summary: "Client approved messaging doc", updatedBy: "kathy",
    });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Convergix");
    expect(mockInsertValues).toHaveBeenCalled();
  });

  it("resolves project name when provided", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockResolveProjectOrFail.mockResolvedValue({ ok: true, project });
    const { addUpdate } = await import("./operations-add");
    const result = await addUpdate({
      clientSlug: "convergix", projectName: "CDS", summary: "Feedback received", updatedBy: "kathy",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data?.projectName).toBe("CDS Messaging");
  });

  it("returns error when client not found", async () => {
    mockGetClientBySlug.mockResolvedValue(null);
    const { addUpdate } = await import("./operations-add");
    const result = await addUpdate({ clientSlug: "unknown", summary: "Test note", updatedBy: "jason" });
    expect(result.ok).toBe(false);
  });

  it("skips on duplicate idempotency key", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockCheckIdempotency.mockResolvedValue(true);
    const { addUpdate } = await import("./operations-add");
    const result = await addUpdate({
      clientSlug: "convergix", summary: "Dup note", updatedBy: "kathy",
    });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("duplicate");
    expect(mockInsertValues).not.toHaveBeenCalled();
  });
});
