/**
 * Issue #17 — AsyncLocalStorage batch id scoping.
 *
 * The load-bearing test is "concurrent withBatchId calls do not bleed across
 * async boundaries". Two interleaved scopes must each see only their own id.
 */
import { describe, it, expect } from "vitest";
import { withBatchId, getCurrentBatchId } from "./runway-als";

describe("runway-als — withBatchId / getCurrentBatchId", () => {
  it("returns null outside any withBatchId scope", () => {
    expect(getCurrentBatchId()).toBeNull();
  });

  it("returns the batch id inside withBatchId", async () => {
    const observed = await withBatchId("batch-1", async () => getCurrentBatchId());
    expect(observed).toBe("batch-1");
  });

  it("falls back to null after withBatchId resolves", async () => {
    await withBatchId("batch-1", async () => {
      expect(getCurrentBatchId()).toBe("batch-1");
    });
    expect(getCurrentBatchId()).toBeNull();
  });

  it("isolates concurrent withBatchId scopes (the bug fix)", async () => {
    // Drive two parallel scopes that interleave with await setImmediate so
    // the runtime forcibly yields between reads. The module-level pattern
    // before #17 would bleed; ALS keeps each scope distinct.
    async function loop(id: string, observed: string[]) {
      for (let i = 0; i < 25; i++) {
        observed.push(getCurrentBatchId() ?? "(null)");
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    const observedA: string[] = [];
    const observedB: string[] = [];

    await Promise.all([
      withBatchId("A", () => loop("A", observedA)),
      withBatchId("B", () => loop("B", observedB)),
    ]);

    expect(observedA.every((v) => v === "A")).toBe(true);
    expect(observedB.every((v) => v === "B")).toBe(true);
    expect(observedA).toHaveLength(25);
    expect(observedB).toHaveLength(25);
  });

  it("supports nested withBatchId — inner overrides outer for the inner scope", async () => {
    const [outerObserved, innerObserved, afterInner] = await withBatchId(
      "outer",
      async () => {
        const outer = getCurrentBatchId();
        const inner = await withBatchId("inner", async () => getCurrentBatchId());
        const after = getCurrentBatchId();
        return [outer, inner, after];
      },
    );
    expect(outerObserved).toBe("outer");
    expect(innerObserved).toBe("inner");
    expect(afterInner).toBe("outer");
  });
});
