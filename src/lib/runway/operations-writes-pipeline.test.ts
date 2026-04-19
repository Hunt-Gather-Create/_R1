import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb } from "./operations-writes-test-helpers";

// ── Mock state ──────────────────────────────────────────
const { db: mockDb, mockInsertValues, mockUpdateSet, mockDeleteWhere, mockDeleteFn } = createMockDb();

vi.mock("@/lib/db/runway", () => ({
  getRunwayDb: () => mockDb,
}));

vi.mock("@/lib/db/runway-schema", () => ({
  pipelineItems: { id: "id", clientId: "clientId" },
  updates: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
}));

const mockGetClientBySlug = vi.fn();
const mockResolvePipelineItem = vi.fn();
const mockCheckIdempotency = vi.fn();

vi.mock("./operations-utils", () => ({
  PIPELINE_ITEM_FIELDS: ["name", "owner", "status", "estimatedValue", "waitingOn", "notes"],
  PIPELINE_ITEM_FIELD_TO_COLUMN: {
    name: "name", owner: "owner", status: "status",
    estimatedValue: "estimatedValue", waitingOn: "waitingOn", notes: "notes",
  },
  generateIdempotencyKey: (...parts: string[]) => parts.join("|"),
  generateId: () => "test-id-123",
  getClientOrFail: async (slug: string) => {
    const client = await mockGetClientBySlug(slug);
    if (!client) return { ok: false, error: `Client '${slug}' not found.` };
    return { ok: true, client };
  },
  resolvePipelineItemOrFail: async (clientId: string, clientName: string, name: string) => {
    const result = await mockResolvePipelineItem(clientId, clientName, name);
    return result;
  },
  checkDuplicate: async (idemKey: string, dupResult: unknown) => {
    if (await mockCheckIdempotency(idemKey)) return dupResult;
    return null;
  },
  insertAuditRecord: async (params: Record<string, unknown>) => {
    mockInsertValues(params);
  },
  getPreviousValue: (entity: Record<string, unknown>, columnKey: string) => String(entity[columnKey] ?? ""),
  validateAndResolveField: (field: string, allowed: readonly string[], fieldToColumn: Record<string, string>) => {
    if (!allowed.includes(field)) {
      return { ok: false, error: `Invalid field '${field}'. Allowed fields: ${allowed.join(", ")}` };
    }
    return { ok: true, typedField: field, columnKey: fieldToColumn[field] };
  },
}));

const client = { id: "c1", name: "Convergix", slug: "convergix" };
const pipelineItem = {
  id: "pl-1",
  name: "SOW Expansion",
  clientId: "c1",
  owner: "Kathy",
  status: "proposal",
  estimatedValue: "50000",
  waitingOn: "Client review",
  notes: "Pending budget approval",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckIdempotency.mockResolvedValue(false);
});

describe("createPipelineItem", () => {
  it("creates pipeline item and audits", async () => {
    mockGetClientBySlug.mockResolvedValue(client);

    const { createPipelineItem } = await import("./operations-writes-pipeline");
    const result = await createPipelineItem({
      clientSlug: "convergix",
      name: "New SOW",
      owner: "Lane",
      status: "scoping",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.name).toBe("New SOW");
      expect(result.data?.clientName).toBe("Convergix");
    }
    expect(mockInsertValues).toHaveBeenCalledTimes(2); // row + audit
  });

  it("returns error for unknown client", async () => {
    mockGetClientBySlug.mockResolvedValue(null);

    const { createPipelineItem } = await import("./operations-writes-pipeline");
    const result = await createPipelineItem({
      clientSlug: "unknown",
      name: "Test",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("unknown");
  });

  it("handles duplicate request", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockCheckIdempotency.mockResolvedValue(true);

    const { createPipelineItem } = await import("./operations-writes-pipeline");
    const result = await createPipelineItem({
      clientSlug: "convergix",
      name: "New SOW",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message).toContain("duplicate");
  });
});

describe("updatePipelineItem", () => {
  it("updates field with before/after and audits", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockResolvePipelineItem.mockResolvedValue({ ok: true, item: pipelineItem });

    const { updatePipelineItem } = await import("./operations-writes-pipeline");
    const result = await updatePipelineItem({
      clientSlug: "convergix",
      pipelineName: "SOW Expansion",
      field: "status",
      newValue: "negotiation",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.previousValue).toBe("proposal");
      expect(result.data?.newValue).toBe("negotiation");
    }
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "negotiation" })
    );
  });

  it("rejects invalid field name", async () => {
    const { updatePipelineItem } = await import("./operations-writes-pipeline");
    const result = await updatePipelineItem({
      clientSlug: "convergix",
      pipelineName: "SOW",
      field: "badField",
      newValue: "foo",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("badField");
  });

  it("returns error for unknown pipeline item", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockResolvePipelineItem.mockResolvedValue({
      ok: false,
      error: "Pipeline item 'Fake' not found for Convergix.",
      available: ["SOW Expansion"],
    });

    const { updatePipelineItem } = await import("./operations-writes-pipeline");
    const result = await updatePipelineItem({
      clientSlug: "convergix",
      pipelineName: "Fake",
      field: "status",
      newValue: "signed",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Fake");
      expect(result.available).toEqual(["SOW Expansion"]);
    }
  });

  it("handles duplicate request", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockResolvePipelineItem.mockResolvedValue({ ok: true, item: pipelineItem });
    mockCheckIdempotency.mockResolvedValue(true);

    const { updatePipelineItem } = await import("./operations-writes-pipeline");
    const result = await updatePipelineItem({
      clientSlug: "convergix",
      pipelineName: "SOW Expansion",
      field: "status",
      newValue: "negotiation",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message).toContain("duplicate");
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });
});

describe("deletePipelineItem", () => {
  it("deletes pipeline item and audits", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockResolvePipelineItem.mockResolvedValue({ ok: true, item: pipelineItem });

    const { deletePipelineItem } = await import("./operations-writes-pipeline");
    const result = await deletePipelineItem({
      clientSlug: "convergix",
      pipelineName: "SOW Expansion",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toContain("SOW Expansion");
      expect(result.data).toEqual({ clientName: "Convergix", pipelineName: "SOW Expansion" });
    }
    expect(mockDeleteFn).toHaveBeenCalled();
    // Audit record inserted
    const auditCall = mockInsertValues.mock.calls[0][0];
    expect(auditCall.updateType).toBe("delete-pipeline-item");
    expect(auditCall.previousValue).toBe("SOW Expansion");
  });

  it("returns error for unknown client", async () => {
    mockGetClientBySlug.mockResolvedValue(null);

    const { deletePipelineItem } = await import("./operations-writes-pipeline");
    const result = await deletePipelineItem({
      clientSlug: "unknown",
      pipelineName: "SOW",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(false);
  });
});
