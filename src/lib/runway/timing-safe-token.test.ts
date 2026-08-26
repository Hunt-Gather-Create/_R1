import { describe, it, expect } from "vitest";
import { timingSafeTokenMatch } from "./timing-safe-token";

describe("timingSafeTokenMatch", () => {
  it("returns true for identical tokens", () => {
    expect(timingSafeTokenMatch("sekret_abc123", "sekret_abc123")).toBe(true);
  });

  it("returns false for a wrong token of equal length", () => {
    expect(timingSafeTokenMatch("sekret_abc123", "sekret_xyz999")).toBe(false);
  });

  it("returns false when lengths differ (no throw)", () => {
    expect(timingSafeTokenMatch("short", "muchlongertoken")).toBe(false);
  });

  it("returns false for an empty candidate against a real key", () => {
    expect(timingSafeTokenMatch("", "sekret_abc123")).toBe(false);
  });

  it("handles multibyte characters by comparing raw bytes", () => {
    expect(timingSafeTokenMatch("tökén", "tökén")).toBe(true);
    expect(timingSafeTokenMatch("tökén", "token")).toBe(false);
  });
});
