import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withRunwayRetry, __test } from "./retry";

const { isTransientNetworkError } = __test;

describe("isTransientNetworkError", () => {
  it("returns true for top-level ECONNRESET code", () => {
    const err = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    expect(isTransientNetworkError(err)).toBe(true);
  });

  it("returns true when ECONNRESET lives on the cause chain", () => {
    // Mirrors the real libsql/drizzle wrapping observed in the prod stack
    // trace: outer = drizzle error, .cause = FetchError with code ECONNRESET.
    const cause = Object.assign(new Error("request to ... failed, reason: socket hang up"), {
      type: "system",
      errno: "ECONNRESET",
      code: "ECONNRESET",
    });
    const err = Object.assign(new Error("Failed query: select ..."), { cause });
    expect(isTransientNetworkError(err)).toBe(true);
  });

  it("returns true for ETIMEDOUT", () => {
    const err = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    expect(isTransientNetworkError(err)).toBe(true);
  });

  it("returns true when ENOTFOUND lives on the cause chain", () => {
    // Mirrors the real cold-start stack captured 2026-05-08 against the
    // free-tier Turso host: drizzle outer + FetchError inner with
    // type: 'system', code: 'ENOTFOUND'. DNS lookup miss that resolves
    // by the time the second attempt fires.
    const cause = Object.assign(
      new Error(
        "request to https://runway-jasonburks.aws-us-east-1.turso.io/v2/pipeline failed, reason: getaddrinfo ENOTFOUND runway-jasonburks.aws-us-east-1.turso.io",
      ),
      { type: "system", errno: "ENOTFOUND", code: "ENOTFOUND" },
    );
    const err = Object.assign(new Error("Failed query: select ... from clients ..."), { cause });
    expect(isTransientNetworkError(err)).toBe(true);
  });

  it("returns true on 'fetch failed' message even without a code", () => {
    expect(isTransientNetworkError(new Error("fetch failed"))).toBe(true);
  });

  it("returns false for SQL/data errors (no transient signal)", () => {
    const err = Object.assign(new Error("UNIQUE constraint failed: clients.slug"), {
      code: "SQLITE_CONSTRAINT_UNIQUE",
    });
    expect(isTransientNetworkError(err)).toBe(false);
  });

  it("returns false for plain validation errors", () => {
    expect(isTransientNetworkError(new Error("Invalid input"))).toBe(false);
  });

  it("returns false for non-error values", () => {
    expect(isTransientNetworkError(null)).toBe(false);
    expect(isTransientNetworkError(undefined)).toBe(false);
    expect(isTransientNetworkError("string error")).toBe(false);
    expect(isTransientNetworkError(42)).toBe(false);
  });
});

describe("withRunwayRetry", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("returns the result on first try without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRunwayRetry(fn, "test");
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("retries on transient ECONNRESET and returns on second try", async () => {
    const transient = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce("ok");
    const result = await withRunwayRetry(fn, "getCachedClients");
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("getCachedClients");
    expect(warnSpy.mock.calls[0]?.[0]).toContain("attempt 1/3");
  });

  it("retries on cause-chain ECONNRESET (real-world wrapping)", async () => {
    const cause = Object.assign(new Error("socket hang up"), {
      type: "system",
      code: "ECONNRESET",
    });
    const wrapped = Object.assign(new Error("Failed query: select ..."), { cause });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(wrapped)
      .mockResolvedValueOnce(["row"]);
    const result = await withRunwayRetry(fn, "test");
    expect(result).toEqual(["row"]);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("re-throws the original error after exhausting all attempts", async () => {
    const transient = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    const fn = vi.fn().mockRejectedValue(transient);
    await expect(withRunwayRetry(fn, "test")).rejects.toBe(transient);
    expect(fn).toHaveBeenCalledTimes(3);
    // 2 retry warnings (attempt 1 and attempt 2); attempt 3 doesn't warn,
    // it just throws since there's nothing left to retry.
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry non-transient errors — propagates immediately", async () => {
    const sqlErr = Object.assign(new Error("UNIQUE constraint failed"), {
      code: "SQLITE_CONSTRAINT_UNIQUE",
    });
    const fn = vi.fn().mockRejectedValue(sqlErr);
    await expect(withRunwayRetry(fn, "test")).rejects.toBe(sqlErr);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does NOT retry generic non-network Error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("Bad request"));
    await expect(withRunwayRetry(fn, "test")).rejects.toThrow("Bad request");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // Coverage for the getViewPreferences read path. The 2026-05-08 prod
  // ECONNRESET stack trace pointed at view_preferences.ts:63 — that read
  // is now wrapped in withRunwayRetry("getViewPreferences"). Mirrors the
  // existing getCachedClients case so the label surfaces in the warn log
  // when the wrap actually fires.
  it("retries the view-preferences read path on transient ECONNRESET", async () => {
    const transient = Object.assign(new Error("socket hang up"), {
      code: "ECONNRESET",
    });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce([{ scope: "global", preferences: "{}" }]);
    const result = await withRunwayRetry(fn, "getViewPreferences");
    expect(result).toEqual([{ scope: "global", preferences: "{}" }]);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("getViewPreferences");
  });

  it("does NOT retry view-preferences `no such table` (caller catches it)", async () => {
    // view_preferences.ts has a try/catch that swallows SQLITE_ERROR `no such
    // table` and falls back to defaults. That error is non-transient — the
    // retry helper must propagate it on the first attempt so the caller's
    // catch fires immediately and does not stall on retries+backoff.
    const noTable = Object.assign(
      new Error("SQLITE_ERROR: no such table: view_preferences"),
      { code: "SQLITE_ERROR" },
    );
    const fn = vi.fn().mockRejectedValue(noTable);
    await expect(withRunwayRetry(fn, "getViewPreferences")).rejects.toBe(noTable);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
