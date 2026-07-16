import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the main app DB with insert().values() and update().set().where() chains.
// Terminal promises flip between resolve/reject per test to exercise
// success and failure paths through each tracker.
//
// vi.mock factories are hoisted above imports, so shared state must live in
// vi.hoisted() to be reachable from the factory. Local module state after
// the mock definitions can then re-derive references from the hoisted block.
const { mockInsertValues, mockUpdateWhere, mockDb } = vi.hoisted(() => {
  const mockInsertValues = vi.fn<() => Promise<void>>();
  const mockUpdateWhere = vi.fn<() => Promise<void>>();

  const insertChain = {
    values: (payload: unknown) => {
      void payload;
      return mockInsertValues();
    },
  };

  const updateChain = {
    set: (payload: unknown) => {
      void payload;
      return {
        where: (cond: unknown) => {
          void cond;
          return mockUpdateWhere();
        },
      };
    },
  };

  const mockDb = {
    insert: vi.fn(() => insertChain),
    update: vi.fn(() => updateChain),
  };

  return { mockInsertValues, mockUpdateWhere, mockDb };
});

vi.mock("@/lib/db", () => ({
  db: mockDb,
}));

vi.mock("../client", () => ({
  inngest: {
    createFunction: (_config: unknown, _trigger: unknown, handler: unknown) => ({
      config: _config,
      trigger: _trigger,
      handler,
    }),
  },
}));

import {
  trackFunctionInvoked,
  trackFunctionFinished,
  trackFunctionFailed,
} from "./job-tracker";

type Handler = (arg: { event: { data: Record<string, unknown> } }) => Promise<unknown>;

const invokedHandler = (trackFunctionInvoked as unknown as { handler: Handler }).handler;
const finishedHandler = (trackFunctionFinished as unknown as { handler: Handler }).handler;
const failedHandler = (trackFunctionFailed as unknown as { handler: Handler }).handler;

const invokedArg = {
  event: {
    data: {
      function_id: "some-function",
      run_id: "run-abc",
      event: { data: { workspaceId: "ws-1" } },
    },
  },
};

const finishedArg = {
  event: {
    data: {
      function_id: "some-function",
      run_id: "run-abc",
      result: { ok: true },
    },
  },
};

const failedArg = {
  event: {
    data: {
      function_id: "some-function",
      run_id: "run-abc",
      error: { message: "boom" },
    },
  },
};

describe("job-tracker DB write resilience (#2)", () => {
  beforeEach(() => {
    mockInsertValues.mockReset();
    mockUpdateWhere.mockReset();
  });

  it("trackFunctionInvoked returns tracked on DB success", async () => {
    mockInsertValues.mockResolvedValueOnce(undefined);
    const res = await invokedHandler(invokedArg);
    expect(res).toEqual({ tracked: true, runId: "run-abc" });
  });

  it("trackFunctionInvoked swallows DB failure, logs structured warning, returns skipped", async () => {
    mockInsertValues.mockRejectedValueOnce(new Error("db down"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await invokedHandler(invokedArg);

    expect(res).toEqual({ skipped: true, reason: "db_write_failed" });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(warnSpy.mock.calls[0]![0] as string);
    expect(logged).toMatchObject({
      event: "job_tracker_write_failed",
      tracker: "invoked",
      runId: "run-abc",
      error: "db down",
    });

    warnSpy.mockRestore();
  });

  it("trackFunctionFinished returns updated on DB success", async () => {
    mockUpdateWhere.mockResolvedValueOnce(undefined);
    const res = await finishedHandler(finishedArg);
    expect(res).toEqual({ updated: true, runId: "run-abc" });
  });

  it("trackFunctionFinished swallows DB failure, logs structured warning, returns skipped", async () => {
    mockUpdateWhere.mockRejectedValueOnce(new Error("timeout"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await finishedHandler(finishedArg);

    expect(res).toEqual({ skipped: true, reason: "db_write_failed" });
    const logged = JSON.parse(warnSpy.mock.calls[0]![0] as string);
    expect(logged.tracker).toBe("finished");
    expect(logged.runId).toBe("run-abc");
    expect(logged.error).toBe("timeout");

    warnSpy.mockRestore();
  });

  it("trackFunctionFailed returns updated + error on DB success", async () => {
    mockUpdateWhere.mockResolvedValueOnce(undefined);
    const res = await failedHandler(failedArg);
    expect(res).toEqual({
      updated: true,
      runId: "run-abc",
      error: "boom",
    });
  });

  it("trackFunctionFailed swallows DB failure, logs structured warning, returns skipped", async () => {
    mockUpdateWhere.mockRejectedValueOnce(new Error("locked"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await failedHandler(failedArg);

    expect(res).toEqual({ skipped: true, reason: "db_write_failed" });
    const logged = JSON.parse(warnSpy.mock.calls[0]![0] as string);
    expect(logged.tracker).toBe("failed");

    warnSpy.mockRestore();
  });

  it("trackFunctionInvoked short-circuits self-tracker calls before touching DB", async () => {
    const res = await invokedHandler({
      event: {
        data: {
          function_id: "job-tracker-invoked",
          run_id: "run-x",
          event: { data: { workspaceId: "ws-1" } },
        },
      },
    });
    expect(res).toEqual({ skipped: true, reason: "tracker function" });
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("trackFunctionInvoked short-circuits when workspaceId missing", async () => {
    const res = await invokedHandler({
      event: {
        data: {
          function_id: "some-function",
          run_id: "run-x",
          event: { data: {} },
        },
      },
    });
    expect(res).toEqual({ skipped: true, reason: "no workspaceId in event data" });
    expect(mockInsertValues).not.toHaveBeenCalled();
  });
});
