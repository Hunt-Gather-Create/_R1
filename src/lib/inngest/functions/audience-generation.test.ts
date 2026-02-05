import { describe, it, expect } from "vitest";
import { generateUniqueFirstNames } from "./audience-generation";

describe("generateUniqueFirstNames", () => {
  it("returns the requested number of names", () => {
    const names = generateUniqueFirstNames(10);
    expect(names).toHaveLength(10);
  });

  it("returns all unique names", () => {
    const names = generateUniqueFirstNames(10);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it("returns capitalized names", () => {
    const names = generateUniqueFirstNames(5);
    for (const name of names) {
      expect(name[0]).toBe(name[0].toUpperCase());
    }
  });

  it("returns an empty array when count is 0", () => {
    const names = generateUniqueFirstNames(0);
    expect(names).toEqual([]);
  });

  it("returns a single name when count is 1", () => {
    const names = generateUniqueFirstNames(1);
    expect(names).toHaveLength(1);
    expect(typeof names[0]).toBe("string");
    expect(names[0].length).toBeGreaterThan(0);
  });

  it("maintains uniqueness at larger counts", () => {
    const names = generateUniqueFirstNames(50);
    const unique = new Set(names);
    expect(unique.size).toBe(50);
  });
});
