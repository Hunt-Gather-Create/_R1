import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the Runway DB. The cron does:
//   db.select(...).from(weekItems).where(...) → candidates
//   db.transaction(async (tx) => {
//     tx.update(weekItems).set({...}).where(eq(...))
//     // insertAuditRecord is mocked separately below
//   })
// ---------------------------------------------------------------------------

const selectWhereSpy = vi.fn();
const updateSetSpy = vi.fn();
const updateWhereSpy = vi.fn();

const mockSelectWhere = vi.fn<() => Promise<unknown[]>>();

const selectChain = {
  from: () => ({
    where: (cond: unknown) => {
      selectWhereSpy(cond);
      return mockSelectWhere();
    },
  }),
};

const txUpdateChain = {
  set: (payload: Record<string, unknown>) => {
    updateSetSpy(payload);
    return {
      where: (cond: unknown) => {
        updateWhereSpy(cond);
        return Promise.resolve();
      },
    };
  },
};

const tx = {
  update: vi.fn(() => txUpdateChain),
};

const mockDb = {
  select: vi.fn(() => selectChain),
  transaction: vi.fn(async (fn: (arg: typeof tx) => Promise<unknown>) => fn(tx)),
};

vi.mock("@/lib/db/runway", () => ({
  getRunwayDb: () => mockDb,
}));

vi.mock("@/lib/db/runway-schema", () => ({
  weekItems: {
    id: "id",
    status: "status",
    startDate: "start_date",
    endDate: "end_date",
  },
}));

// ---------------------------------------------------------------------------
// Capture drizzle helpers so we can assert structural shape of WHERE clauses.
// ---------------------------------------------------------------------------

const andSpy = vi.fn((...args: unknown[]) => ({ __op: "and", args }));
const eqSpy = vi.fn((col: unknown, val: unknown) => ({ __op: "eq", col, val }));
const lteSpy = vi.fn((col: unknown, val: unknown) => ({ __op: "lte", col, val }));
const gteSpy = vi.fn((col: unknown, val: unknown) => ({ __op: "gte", col, val }));
const isNullSpy = vi.fn((col: unknown) => ({ __op: "isNull", col }));
const isNotNullSpy = vi.fn((col: unknown) => ({ __op: "isNotNull", col }));
const orSpy = vi.fn((...args: unknown[]) => ({ __op: "or", args }));
const inArraySpy = vi.fn((col: unknown, vals: unknown) => ({ __op: "inArray", col, vals }));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => andSpy(...args),
  eq: (col: unknown, val: unknown) => eqSpy(col, val),
  lte: (col: unknown, val: unknown) => lteSpy(col, val),
  gte: (col: unknown, val: unknown) => gteSpy(col, val),
  isNull: (col: unknown) => isNullSpy(col),
  isNotNull: (col: unknown) => isNotNullSpy(col),
  or: (...args: unknown[]) => orSpy(...args),
  inArray: (col: unknown, vals: unknown) => inArraySpy(col, vals),
}));

// ---------------------------------------------------------------------------
// Mock insertAuditRecord + withBatchId so the cron's audit + ALS calls don't
// require a real DB. withBatchId just invokes the fn — we capture the
// batchId for assertion.
// ---------------------------------------------------------------------------

const mockInsertAuditRecord = vi.fn(async (_params: unknown, _executor?: unknown) => "audit-id");
const mockWithBatchId = vi.fn(async <T>(batchId: string, fn: () => Promise<T>) => {
  capturedBatchIds.push(batchId);
  return fn();
});
const capturedBatchIds: string[] = [];

vi.mock("@/lib/runway/operations-utils", () => ({
  insertAuditRecord: (params: unknown, executor?: unknown) =>
    mockInsertAuditRecord(params, executor),
}));
vi.mock("@/lib/runway/runway-als", () => ({
  withBatchId: <T>(batchId: string, fn: () => Promise<T>) =>
    mockWithBatchId(batchId, fn),
}));

// ---------------------------------------------------------------------------
// Mock the inngest client to capture (config, trigger, handler).
// ---------------------------------------------------------------------------

const mockStepRun = vi.fn(async (_name: string, fn: () => Promise<unknown>) =>
  fn(),
);
const mockCreateFunction = vi.fn((config, trigger, handler) => ({
  config,
  trigger,
  handler,
}));

vi.mock("../client", () => ({
  inngest: { createFunction: mockCreateFunction },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let handler: any;

describe("runwayAutoPromote (cron)", () => {
  beforeAll(async () => {
    await import("./runway-auto-promote");
    handler = mockCreateFunction.mock.calls[0][2];
  });

  beforeEach(() => {
    selectWhereSpy.mockClear();
    updateSetSpy.mockClear();
    updateWhereSpy.mockClear();
    mockSelectWhere.mockReset();
    mockDb.select.mockClear();
    mockDb.transaction.mockClear();
    tx.update.mockClear();
    mockInsertAuditRecord.mockClear();
    mockWithBatchId.mockClear();
    capturedBatchIds.length = 0;
    andSpy.mockClear();
    eqSpy.mockClear();
    lteSpy.mockClear();
    gteSpy.mockClear();
    isNullSpy.mockClear();
    isNotNullSpy.mockClear();
    orSpy.mockClear();
    inArraySpy.mockClear();
    mockStepRun.mockClear();
  });

  it("is registered with correct id, retries, and daily 00:05 UTC cron schedule", () => {
    expect(mockCreateFunction).toHaveBeenCalledOnce();
    const [config, trigger] = mockCreateFunction.mock.calls[0];
    expect(config.id).toBe("runway-auto-promote-scheduled");
    expect(config.retries).toBe(1);
    expect(trigger).toEqual({ cron: "5 0 * * *" });
  });

  it("promotes one in-window scheduled L2 and writes audit row tagged with date-scoped batch id", async () => {
    const today = new Date().toISOString().slice(0, 10);
    mockSelectWhere.mockResolvedValueOnce([
      {
        id: "wi-in-window",
        title: "CDS Review",
        projectId: "p1",
        clientId: "c1",
        status: "scheduled",
        startDate: "2026-05-30",
        endDate: "2026-06-05",
      },
    ]);

    const result = await handler({ step: { run: mockStepRun } });

    // Status flip went out as a transactional update.
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(updateSetSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "in-progress" }),
    );

    // Audit row carries the L2 transition + cron trigger metadata.
    expect(mockInsertAuditRecord).toHaveBeenCalledTimes(1);
    const auditPayload = mockInsertAuditRecord.mock.calls[0][0] as Record<string, unknown>;
    expect(auditPayload.updateType).toBe("auto-promote-status");
    expect(auditPayload.previousValue).toBe("scheduled");
    expect(auditPayload.newValue).toBe("in-progress");
    expect(auditPayload.updatedBy).toBe("auto-promote");
    expect(auditPayload.idempotencyKey).toContain("auto-promote");
    expect(auditPayload.idempotencyKey).toContain("wi-in-window");

    // Batch id is date-scoped and threaded through withBatchId so
    // insertAuditRecord picks it up from ALS.
    expect(capturedBatchIds).toEqual([`auto-promote-${today}`]);
    expect(result.batchId).toBe(`auto-promote-${today}`);
    expect(result.promotedCount).toBe(1);
  });

  it("returns promotedCount=0 when no candidates are in window (idempotent re-run)", async () => {
    mockSelectWhere.mockResolvedValueOnce([]);

    const result = await handler({ step: { run: mockStepRun } });

    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(updateSetSpy).not.toHaveBeenCalled();
    expect(mockInsertAuditRecord).not.toHaveBeenCalled();
    expect(result.promotedCount).toBe(0);
  });

  it("query predicate includes scheduled-or-null status (via inArray), non-null startDate, and start<=today<=end window", async () => {
    mockSelectWhere.mockResolvedValueOnce([]);
    await handler({ step: { run: mockStepRun } });

    // status IN ('scheduled') via inArray, OR status IS NULL.
    // Using inArray instead of eq keeps the predicate forward-compatible
    // if more promotable statuses are added to PROMOTABLE_STATUSES.
    const inArrayCall = inArraySpy.mock.calls.find(
      ([col]) => col === "status",
    );
    expect(inArrayCall).toBeDefined();
    expect(inArrayCall?.[1]).toEqual(["scheduled"]);
    expect(isNullSpy.mock.calls.some(([col]) => col === "status")).toBe(true);

    // startDate IS NOT NULL — bracket the cron against rows where the
    // window can't be computed.
    expect(isNotNullSpy.mock.calls.some(([col]) => col === "start_date")).toBe(
      true,
    );

    // start_date <= today
    expect(lteSpy.mock.calls.some(([col]) => col === "start_date")).toBe(true);

    // end_date IS NULL OR end_date >= today
    expect(isNullSpy.mock.calls.some(([col]) => col === "end_date")).toBe(true);
    expect(gteSpy.mock.calls.some(([col]) => col === "end_date")).toBe(true);
  });

  // LlamaPReview thread 1 (PR #109): audit insert must share the transaction
  // with the status flip so a mid-pair failure can't leave the row promoted
  // with no audit trail (or audit-without-promotion). This test asserts the
  // tx parameter is threaded through insertAuditRecord.
  it("threads the tx executor into insertAuditRecord so the flip+audit pair is atomic", async () => {
    mockSelectWhere.mockResolvedValueOnce([
      {
        id: "wi-tx",
        title: "Tx Item",
        projectId: "p1",
        clientId: "c1",
        status: "scheduled",
        startDate: "2026-05-30",
        endDate: "2026-06-05",
      },
    ]);

    await handler({ step: { run: mockStepRun } });

    expect(mockInsertAuditRecord).toHaveBeenCalledTimes(1);
    // The mock signature is (params, executor?). Second arg should be the
    // captured tx object so the audit insert participates in the same tx
    // as the status flip.
    const [, executor] = mockInsertAuditRecord.mock.calls[0];
    expect(executor).toBe(tx);
  });

  it("promotes a candidate whose status is null (legacy sentinel for scheduled)", async () => {
    mockSelectWhere.mockResolvedValueOnce([
      {
        id: "wi-null-status",
        title: "Legacy Item",
        projectId: "p1",
        clientId: "c1",
        status: null,
        startDate: "2026-05-30",
        endDate: "2026-06-05",
      },
    ]);

    const result = await handler({ step: { run: mockStepRun } });

    expect(updateSetSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "in-progress" }),
    );
    const auditPayload = mockInsertAuditRecord.mock.calls[0][0] as Record<string, unknown>;
    expect(auditPayload.previousValue).toBeNull();
    expect(result.promotedCount).toBe(1);
  });

  it("does not promote when the result set is empty even if the query was issued", async () => {
    // The candidate predicate is enforced by the SQL query itself (we mock
    // its result), so candidates passed to the promote loop are by-
    // construction the ones to promote. This test pins the function's
    // behavior on an empty result set — no transactions, no audit rows.
    mockSelectWhere.mockResolvedValueOnce([]);

    const result = await handler({ step: { run: mockStepRun } });

    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(mockInsertAuditRecord).not.toHaveBeenCalled();
    expect(result.promotedCount).toBe(0);
  });

  it("emits one audit row per promoted candidate when multiple are in window", async () => {
    mockSelectWhere.mockResolvedValueOnce([
      {
        id: "wi1",
        title: "Item A",
        projectId: "p1",
        clientId: "c1",
        status: "scheduled",
        startDate: "2026-05-30",
        endDate: "2026-06-05",
      },
      {
        id: "wi2",
        title: "Item B",
        projectId: "p2",
        clientId: "c1",
        status: null,
        startDate: "2026-05-29",
        endDate: null,
      },
      {
        id: "wi3",
        title: "Item C",
        projectId: "p1",
        clientId: "c2",
        status: "scheduled",
        startDate: "2026-05-31",
        endDate: "2026-06-30",
      },
    ]);

    const result = await handler({ step: { run: mockStepRun } });

    expect(result.promotedCount).toBe(3);
    expect(mockDb.transaction).toHaveBeenCalledTimes(3);
    expect(mockInsertAuditRecord).toHaveBeenCalledTimes(3);
    // Each audit row has a unique per-item idempotency key.
    const keys = mockInsertAuditRecord.mock.calls.map(
      (c) => (c[0] as { idempotencyKey: string }).idempotencyKey,
    );
    expect(new Set(keys).size).toBe(3);
  });
});
