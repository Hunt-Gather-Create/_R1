/**
 * Issue #44 — AsyncLocalStorage clients-cache scoping.
 *
 * Load-bearing test is "concurrent withClientsCache scopes do not bleed
 * across async boundaries". Mirrors the runway-als.test.ts shape.
 */
import { describe, it, expect } from "vitest";
import {
  withClientsCache,
  getRequestClientsCache,
  setRequestClientsCache,
  invalidateRequestClientsCache,
  type ClientRow,
} from "./clients-cache-als";

const rowA = [
  { id: "cli_a", slug: "aaa" } as unknown as ClientRow,
];
const rowB = [
  { id: "cli_b", slug: "bbb" } as unknown as ClientRow,
];

describe("clients-cache-als", () => {
  it("returns null outside any withClientsCache scope", () => {
    expect(getRequestClientsCache()).toBeNull();
  });

  it("set / get within one scope round-trips the rows", async () => {
    await withClientsCache(async () => {
      expect(getRequestClientsCache()).toBeNull();
      setRequestClientsCache(rowA);
      expect(getRequestClientsCache()).toEqual(rowA);
    });
  });

  it("invalidateRequestClientsCache clears the slot for subsequent reads", async () => {
    await withClientsCache(async () => {
      setRequestClientsCache(rowA);
      invalidateRequestClientsCache();
      expect(getRequestClientsCache()).toBeNull();
    });
  });

  it("state does not leak after the scope resolves", async () => {
    await withClientsCache(async () => {
      setRequestClientsCache(rowA);
    });
    expect(getRequestClientsCache()).toBeNull();
  });

  it("setRequestClientsCache outside a scope is a safe no-op", () => {
    // Should not throw; should not create global state.
    setRequestClientsCache(rowA);
    expect(getRequestClientsCache()).toBeNull();
  });

  it("invalidateRequestClientsCache outside a scope is a safe no-op", () => {
    invalidateRequestClientsCache();
    expect(getRequestClientsCache()).toBeNull();
  });

  it("isolates concurrent withClientsCache scopes (the #44 bug fix)", async () => {
    async function loopAndSet(rows: ClientRow[], observed: ClientRow[][]) {
      setRequestClientsCache(rows);
      for (let i = 0; i < 25; i++) {
        observed.push(getRequestClientsCache() ?? []);
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    const observedA: ClientRow[][] = [];
    const observedB: ClientRow[][] = [];

    await Promise.all([
      withClientsCache(() => loopAndSet(rowA, observedA)),
      withClientsCache(() => loopAndSet(rowB, observedB)),
    ]);

    expect(observedA.every((v) => v === rowA)).toBe(true);
    expect(observedB.every((v) => v === rowB)).toBe(true);
    expect(observedA).toHaveLength(25);
    expect(observedB).toHaveLength(25);
  });

  it("supports nested withClientsCache — inner scope gets its own slot", async () => {
    await withClientsCache(async () => {
      setRequestClientsCache(rowA);
      expect(getRequestClientsCache()).toEqual(rowA);

      await withClientsCache(async () => {
        expect(getRequestClientsCache()).toBeNull();
        setRequestClientsCache(rowB);
        expect(getRequestClientsCache()).toEqual(rowB);
      });

      // Outer scope's slot is unchanged after inner scope resolves.
      expect(getRequestClientsCache()).toEqual(rowA);
    });
  });
});
