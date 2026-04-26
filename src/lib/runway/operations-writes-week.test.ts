import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb } from "./operations-writes-test-helpers";

// ── Mock state ──────────────────────────────────────────
const { db: mockDb, mockTx, mockInsertValues, mockUpdateSet } = createMockDb();

// Track select calls for deleteWeekItem by ID.
// `.where(...)` returns an array (for chainless callers); `.orderBy(...)` and
// `.limit(...)` also terminate — the v4 recompute path uses `.where(...)`
// without a terminator, so the array result doubles as the awaitable value.
const mockSelectGet = vi.fn();
const mockSelectWhere = vi.fn(() => mockSelectGet.mock.results[0]?.value ?? []);
const mockSelectFrom = vi.fn(() => ({
  where: mockSelectWhere,
  orderBy: vi.fn(() => mockSelectGet.mock.results[0]?.value ?? []),
  limit: vi.fn(() => mockSelectGet.mock.results[0]?.value ?? []),
}));
const mockSelectImpl = vi.fn(() => ({ from: mockSelectFrom }));
(mockDb as Record<string, unknown>).select = mockSelectImpl;
// Route the transaction object's select through the same chain so
// `recomputeProjectDatesWith(tx, ...)` sees the test's select stubs.
(mockTx as Record<string, unknown>).select = mockSelectImpl;

// `deleteWeekItem` now runs its delete inside the transaction callback, so
// assert against `mockTx.delete` in place of `mockDb.delete`.
const mockDeleteFn = mockTx.delete as ReturnType<typeof vi.fn>;

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

// Mock `./operations-utils` while letting the real shared validators
// (`validateIsoDateShape`, `validateWeekItemStatus`, `validateWeekItemCategory`)
// and constants (`WEEK_ITEM_FIELDS`, `WEEK_ITEM_STATUSES`, …) come through via
// `importOriginal`. Inline reimplementations would silently drift from the
// production source; the helper's rejection paths must exercise the real
// shared validators or this test is theatre.
vi.mock("./operations-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./operations-utils")>();
  return {
    ...actual,
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
      const id = (params.id as string | undefined) ?? "mock-audit-id";
      mockInsertValues({ ...params, id });
      return id;
    },
    getPreviousValue: (entity: Record<string, unknown>, columnKey: string) => String(entity[columnKey] ?? ""),
    // v4 (Chunk 5): identity passthrough — preserves existing assertions that
    // assume raw `newValue` flows straight to the db. Real normalization is
    // asserted in operations-utils.test.ts.
    normalizeResourcesString: (raw: string | null | undefined) => raw ?? "",
  };
});

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

  // v4: L2 owner inheritance from parent L1 (runway-v4-convention.md §"Owner inheritance rule")
  it("inherits owner from parent L1 when owner not provided", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue({
      id: "p1",
      name: "CDS Messaging",
      owner: "Kathy",
    });

    const { createWeekItem } = await import("./operations-writes-week");
    const result = await createWeekItem({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      weekOf: "2026-04-06",
      title: "CDS Review",
      // owner NOT provided — should inherit
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    const insertCall = mockInsertValues.mock.calls[0][0];
    expect(insertCall.owner).toBe("Kathy");
  });

  it("explicit owner overrides L1 inheritance", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue({
      id: "p1",
      name: "CDS Messaging",
      owner: "Kathy",
    });

    const { createWeekItem } = await import("./operations-writes-week");
    const result = await createWeekItem({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      weekOf: "2026-04-06",
      title: "CDS Review",
      owner: "Lane", // explicit override
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    const insertCall = mockInsertValues.mock.calls[0][0];
    expect(insertCall.owner).toBe("Lane");
  });

  it("leaves owner null when no project match and no explicit owner", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(null);

    const { createWeekItem } = await import("./operations-writes-week");
    const result = await createWeekItem({
      clientSlug: "convergix",
      projectName: "Unknown Project",
      weekOf: "2026-04-06",
      title: "Standalone Item",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    const insertCall = mockInsertValues.mock.calls[0][0];
    expect(insertCall.owner).toBeNull();
  });

  it("leaves owner null when parent L1 has no owner", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue({
      id: "p1",
      name: "CDS Messaging",
      owner: null,
    });

    const { createWeekItem } = await import("./operations-writes-week");
    const result = await createWeekItem({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      weekOf: "2026-04-06",
      title: "Standalone Item",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    const insertCall = mockInsertValues.mock.calls[0][0];
    expect(insertCall.owner).toBeNull();
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
        // PR #86: structured reverse cascade info — null when no cascade fired.
        reverseCascadeDetail: null,
        clientName: "Convergix",
        auditId: expect.any(String),
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
    // week item update + project dueDate update + v4 recomputeProjectDates update = 3 calls
    expect(mockUpdateSet).toHaveBeenCalledTimes(3);
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

    // week item update + v4 recomputeProjectDates update = 2 (no reverse cascade to dueDate)
    expect(mockUpdateSet).toHaveBeenCalledTimes(2);
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

    // Only the week item update (no projectId = no cascade, no recompute)
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

    // Only the week item update itself — status is not a date field, no recompute
    expect(mockUpdateSet).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ dueDate: expect.anything() })
    );
  });

  // PR #86: MCP/bot consumers parse the reverse cascade outcome from
  // `data.reverseCascadeDetail`. Today the bot tool reads `reverseCascaded`
  // (a bool) — the new detail gives consumers the parent project id + name
  // + prior dueDate + audit id so they can render a full breadcrumb.
  describe("structured response (reverseCascadeDetail + auditId)", () => {
    it("returns reverseCascadeDetail snapshot when a deadline date cascades", async () => {
      const deadlineItem = {
        ...weekItem,
        category: "deadline",
        projectId: "p1",
        date: "2026-04-23",
      };
      mockFindWeekItemByFuzzyTitle.mockResolvedValue(deadlineItem);
      // Parent snapshot — first select call (pre-transaction) reads the project row.
      // Subsequent selects (recomputeProjectDates) also hit this mock; returning
      // the same row is harmless because recompute only consumes startDate/endDate.
      // Seed mockSelectGet's results[] so mockSelectWhere can find a payload.
      mockSelectGet.mockReturnValue([
        { id: "p1", name: "CDS Messaging", dueDate: "2026-04-15" },
      ]);
      // Prime `mock.results[0]` — the `where`/`orderBy`/`limit` stubs read
      // `mockSelectGet.mock.results[0]?.value`, which only populates after
      // an actual invocation. Calling it here mirrors how other tests in the
      // file (not shown) shape select payloads.
      mockSelectGet();

      const { updateWeekItemField } = await import("./operations-writes-week");
      const result = await updateWeekItemField({
        weekOf: "2026-04-06",
        weekItemTitle: "CDS Review",
        field: "date",
        newValue: "2026-04-28",
        updatedBy: "kathy",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data?.reverseCascaded).toBe(true);
      expect(result.data?.reverseCascadeDetail).toEqual({
        projectId: "p1",
        projectName: "CDS Messaging",
        field: "dueDate",
        previousDueDate: "2026-04-15",
        newDueDate: "2026-04-28",
        auditId: expect.any(String),
      });
      expect(result.data?.auditId).toBe(
        result.data?.reverseCascadeDetail?.auditId
      );
    });

    it("reverseCascadeDetail is null when the cascade does not fire", async () => {
      const reviewItem = {
        ...weekItem,
        category: "review",
        projectId: "p1",
      };
      mockFindWeekItemByFuzzyTitle.mockResolvedValue(reviewItem);

      const { updateWeekItemField } = await import("./operations-writes-week");
      const result = await updateWeekItemField({
        weekOf: "2026-04-06",
        weekItemTitle: "CDS Review",
        field: "date",
        newValue: "2026-04-28",
        updatedBy: "kathy",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data?.reverseCascaded).toBe(false);
      expect(result.data?.reverseCascadeDetail).toBeNull();
    });

    it("reverseCascadeDetail preserves null previousDueDate when parent was unset", async () => {
      const deadlineItem = {
        ...weekItem,
        category: "deadline",
        projectId: "p1",
      };
      mockFindWeekItemByFuzzyTitle.mockResolvedValue(deadlineItem);
      mockSelectGet.mockReturnValue([
        { id: "p1", name: "CDS Messaging", dueDate: null },
      ]);
      mockSelectGet(); // prime mock.results[0]

      const { updateWeekItemField } = await import("./operations-writes-week");
      const result = await updateWeekItemField({
        weekOf: "2026-04-06",
        weekItemTitle: "CDS Review",
        field: "date",
        newValue: "2026-04-28",
        updatedBy: "kathy",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data?.reverseCascadeDetail?.previousDueDate).toBeNull();
      expect(result.data?.reverseCascadeDetail?.newDueDate).toBe("2026-04-28");
    });
  });

  // Helper-level value validation — batch_apply bypasses the MCP wrapper, so
  // these checks have to live in the helper. Mirrors the
  // parent-project-id-validators.test.ts pattern.
  describe("helper-level value validation", () => {
    it("rejects invalid status before any DB write", async () => {
      mockFindWeekItemByFuzzyTitle.mockResolvedValue(weekItem);

      const { updateWeekItemField } = await import("./operations-writes-week");
      const result = await updateWeekItemField({
        weekOf: "2026-04-06",
        weekItemTitle: "CDS Review",
        field: "status",
        newValue: "Done",
        updatedBy: "batch",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/status must be one of/);
        expect(result.error).toContain("Done");
      }
      expect(mockUpdateSet).not.toHaveBeenCalled();
      expect(mockInsertValues).not.toHaveBeenCalled();
    });

    it("rejects invalid category before any DB write", async () => {
      mockFindWeekItemByFuzzyTitle.mockResolvedValue(weekItem);

      const { updateWeekItemField } = await import("./operations-writes-week");
      const result = await updateWeekItemField({
        weekOf: "2026-04-06",
        weekItemTitle: "CDS Review",
        field: "category",
        newValue: "meeting",
        updatedBy: "batch",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/category must be one of/);
        expect(result.error).toContain("meeting");
      }
      expect(mockUpdateSet).not.toHaveBeenCalled();
    });

    it("rejects shape-invalid date before any DB write", async () => {
      mockFindWeekItemByFuzzyTitle.mockResolvedValue(weekItem);

      const { updateWeekItemField } = await import("./operations-writes-week");
      const result = await updateWeekItemField({
        weekOf: "2026-04-06",
        weekItemTitle: "CDS Review",
        field: "date",
        newValue: "not-a-date",
        updatedBy: "batch",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/date must be a valid ISO/);
      expect(mockUpdateSet).not.toHaveBeenCalled();
    });

    it("rejects date-invalid '2026-13-45' before any DB write", async () => {
      // Same load-bearing case as the project-side test: lex compare against
      // adjacent dates would silently accept this without the validator.
      mockFindWeekItemByFuzzyTitle.mockResolvedValue(weekItem);

      const { updateWeekItemField } = await import("./operations-writes-week");
      const result = await updateWeekItemField({
        weekOf: "2026-04-06",
        weekItemTitle: "CDS Review",
        field: "startDate",
        newValue: "2026-13-45",
        updatedBy: "batch",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/startDate must be a valid ISO/);
      expect(mockUpdateSet).not.toHaveBeenCalled();
    });

    it("accepts valid status and persists it", async () => {
      mockFindWeekItemByFuzzyTitle.mockResolvedValue(weekItem);

      const { updateWeekItemField } = await import("./operations-writes-week");
      const result = await updateWeekItemField({
        weekOf: "2026-04-06",
        weekItemTitle: "CDS Review",
        field: "status",
        newValue: "blocked",
        updatedBy: "batch",
      });

      expect(result.ok).toBe(true);
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: "blocked" })
      );
    });
  });

  describe("createWeekItem helper-level value validation", () => {
    it("rejects invalid status at create time", async () => {
      const { createWeekItem } = await import("./operations-writes-week");
      const result = await createWeekItem({
        weekOf: "2026-04-06",
        title: "Bogus Status",
        status: "Done",
        updatedBy: "batch",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/status must be one of/);
      expect(mockInsertValues).not.toHaveBeenCalled();
    });

    it("rejects invalid category at create time", async () => {
      const { createWeekItem } = await import("./operations-writes-week");
      const result = await createWeekItem({
        weekOf: "2026-04-06",
        title: "Bogus Category",
        category: "meeting",
        updatedBy: "batch",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/category must be one of/);
      expect(mockInsertValues).not.toHaveBeenCalled();
    });

    it("rejects shape-invalid startDate at create time", async () => {
      const { createWeekItem } = await import("./operations-writes-week");
      const result = await createWeekItem({
        weekOf: "2026-04-06",
        title: "Bogus Date",
        startDate: "garbage",
        updatedBy: "batch",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/startDate must be a valid ISO/);
      expect(mockInsertValues).not.toHaveBeenCalled();
    });
  });

  // Null newValue support: retainer/v4 cleanup migrations need to clear L2
  // status (NULL = scheduled) without falling back to raw drizzle. The helper
  // accepts newValue: null as a first-class write.
  describe("null newValue writes", () => {
    const blockedItem = {
      ...weekItem,
      status: "blocked",
    };

    it("writes SQL NULL when newValue is null", async () => {
      mockFindWeekItemByFuzzyTitle.mockResolvedValue(blockedItem);

      const { updateWeekItemField } = await import("./operations-writes-week");
      const result = await updateWeekItemField({
        weekOf: "2026-04-06",
        weekItemTitle: "CDS Review",
        field: "status",
        newValue: null,
        updatedBy: "migration",
      });

      expect(result.ok).toBe(true);
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: null })
      );
    });

    it("audit row newValue is null and summary uses (null) marker", async () => {
      mockFindWeekItemByFuzzyTitle.mockResolvedValue(blockedItem);

      const { updateWeekItemField } = await import("./operations-writes-week");
      await updateWeekItemField({
        weekOf: "2026-04-06",
        weekItemTitle: "CDS Review",
        field: "status",
        newValue: null,
        updatedBy: "migration",
      });

      const insertCall = mockInsertValues.mock.calls[0][0];
      expect(insertCall.newValue).toBe(null);
      expect(insertCall.summary).toContain('"(null)"');
    });

    it("idempotency key uses (null) marker for repeat collapsing", async () => {
      mockFindWeekItemByFuzzyTitle.mockResolvedValue(blockedItem);

      const { updateWeekItemField } = await import("./operations-writes-week");
      await updateWeekItemField({
        weekOf: "2026-04-06",
        weekItemTitle: "CDS Review",
        field: "status",
        newValue: null,
        updatedBy: "migration",
      });

      const insertCall = mockInsertValues.mock.calls[0][0];
      expect(insertCall.idempotencyKey).toContain("|(null)|");
    });

    it("duplicate null write returns success without re-writing", async () => {
      mockFindWeekItemByFuzzyTitle.mockResolvedValue(blockedItem);
      mockCheckIdempotency.mockResolvedValue(true);

      const { updateWeekItemField } = await import("./operations-writes-week");
      const result = await updateWeekItemField({
        weekOf: "2026-04-06",
        weekItemTitle: "CDS Review",
        field: "status",
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

    it("clearing resources with null skips normalizer", async () => {
      mockFindWeekItemByFuzzyTitle.mockResolvedValue(weekItem);

      const { updateWeekItemField } = await import("./operations-writes-week");
      const result = await updateWeekItemField({
        weekOf: "2026-04-06",
        weekItemTitle: "CDS Review",
        field: "resources",
        newValue: null,
        updatedBy: "migration",
      });

      expect(result.ok).toBe(true);
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ resources: null })
      );
    });
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

describe("updateWeekItemField — weekOf whitelist", () => {
  const weekItem = {
    id: "wi1",
    title: "Dev Handoff",
    status: null,
    date: "2026-04-28",
    dayOfWeek: "tuesday",
    weekOf: "2026-04-20",
    owner: "Jill",
    resources: "Dev: Leslie",
    notes: null,
    category: "deadline",
    clientId: "c1",
    projectId: null,
  };

  it("writes weekOf through updateWeekItemField", async () => {
    mockFindWeekItemByFuzzyTitle.mockResolvedValue(weekItem);

    const { updateWeekItemField } = await import("./operations-writes-week");
    const result = await updateWeekItemField({
      weekOf: "2026-04-20",
      weekItemTitle: "Dev Handoff",
      field: "weekOf",
      newValue: "2026-04-27",
      updatedBy: "migration",
    });

    expect(result.ok).toBe(true);
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ weekOf: "2026-04-27" })
    );
  });
});

describe("linkWeekItemToProject", () => {
  const weekItem = {
    id: "wi1",
    title: "Design Presentation",
    clientId: "c1",
    projectId: null,
  };
  const project = {
    id: "p1",
    name: "Impact Report",
    clientId: "c1",
  };

  it("links orphan week item to project and writes audit", async () => {
    mockSelectWhere
      .mockReturnValueOnce([weekItem])
      .mockReturnValueOnce([project]);

    const { linkWeekItemToProject } = await import("./operations-writes-week");
    const result = await linkWeekItemToProject({
      weekItemId: "wi1",
      projectId: "p1",
      updatedBy: "migration",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.weekItemTitle).toBe("Design Presentation");
      expect(result.data?.previousProjectId).toBeNull();
      expect(result.data?.newProjectId).toBe("p1");
      expect(result.data?.clientName).toBe("Convergix");
    }
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "p1" })
    );
    const auditCall = mockInsertValues.mock.calls[0][0];
    expect(auditCall.updateType).toBe("week-reparent");
    expect(auditCall.previousValue).toBe("(none)");
    expect(auditCall.newValue).toBe("p1");
    expect(auditCall.summary).toContain("re-parented");
    expect(auditCall.summary).toContain("Impact Report");
  });

  it("is idempotent on replay", async () => {
    mockSelectWhere
      .mockReturnValueOnce([weekItem])
      .mockReturnValueOnce([project]);
    mockCheckIdempotency.mockResolvedValue(true);

    const { linkWeekItemToProject } = await import("./operations-writes-week");
    const result = await linkWeekItemToProject({
      weekItemId: "wi1",
      projectId: "p1",
      updatedBy: "migration",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message).toContain("duplicate");
    expect(mockUpdateSet).not.toHaveBeenCalled();
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("returns error when week item id not found", async () => {
    mockSelectWhere.mockReturnValueOnce([]);

    const { linkWeekItemToProject } = await import("./operations-writes-week");
    const result = await linkWeekItemToProject({
      weekItemId: "missing",
      projectId: "p1",
      updatedBy: "migration",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not found");
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });

  it("returns error when project id not found", async () => {
    mockSelectWhere
      .mockReturnValueOnce([weekItem])
      .mockReturnValueOnce([]);

    const { linkWeekItemToProject } = await import("./operations-writes-week");
    const result = await linkWeekItemToProject({
      weekItemId: "wi1",
      projectId: "missing",
      updatedBy: "migration",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not found");
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });

  it("rejects cross-client linking", async () => {
    mockSelectWhere
      .mockReturnValueOnce([{ ...weekItem, clientId: "c1" }])
      .mockReturnValueOnce([{ ...project, clientId: "c2" }]);

    const { linkWeekItemToProject } = await import("./operations-writes-week");
    const result = await linkWeekItemToProject({
      weekItemId: "wi1",
      projectId: "p1",
      updatedBy: "migration",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("client mismatch");
    expect(mockUpdateSet).not.toHaveBeenCalled();
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("records previous projectId when re-parenting a linked item", async () => {
    mockSelectWhere
      .mockReturnValueOnce([{ ...weekItem, projectId: "p-old" }])
      .mockReturnValueOnce([project]);

    const { linkWeekItemToProject } = await import("./operations-writes-week");
    const result = await linkWeekItemToProject({
      weekItemId: "wi1",
      projectId: "p1",
      updatedBy: "migration",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data?.previousProjectId).toBe("p-old");
    const auditCall = mockInsertValues.mock.calls[0][0];
    expect(auditCall.previousValue).toBe("p-old");
  });
});
