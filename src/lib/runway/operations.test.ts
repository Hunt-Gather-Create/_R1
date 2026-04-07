import { describe, it, expect } from "vitest";
import { generateIdempotencyKey, generateId, clientNotFoundError, groupBy, matchesSubstring } from "./operations";

describe("generateIdempotencyKey", () => {
  it("returns a 40-char hex string", () => {
    const key = generateIdempotencyKey("a", "b", "c");
    expect(key).toHaveLength(40);
    expect(key).toMatch(/^[0-9a-f]{40}$/);
  });

  it("is deterministic for the same inputs", () => {
    const key1 = generateIdempotencyKey("status-change", "proj1", "done", "kathy");
    const key2 = generateIdempotencyKey("status-change", "proj1", "done", "kathy");
    expect(key1).toBe(key2);
  });

  it("produces different keys for different inputs", () => {
    const key1 = generateIdempotencyKey("status-change", "proj1", "done", "kathy");
    const key2 = generateIdempotencyKey("status-change", "proj1", "blocked", "kathy");
    expect(key1).not.toBe(key2);
  });

  it("is sensitive to input order", () => {
    const key1 = generateIdempotencyKey("a", "b");
    const key2 = generateIdempotencyKey("b", "a");
    expect(key1).not.toBe(key2);
  });

  it("handles single input", () => {
    const key = generateIdempotencyKey("single");
    expect(key).toHaveLength(40);
    expect(key).toMatch(/^[0-9a-f]{40}$/);
  });

  it("handles empty string inputs", () => {
    const key = generateIdempotencyKey("", "", "");
    expect(key).toHaveLength(40);
  });
});

describe("generateId", () => {
  it("returns a 25-char hex string", () => {
    const id = generateId();
    expect(id).toHaveLength(25);
    expect(id).toMatch(/^[0-9a-f]{25}$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

describe("clientNotFoundError", () => {
  it("returns ok: false with slug in error message", () => {
    const result = clientNotFoundError("convergix");
    expect(result).toEqual({
      ok: false,
      error: "Client 'convergix' not found.",
    });
  });

  it("includes the slug exactly as provided", () => {
    const result = clientNotFoundError("some-slug");
    expect(result.error).toContain("some-slug");
  });
});

describe("groupBy", () => {
  it("groups items by key function", () => {
    const items = [
      { name: "a", group: 1 },
      { name: "b", group: 2 },
      { name: "c", group: 1 },
    ];
    const result = groupBy(items, (i) => i.group);
    expect(result.get(1)).toEqual([
      { name: "a", group: 1 },
      { name: "c", group: 1 },
    ]);
    expect(result.get(2)).toEqual([{ name: "b", group: 2 }]);
  });

  it("returns empty map for empty input", () => {
    const result = groupBy([], (i: string) => i);
    expect(result.size).toBe(0);
  });

  it("handles single-item groups", () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const result = groupBy(items, (i) => i.id);
    expect(result.size).toBe(3);
    for (const [, group] of result) {
      expect(group).toHaveLength(1);
    }
  });

  it("works with string keys", () => {
    const items = ["apple", "avocado", "banana"];
    const result = groupBy(items, (s) => s[0]);
    expect(result.get("a")).toEqual(["apple", "avocado"]);
    expect(result.get("b")).toEqual(["banana"]);
  });
});

describe("matchesSubstring", () => {
  it("matches case-insensitively", () => {
    expect(matchesSubstring("Kathy/Lane", "kathy")).toBe(true);
  });

  it("matches partial strings", () => {
    expect(matchesSubstring("Kathy/Lane", "Lane")).toBe(true);
  });

  it("returns false for null value", () => {
    expect(matchesSubstring(null, "Kathy")).toBe(false);
  });

  it("returns false for undefined value", () => {
    expect(matchesSubstring(undefined, "Kathy")).toBe(false);
  });

  it("returns false when no match", () => {
    expect(matchesSubstring("Leslie", "Kathy")).toBe(false);
  });

  it("matches exact string", () => {
    expect(matchesSubstring("Daniel", "Daniel")).toBe(true);
  });
});
