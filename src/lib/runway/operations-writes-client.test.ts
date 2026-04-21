import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb } from "./operations-writes-test-helpers";

// ── Mock state ──────────────────────────────────────────
const { db: mockDb, mockInsertValues, mockUpdateSet } = createMockDb();

vi.mock("@/lib/db/runway", () => ({
  getRunwayDb: () => mockDb,
}));

vi.mock("@/lib/db/runway-schema", () => ({
  clients: { id: "id" },
  updates: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
}));

const mockGetClientBySlugResult = vi.fn();
const mockCheckIdempotency = vi.fn();

vi.mock("./operations-utils", () => ({
  CLIENT_FIELDS: ["name", "team", "contractValue", "contractTerm", "contractStatus", "clientContacts", "nicknames"],
  CLIENT_FIELD_TO_COLUMN: {
    name: "name", team: "team", contractValue: "contractValue",
    contractTerm: "contractTerm", contractStatus: "contractStatus",
    clientContacts: "clientContacts", nicknames: "nicknames",
  },
  generateIdempotencyKey: (...parts: string[]) => parts.join("|"),
  generateId: () => "test-id-123",
  getClientOrFail: async (slug: string) => {
    const client = await mockGetClientBySlugResult(slug);
    if (!client) return { ok: false, error: `Client '${slug}' not found.` };
    return { ok: true, client };
  },
  getClientBySlug: async (slug: string) => {
    return mockGetClientBySlugResult(slug);
  },
  invalidateClientCache: vi.fn(),
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
  // v4 (Chunk 5): identity passthrough by default keeps existing assertions
  // stable. Tests that need to prove normalize is actually invoked (e.g.
  // createClient team normalization in §14.1) transform non-canonical arrow
  // forms to the canonical `->` token so the write can be asserted.
  normalizeResourcesString: (raw: string | null | undefined) =>
    (raw ?? "").replace(/\s*(?:→|=>|>>)\s*/g, " -> "),
}));

const client = { id: "c1", name: "Convergix", slug: "convergix", team: "PM: Ronan", contractStatus: null };

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckIdempotency.mockResolvedValue(false);
});

describe("createClient", () => {
  it("creates client and audits", async () => {
    mockGetClientBySlugResult.mockResolvedValue(null);

    const { createClient } = await import("./operations-writes-client");
    const result = await createClient({
      name: "New Client",
      slug: "new-client",
      updatedBy: "jason",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.clientName).toBe("New Client");
      expect(result.data?.slug).toBe("new-client");
    }
    expect(mockInsertValues).toHaveBeenCalledTimes(2); // client row + audit
  });

  it("returns error for duplicate slug", async () => {
    mockGetClientBySlugResult.mockResolvedValue(client);

    const { createClient } = await import("./operations-writes-client");
    const result = await createClient({
      name: "Convergix Dupe",
      slug: "convergix",
      updatedBy: "jason",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("convergix");
  });

  it("handles duplicate request", async () => {
    mockGetClientBySlugResult.mockResolvedValue(null);
    mockCheckIdempotency.mockResolvedValue(true);

    const { createClient } = await import("./operations-writes-client");
    const result = await createClient({
      name: "New Client",
      slug: "new-client",
      updatedBy: "jason",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message).toContain("duplicate");
  });

  // v4 (Chunk 5 debt §14.1): createClient was the one write path storing
  // `team` raw. Proves normalizeResourcesString is invoked on create.
  it("normalizes team field on write (unicode arrow → canonical ->)", async () => {
    mockGetClientBySlugResult.mockResolvedValue(null);

    const { createClient } = await import("./operations-writes-client");
    const result = await createClient({
      name: "Arrow Client",
      slug: "arrow-client",
      team: "PM: Jason → CD: Lane",
      updatedBy: "jason",
    });

    expect(result.ok).toBe(true);
    // First insert is the client row; assert team stored in canonical form.
    const clientInsert = mockInsertValues.mock.calls[0][0];
    expect(clientInsert.team).toBe("PM: Jason -> CD: Lane");
  });

  it("normalizes team field on write (drift arrow => canonical ->)", async () => {
    mockGetClientBySlugResult.mockResolvedValue(null);

    const { createClient } = await import("./operations-writes-client");
    const result = await createClient({
      name: "Drift Client",
      slug: "drift-client",
      team: "PM: Jason =>CD: Lane",
      updatedBy: "jason",
    });

    expect(result.ok).toBe(true);
    const clientInsert = mockInsertValues.mock.calls[0][0];
    expect(clientInsert.team).toBe("PM: Jason -> CD: Lane");
  });

  it("stores null team when not provided (no normalize call)", async () => {
    mockGetClientBySlugResult.mockResolvedValue(null);

    const { createClient } = await import("./operations-writes-client");
    await createClient({
      name: "No Team Client",
      slug: "no-team-client",
      updatedBy: "jason",
    });

    const clientInsert = mockInsertValues.mock.calls[0][0];
    expect(clientInsert.team).toBeNull();
  });
});

describe("updateClientField", () => {
  it("updates team field and audits with before/after", async () => {
    mockGetClientBySlugResult.mockResolvedValue(client);

    const { updateClientField } = await import("./operations-writes-client");
    const result = await updateClientField({
      clientSlug: "convergix",
      field: "team",
      newValue: "PM: Jason",
      updatedBy: "jason",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.previousValue).toBe("PM: Ronan");
      expect(result.data?.newValue).toBe("PM: Jason");
    }
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ team: "PM: Jason" })
    );
  });

  it("updates contractStatus field", async () => {
    mockGetClientBySlugResult.mockResolvedValue(client);

    const { updateClientField } = await import("./operations-writes-client");
    const result = await updateClientField({
      clientSlug: "convergix",
      field: "contractStatus",
      newValue: "signed",
      updatedBy: "jason",
    });

    expect(result.ok).toBe(true);
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ contractStatus: "signed" })
    );
  });

  it("returns error for unknown client", async () => {
    mockGetClientBySlugResult.mockResolvedValue(null);

    const { updateClientField } = await import("./operations-writes-client");
    const result = await updateClientField({
      clientSlug: "unknown",
      field: "team",
      newValue: "New Team",
      updatedBy: "jason",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("unknown");
  });

  it("handles duplicate request", async () => {
    mockGetClientBySlugResult.mockResolvedValue(client);
    mockCheckIdempotency.mockResolvedValue(true);

    const { updateClientField } = await import("./operations-writes-client");
    const result = await updateClientField({
      clientSlug: "convergix",
      field: "team",
      newValue: "PM: Jason",
      updatedBy: "jason",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message).toContain("duplicate");
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });

  it("rejects invalid field name", async () => {
    const { updateClientField } = await import("./operations-writes-client");
    const result = await updateClientField({
      clientSlug: "convergix",
      field: "invalid",
      newValue: "foo",
      updatedBy: "jason",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("invalid");
  });

  it("includes metadata with field name in audit record", async () => {
    mockGetClientBySlugResult.mockResolvedValue(client);

    const { updateClientField } = await import("./operations-writes-client");
    await updateClientField({
      clientSlug: "convergix",
      field: "contractStatus",
      newValue: "signed",
      updatedBy: "jason",
    });

    const auditCall = mockInsertValues.mock.calls[0][0];
    expect(auditCall.metadata).toBe(JSON.stringify({ field: "contractStatus" }));
    expect(auditCall.updateType).toBe("client-field-change");
  });
});
