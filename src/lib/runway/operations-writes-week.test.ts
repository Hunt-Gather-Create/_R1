import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb } from "./operations-writes-test-helpers";

// ── Mock state ──────────────────────────────────────────
const { db: mockDb, mockInsertValues, mockUpdateSet, mockDeleteFn } = createMockDb();

// Track select calls for deleteWeekItem by ID
const mockSelectGet = vi.fn();
const mockSelectWhere = vi.fn(() => mockSelectGet.mock.results[0]?.value ?? []);
const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }));
(mockDb as Record<string, unknown>).select = vi.fn(() => ({ from: mockSelectFrom }));

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
const mockFindWeekItemByFuzzyTitle = vi.fn();
const mockGetWeekItemsForWeek = vi.fn();
const mockCheckIdempotency = vi.fn();

vi.mock("./operations-utils", () => ({
  WEEK_ITEM_FIELDS: ["title", "status", "date", "dayOfWeek", "owner", "resources", "notes", "category"],
  WEEK_ITEM_FIELD_TO_COLUMN: {
    title: "title", status: "status", date: "date", dayOfWeek: "dayOfWeek",
    owner: "owner", resources: "resources", notes: "notes", category: "category",
  },
  generateIdempotencyKey: (...parts: string[]) => parts.join("|"),
  generateId: () => "mock-id-12345678901234",
  getClientNameById: vi.fn().mockImplementation(async (clientId: string | null) => {
    if (clientId === "c1") return "Convergix";
    return undefined;
  }),
  getClientOrFail: async (slug: string) => {
    const client = await mockGetClientBySlug(slug);
    if (!client) return { ok: false, error: `Client '${slug}' not found.` };
    return { ok: true, client };
  },
  findProjectByFuzzyName: (...args: unknown[]) =>
    mockFindProjectByFuzzyName(...args),
  resolveWeekItemOrFail: async (weekOf: string, title: string) => {
    const result = await mockFindWeekItemByFuzzyTitle(weekOf, title);
    if (!result) {
      const items = await mockGetWeekItemsForWeek(weekOf);
      return {
        ok: false,
        error: `Week item '${title}' not found for week of ${weekOf}.`,
        available: items?.map((i: { title: string }) => i.title),
      };
    }
    if (result === "__AMBIGUOUS__") {
      return {
        ok: false,
        error: `Multiple week items match '${title}': CDS Review, CDS Delivery. Which one?`,
        available: ["CDS Review", "CDS Delivery"],
      };
    }
    return { ok: true, item: result };
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

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckIdempotency.mockResolvedValue(false);
});

describe("createWeekItem", () => {
  it("creates week item successfully", async () => {
    const { createWeekItem } = await import("./operations-writes-week");
    const result = await createWeekItem({
      weekOf: "2026-04-06",
      title: "CDS Review",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toContain("CDS Review");
      expect(result.data?.title).toBe("CDS Review");
    }
    expect(mockInsertValues).toHaveBeenCalledTimes(2); // weekItem + audit
  });

  it("creates week item with client and project", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue({ id: "p1", name: "CDS Messaging" });

    const { createWeekItem } = await import("./operations-writes-week");
    const result = await createWeekItem({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      weekOf: "2026-04-06",
      title: "CDS Review Meeting",
      owner: "Kathy",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.clientName).toBe("Convergix");
    }
  });

  it("returns error when client not found", async () => {
    mockGetClientBySlug.mockResolvedValue(null);

    const { createWeekItem } = await import("./operations-writes-week");
    const result = await createWeekItem({
      clientSlug: "unknown",
      weekOf: "2026-04-06",
      title: "Test",
      updatedBy: "jason",
    });

    expect(result.ok).toBe(false);
  });

  it("returns early on duplicate request", async () => {
    mockCheckIdempotency.mockResolvedValue(true);

    const { createWeekItem } = await import("./operations-writes-week");
    const result = await createWeekItem({
      weekOf: "2026-04-06",
      title: "CDS Review",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toContain("duplicate");
    }
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("auto-calculates weekOf from date when weekOf not provided", async () => {
    const { createWeekItem } = await import("./operations-writes-week");
    const result = await createWeekItem({
      date: "2026-04-15", // Wednesday → Monday is 2026-04-13
      title: "Auto Week Test",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    // Verify the insert used the calculated weekOf
    const insertCall = mockInsertValues.mock.calls[0][0];
    expect(insertCall.weekOf).toBe("2026-04-13");
  });

  it("auto-calculates weekOf from Sunday date", async () => {
    const { createWeekItem } = await import("./operations-writes-week");
    const result = await createWeekItem({
      date: "2026-04-19", // Sunday → Monday is 2026-04-13
      title: "Sunday Test",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    const insertCall = mockInsertValues.mock.calls[0][0];
    expect(insertCall.weekOf).toBe("2026-04-13");
  });

  it("auto-calculates weekOf from Monday date", async () => {
    const { createWeekItem } = await import("./operations-writes-week");
    const result = await createWeekItem({
      date: "2026-04-13", // Monday → stays 2026-04-13
      title: "Monday Test",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    const insertCall = mockInsertValues.mock.calls[0][0];
    expect(insertCall.weekOf).toBe("2026-04-13");
  });

  it("uses explicit weekOf when both weekOf and date provided", async () => {
    const { createWeekItem } = await import("./operations-writes-week");
    const result = await createWeekItem({
      weekOf: "2026-04-06",
      date: "2026-04-15",
      title: "Explicit WeekOf Test",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    const insertCall = mockInsertValues.mock.calls[0][0];
    expect(insertCall.weekOf).toBe("2026-04-06");
  });

  it("returns error when neither weekOf nor date provided", async () => {
    const { createWeekItem } = await import("./operations-writes-week");
    const result = await createWeekItem({
      title: "No Week Test",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("weekOf");
    }
  });
});

describe("updateWeekItemField", () => {
  const weekItem = {
    id: "wi1",
    title: "CDS Review",
    status: null,
    date: "2026-04-07",
    dayOfWeek: "tuesday",
    owner: "Kathy",
    resources: "Roz",
    notes: null,
    category: "review",
    clientId: "c1",
  };

  it("updates field successfully", async () => {
    mockFindWeekItemByFuzzyTitle.mockResolvedValue(weekItem);

    const { updateWeekItemField } = await import("./operations-writes-week");
    const result = await updateWeekItemField({
      weekOf: "2026-04-06",
      weekItemTitle: "CDS Review",
      field: "status",
      newValue: "completed",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({
        weekItemTitle: "CDS Review",
        field: "status",
        previousValue: "",
        newValue: "completed",
        reverseCascaded: false,
        clientName: "Convergix",
      });
    }
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed" })
    );
  });

  it("returns error with available titles when item not found", async () => {
    mockFindWeekItemByFuzzyTitle.mockResolvedValue(null);
    mockGetWeekItemsForWeek.mockResolvedValue([
      { title: "CDS Review" },
      { title: "Widget Delivery" },
    ]);

    const { updateWeekItemField } = await import("./operations-writes-week");
    const result = await updateWeekItemField({
      weekOf: "2026-04-06",
      weekItemTitle: "Nonexistent",
      field: "status",
      newValue: "completed",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.available).toEqual(["CDS Review", "Widget Delivery"]);
    }
  });

  it("returns early on duplicate request", async () => {
    mockFindWeekItemByFuzzyTitle.mockResolvedValue(weekItem);
    mockCheckIdempotency.mockResolvedValue(true);

    const { updateWeekItemField } = await import("./operations-writes-week");
    const result = await updateWeekItemField({
      weekOf: "2026-04-06",
      weekItemTitle: "CDS Review",
      field: "owner",
      newValue: "Lane",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toContain("duplicate");
    }
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });

  it("returns disambiguation error when multiple items match", async () => {
    // Override the mock to return "ambiguous" — signal via a special sentinel
    mockFindWeekItemByFuzzyTitle.mockResolvedValue("__AMBIGUOUS__");

    const { updateWeekItemField } = await import("./operations-writes-week");
    const result = await updateWeekItemField({
      weekOf: "2026-04-06",
      weekItemTitle: "CDS",
      field: "status",
      newValue: "completed",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Multiple week items match");
    }
  });

  it("includes metadata with field name in audit record", async () => {
    mockFindWeekItemByFuzzyTitle.mockResolvedValue(weekItem);

    const { updateWeekItemField } = await import("./operations-writes-week");
    await updateWeekItemField({
      weekOf: "2026-04-06",
      weekItemTitle: "CDS Review",
      field: "status",
      newValue: "completed",
      updatedBy: "kathy",
    });

    const auditInsert = mockInsertValues.mock.calls[0][0];
    expect(auditInsert.metadata).toBe(JSON.stringify({ field: "status" }));
  });

  it("rejects invalid field name", async () => {
    const { updateWeekItemField } = await import("./operations-writes-week");
    const result = await updateWeekItemField({
      weekOf: "2026-04-06",
      weekItemTitle: "CDS Review",
      field: "invalid",
      newValue: "foo",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("invalid");
    }
  });

  it("reverse cascades date change on deadline item to project.dueDate", async () => {
    const deadlineItem = {
      ...weekItem,
      category: "deadline",
      projectId: "p1",
      date: "2026-04-23",
    };
    mockFindWeekItemByFuzzyTitle.mockResolvedValue(deadlineItem);

    const { updateWeekItemField } = await import("./operations-writes-week");
    const result = await updateWeekItemField({
      weekOf: "2026-04-06",
      weekItemTitle: "CDS Review",
      field: "date",
      newValue: "2026-04-28",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    // week item update + project dueDate update = 2 calls
    expect(mockUpdateSet).toHaveBeenCalledTimes(2);
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ dueDate: "2026-04-28" })
    );
  });

  it("does not reverse cascade for non-deadline category", async () => {
    const reviewItem = {
      ...weekItem,
      category: "review",
      projectId: "p1",
    };
    mockFindWeekItemByFuzzyTitle.mockResolvedValue(reviewItem);

    const { updateWeekItemField } = await import("./operations-writes-week");
    await updateWeekItemField({
      weekOf: "2026-04-06",
      weekItemTitle: "CDS Review",
      field: "date",
      newValue: "2026-04-28",
      updatedBy: "kathy",
    });

    // Only the week item update itself
    expect(mockUpdateSet).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ dueDate: "2026-04-28" })
    );
  });

  it("does not reverse cascade when projectId is null", async () => {
    const unlinkedDeadline = {
      ...weekItem,
      category: "deadline",
      projectId: null,
    };
    mockFindWeekItemByFuzzyTitle.mockResolvedValue(unlinkedDeadline);

    const { updateWeekItemField } = await import("./operations-writes-week");
    await updateWeekItemField({
      weekOf: "2026-04-06",
      weekItemTitle: "CDS Review",
      field: "date",
      newValue: "2026-04-28",
      updatedBy: "kathy",
    });

    // Only the week item update itself
    expect(mockUpdateSet).toHaveBeenCalledTimes(1);
  });

  it("does not reverse cascade for non-date field changes", async () => {
    const deadlineItem = {
      ...weekItem,
      category: "deadline",
      projectId: "p1",
    };
    mockFindWeekItemByFuzzyTitle.mockResolvedValue(deadlineItem);

    const { updateWeekItemField } = await import("./operations-writes-week");
    await updateWeekItemField({
      weekOf: "2026-04-06",
      weekItemTitle: "CDS Review",
      field: "status",
      newValue: "completed",
      updatedBy: "kathy",
    });

    // Only the week item update itself
    expect(mockUpdateSet).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ dueDate: expect.anything() })
    );
  });
});

describe("deleteWeekItem", () => {
  const weekItem = {
    id: "wi1",
    title: "CDS Review",
    clientId: "c1",
    category: "review",
  };

  it("deletes week item by fuzzy title and audits", async () => {
    mockFindWeekItemByFuzzyTitle.mockResolvedValue(weekItem);

    const { deleteWeekItem } = await import("./operations-writes-week");
    const result = await deleteWeekItem({
      weekOf: "2026-04-06",
      weekItemTitle: "CDS Review",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message).toContain("CDS Review");
    expect(mockDeleteFn).toHaveBeenCalled();
    const auditCall = mockInsertValues.mock.calls[0][0];
    expect(auditCall.updateType).toBe("delete-week-item");
    expect(auditCall.previousValue).toBe("CDS Review");
  });

  it("deletes week item by direct ID", async () => {
    mockSelectWhere.mockReturnValueOnce([weekItem]);

    const { deleteWeekItem } = await import("./operations-writes-week");
    const result = await deleteWeekItem({
      id: "wi1",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message).toContain("CDS Review");
  });

  it("returns error when item not found by title", async () => {
    mockFindWeekItemByFuzzyTitle.mockResolvedValue(null);
    mockGetWeekItemsForWeek.mockResolvedValue([{ title: "CDS Review" }]);

    const { deleteWeekItem } = await import("./operations-writes-week");
    const result = await deleteWeekItem({
      weekOf: "2026-04-06",
      weekItemTitle: "Nonexistent",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(false);
  });

  it("returns error when neither id nor weekOf+title provided", async () => {
    const { deleteWeekItem } = await import("./operations-writes-week");
    const result = await deleteWeekItem({
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Provide either");
  });

  it("handles duplicate request", async () => {
    mockFindWeekItemByFuzzyTitle.mockResolvedValue(weekItem);
    mockCheckIdempotency.mockResolvedValue(true);

    const { deleteWeekItem } = await import("./operations-writes-week");
    const result = await deleteWeekItem({
      weekOf: "2026-04-06",
      weekItemTitle: "CDS Review",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message).toContain("duplicate");
    expect(mockDeleteFn).not.toHaveBeenCalled();
  });
});
