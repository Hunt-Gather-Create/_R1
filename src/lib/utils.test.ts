import { cn } from "./utils";

describe("cn", () => {
  it("merges class names correctly", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles conditional classes", () => {
    expect(cn("base", true && "included", false && "excluded")).toBe(
      "base included"
    );
  });

  it("handles undefined and null values", () => {
    expect(cn("base", undefined, null, "end")).toBe("base end");
  });

  it("handles arrays of class names", () => {
    expect(cn(["foo", "bar"], "baz")).toBe("foo bar baz");
  });

  it("handles objects with boolean values", () => {
    expect(cn({ foo: true, bar: false, baz: true })).toBe("foo baz");
  });

  it("resolves Tailwind conflicts with twMerge", () => {
    // Later classes should override earlier conflicting ones
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
    expect(cn("bg-red-100", "bg-blue-200")).toBe("bg-blue-200");
  });

  it("preserves non-conflicting Tailwind classes", () => {
    expect(cn("px-2", "py-4", "text-sm")).toBe("px-2 py-4 text-sm");
  });

  it("handles empty inputs", () => {
    expect(cn()).toBe("");
    expect(cn("")).toBe("");
  });
});
