import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInsertValues = vi.fn();
vi.mock("@/lib/db/runway", () => ({
  getRunwayDb: () => ({ insert: vi.fn(() => ({ values: mockInsertValues })) }),
}));
vi.mock("@/lib/db/runway-schema", () => ({ projects: {}, updates: {} }));

const mockGetClientBySlug = vi.fn();
const mockFindProjectByFuzzyName = vi.fn();
const mockCheckIdempotency = vi.fn();
vi.mock("./operations", () => ({
  generateIdempotencyKey: (...parts: string[]) => parts.join("|"),
  generateId: () => "mock-id-12345678901234",
  getClientBySlug: (...args: unknown[]) => mockGetClientBySlug(...args),
  findProjectByFuzzyName: (...args: unknown[]) => mockFindProjectByFuzzyName(...args),
  checkIdempotency: (...args: unknown[]) => mockCheckIdempotency(...args),
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
    mockFindProjectByFuzzyName.mockResolvedValue(project);
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
