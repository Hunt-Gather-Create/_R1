import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the runway DB. We capture calls to update().set().where().returning()
// and delete().where().returning() and verify both the where-clauses and the
// shape of the values being set.
// ---------------------------------------------------------------------------

type FakeRow = { id: string };

const mockUpdateReturning = vi.fn<() => Promise<FakeRow[]>>();
const mockDeleteReturning = vi.fn<() => Promise<FakeRow[]>>();

// Track the .set() payload + the .where() condition references for assertions.
const setSpy = vi.fn();
const updateWhereSpy = vi.fn();
const deleteWhereSpy = vi.fn();

const updateChain = {
  set: (payload: Record<string, unknown>) => {
    setSpy(payload);
    return {
      where: (cond: unknown) => {
        updateWhereSpy(cond);
        return {
          returning: () => mockUpdateReturning(),
        };
      },
    };
  },
};

const deleteChain = {
  where: (cond: unknown) => {
    deleteWhereSpy(cond);
    return {
      returning: () => mockDeleteReturning(),
    };
  },
};

const mockDb = {
  update: vi.fn(() => updateChain),
  delete: vi.fn(() => deleteChain),
};

vi.mock("@/lib/db/runway", () => ({
  getRunwayDb: () => mockDb,
}));

// ---------------------------------------------------------------------------
// Capture drizzle-orm helper calls so we can assert structural shape of the
// where-clauses without coupling to internal symbols.
// ---------------------------------------------------------------------------

const andSpy = vi.fn((...args: unknown[]) => ({ __op: "and", args }));
const eqSpy = vi.fn((col: unknown, val: unknown) => ({ __op: "eq", col, val }));
const ltSpy = vi.fn((col: unknown, val: unknown) => ({ __op: "lt", col, val }));
const inArraySpy = vi.fn((col: unknown, vals: unknown) => ({
  __op: "inArray",
  col,
  vals,
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => andSpy(...args),
  eq: (col: unknown, val: unknown) => eqSpy(col, val),
  lt: (col: unknown, val: unknown) => ltSpy(col, val),
  inArray: (col: unknown, vals: unknown) => inArraySpy(col, vals),
}));

// ---------------------------------------------------------------------------
// Mock the inngest client to capture the function definition (config, trigger,
// handler) created by inngest.createFunction(...).
// ---------------------------------------------------------------------------

const mockStepRun = vi.fn(async (_name: string, fn: () => Promise<unknown>) =>
  fn()
);
const mockCreateFunction = vi.fn((config, trigger, handler) => ({
  config,
  trigger,
  handler,
}));

vi.mock("../client", () => ({
  inngest: {
    createFunction: mockCreateFunction,
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let handler: any;

describe("sweepExpiredProposals (cron)", () => {
  beforeAll(async () => {
    await import("./proposal-expiry-sweep");
    handler = mockCreateFunction.mock.calls[0][2];
  });

  beforeEach(() => {
    setSpy.mockClear();
    updateWhereSpy.mockClear();
    deleteWhereSpy.mockClear();
    mockDb.update.mockClear();
    mockDb.delete.mockClear();
    mockUpdateReturning.mockReset();
    mockDeleteReturning.mockReset();
    andSpy.mockClear();
    eqSpy.mockClear();
    ltSpy.mockClear();
    inArraySpy.mockClear();
    mockStepRun.mockClear();
  });

  it("is registered with correct id, retries, and 15-minute cron schedule", () => {
    expect(mockCreateFunction).toHaveBeenCalledOnce();
    const [config, trigger] = mockCreateFunction.mock.calls[0];
    expect(config.id).toBe("sweep-expired-proposals");
    expect(config.retries).toBe(1);
    expect(trigger).toEqual({ cron: "*/15 * * * *" });
  });

  it("marks pending rows past expires_at as expired with statusReason='TTL elapsed'", async () => {
    mockUpdateReturning.mockResolvedValueOnce([
      { id: "p1" },
      { id: "p2" },
      { id: "p3" },
    ]);
    mockDeleteReturning.mockResolvedValueOnce([]);

    const result = await handler({ step: { run: mockStepRun } });

    // Update path was invoked.
    expect(mockDb.update).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith({
      status: "expired",
      statusReason: "TTL elapsed",
    });

    // The eq clause filters on status='pending'; the lt clause uses a Date.
    const eqCalls = eqSpy.mock.calls;
    expect(eqCalls.some(([, val]) => val === "pending")).toBe(true);
    const ltCallsUpdate = ltSpy.mock.calls;
    expect(ltCallsUpdate.length).toBeGreaterThanOrEqual(1);
    expect(ltCallsUpdate[0][1]).toBeInstanceOf(Date);

    // Handler returns the count of rows marked expired.
    expect(result.expiredCount).toBe(3);
  });

  it("returns expiredCount=0 when no pending rows are past expires_at", async () => {
    mockUpdateReturning.mockResolvedValueOnce([]);
    mockDeleteReturning.mockResolvedValueOnce([]);

    const result = await handler({ step: { run: mockStepRun } });

    expect(result.expiredCount).toBe(0);
  });

  it("deletes terminal-status rows older than 24 hours", async () => {
    mockUpdateReturning.mockResolvedValueOnce([]);
    mockDeleteReturning.mockResolvedValueOnce([
      { id: "old1" },
      { id: "old2" },
    ]);

    const before = Date.now();
    const result = await handler({ step: { run: mockStepRun } });
    const after = Date.now();

    expect(mockDb.delete).toHaveBeenCalledTimes(1);

    // The inArray clause should target the 4 terminal statuses.
    const inArrayCall = inArraySpy.mock.calls[0];
    expect(inArrayCall).toBeDefined();
    expect(inArrayCall[1]).toEqual([
      "submitted",
      "cancelled",
      "expired",
      "failed",
    ]);

    // The lt clause for delete uses a 24h-ago cutoff Date.
    const ltCalls = ltSpy.mock.calls;
    const deleteLtCall = ltCalls[ltCalls.length - 1];
    const cutoff = deleteLtCall[1] as Date;
    expect(cutoff).toBeInstanceOf(Date);

    // Cutoff is approximately 24h before "now" (within the test window).
    const expectedMin = before - 24 * 60 * 60 * 1000 - 50;
    const expectedMax = after - 24 * 60 * 60 * 1000 + 50;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(expectedMin);
    expect(cutoff.getTime()).toBeLessThanOrEqual(expectedMax);

    expect(result.deletedCount).toBe(2);
  });

  it("returns deletedCount=0 when no terminal rows are older than 24 hours", async () => {
    mockUpdateReturning.mockResolvedValueOnce([]);
    mockDeleteReturning.mockResolvedValueOnce([]);

    const result = await handler({ step: { run: mockStepRun } });

    expect(result.deletedCount).toBe(0);
  });

  it("is idempotent: a second invocation against an already-empty result set is a no-op", async () => {
    // First run: nothing to mark, nothing to delete.
    mockUpdateReturning.mockResolvedValueOnce([]);
    mockDeleteReturning.mockResolvedValueOnce([]);
    const first = await handler({ step: { run: mockStepRun } });
    expect(first).toEqual({ expiredCount: 0, deletedCount: 0 });

    // Second run: still nothing (DB state unchanged).
    mockUpdateReturning.mockResolvedValueOnce([]);
    mockDeleteReturning.mockResolvedValueOnce([]);
    const second = await handler({ step: { run: mockStepRun } });
    expect(second).toEqual({ expiredCount: 0, deletedCount: 0 });
  });

  it("returns { expiredCount, deletedCount } with both counts correctly", async () => {
    mockUpdateReturning.mockResolvedValueOnce([{ id: "a" }, { id: "b" }]);
    mockDeleteReturning.mockResolvedValueOnce([
      { id: "c" },
      { id: "d" },
      { id: "e" },
    ]);

    const result = await handler({ step: { run: mockStepRun } });

    expect(result).toEqual({ expiredCount: 2, deletedCount: 3 });
  });

  it("wraps both DB operations in named step.run blocks for durable execution", async () => {
    mockUpdateReturning.mockResolvedValueOnce([]);
    mockDeleteReturning.mockResolvedValueOnce([]);

    await handler({ step: { run: mockStepRun } });

    const stepNames = mockStepRun.mock.calls.map(
      (c: [string, () => Promise<unknown>]) => c[0]
    );
    expect(stepNames).toContain("mark-expired");
    expect(stepNames).toContain("delete-stale-terminal");
  });
});
