import { describe, it, expect } from "vitest";
import { isNextSentinelError } from "./is-next-sentinel-error";

describe("isNextSentinelError", () => {
  describe("returns true for real Next sentinel shapes", () => {
    it("returns true for an Error with the actual NEXT_REDIRECT digest format", () => {
      const err = Object.assign(new Error("NEXT_REDIRECT"), {
        digest: "NEXT_REDIRECT;replace;/login;303;",
      });
      expect(isNextSentinelError(err)).toBe(true);
    });

    it("returns true for an Error with a NEXT_NOT_FOUND digest", () => {
      const err = Object.assign(new Error("NEXT_NOT_FOUND"), {
        digest: "NEXT_NOT_FOUND",
      });
      expect(isNextSentinelError(err)).toBe(true);
    });

    it("returns true for an Error with a DYNAMIC_SERVER_USAGE digest", () => {
      const err = Object.assign(new Error("DYNAMIC_SERVER_USAGE"), {
        digest: "DYNAMIC_SERVER_USAGE",
      });
      expect(isNextSentinelError(err)).toBe(true);
    });

    it("returns true for a plain object { digest: 'NEXT_REDIRECT' } (no Error inheritance)", () => {
      // Next sentinels can theoretically arrive as non-Error objects via
      // RSC serialization boundaries; the guard only inspects the digest field.
      expect(isNextSentinelError({ digest: "NEXT_REDIRECT" })).toBe(true);
    });

    it("returns true for a single-character non-empty string digest", () => {
      // The contract is `length > 0`, not "matches a known prefix". Any non-empty
      // string is treated as a sentinel; guarding against unknown prefixes is
      // intentionally not the helper's job.
      expect(isNextSentinelError({ digest: "x" })).toBe(true);
    });
  });

  describe("returns false for non-string digest types", () => {
    it("returns false when digest is a number", () => {
      const err = Object.assign(new Error("e"), { digest: 42 });
      expect(isNextSentinelError(err)).toBe(false);
    });

    it("returns false when digest is a boolean", () => {
      const err = Object.assign(new Error("e"), { digest: true });
      expect(isNextSentinelError(err)).toBe(false);
    });

    it("returns false when digest is a nested object", () => {
      const err = Object.assign(new Error("e"), {
        digest: { nested: "obj" },
      });
      expect(isNextSentinelError(err)).toBe(false);
    });

    it("returns false when digest is an array", () => {
      const err = Object.assign(new Error("e"), { digest: ["NEXT_REDIRECT"] });
      expect(isNextSentinelError(err)).toBe(false);
    });

    it("returns false when digest is a function", () => {
      const err = Object.assign(new Error("e"), { digest: () => "NEXT" });
      expect(isNextSentinelError(err)).toBe(false);
    });

    it("returns false when digest is a Symbol", () => {
      const err = Object.assign(new Error("e"), {
        digest: Symbol("NEXT_REDIRECT"),
      });
      expect(isNextSentinelError(err)).toBe(false);
    });

    it("returns false when digest is null", () => {
      const err = Object.assign(new Error("e"), { digest: null });
      expect(isNextSentinelError(err)).toBe(false);
    });

    it("returns false when digest is undefined", () => {
      const err = Object.assign(new Error("e"), { digest: undefined });
      expect(isNextSentinelError(err)).toBe(false);
    });
  });

  describe("returns false for empty-string digest", () => {
    it("returns false when digest is the empty string", () => {
      // No real Next sentinel has an empty digest; the length > 0 check
      // protects against accidental control-flow on empty values.
      const err = Object.assign(new Error("e"), { digest: "" });
      expect(isNextSentinelError(err)).toBe(false);
    });
  });

  describe("returns false for non-object error values", () => {
    it("returns false for null", () => {
      expect(isNextSentinelError(null)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(isNextSentinelError(undefined)).toBe(false);
    });

    it("returns false for a bare string", () => {
      expect(isNextSentinelError("a bare string error")).toBe(false);
    });

    it("returns false for a number", () => {
      expect(isNextSentinelError(42)).toBe(false);
    });

    it("returns false for a boolean", () => {
      expect(isNextSentinelError(true)).toBe(false);
    });

    it("returns false for a Symbol", () => {
      expect(isNextSentinelError(Symbol("x"))).toBe(false);
    });
  });

  describe("returns false for objects without a digest field", () => {
    it("returns false for a plain Error with no digest", () => {
      expect(isNextSentinelError(new Error("plain"))).toBe(false);
    });

    it("returns false for a plain object literal with unrelated fields", () => {
      expect(isNextSentinelError({ message: "no digest here" })).toBe(false);
    });

    it("returns false for an empty object", () => {
      expect(isNextSentinelError({})).toBe(false);
    });
  });
});
