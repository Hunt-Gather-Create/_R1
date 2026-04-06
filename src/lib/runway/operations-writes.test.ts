import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock state ───────────────��──────────────────────────
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

// Mock operations (reads) that writes depend on
const mockGetClientBySlug = vi.fn();
const mockFindProjectByFuzzyName = vi.fn();
const mockGetProjectsForClient = vi.fn();
const mockCheckIdempotency = vi.fn();

vi.mock("./operations", () => ({
  generateIdempotencyKey: (...parts: string[]) => parts.join("|"),
  generateId: () => "mock-id-12345678901234",
  getClientBySlug: (...args: unknown[]) => mockGetClientBySlug(...args),
  findProjectByFuzzyName: (...args: unknown[]) =>
    mockFindProjectByFuzzyName(...args),
  getProjectsForClient: (...args: unknown[]) =>
    mockGetProjectsForClient(...args),
  checkIdempotency: (...args: unknown[]) => mockCheckIdempotency(...args),
  clientNotFoundError: (slug: string) => ({ ok: false, error: `Client '${slug}' not found.` }),
}));

const client = { id: "c1", name: "Convergix", slug: "convergix" };
const project = { id: "p1", name: "CDS Messaging", status: "in-production" };

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckIdempotency.mockResolvedValue(false);
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
});
