import { describe, it, expect } from "vitest";
import { generateIdempotencyKey, generateId } from "./operations";

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
