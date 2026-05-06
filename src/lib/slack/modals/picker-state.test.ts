/**
 * Tests for the shared picker-state predicate (Wave 6 / Fix 6.2).
 *
 * Locks the per-kind field contract so a future schema rename doesn't
 * silently break the modal builders' disambiguation gate.
 */
import { describe, it, expect } from "vitest";
import { hasPickedEntity } from "./picker-state";

describe("hasPickedEntity", () => {
  describe("task", () => {
    it("returns true when currentValues.title is a non-empty string", () => {
      expect(hasPickedEntity({ title: "Concept Writeup" }, "task")).toBe(true);
    });

    it("returns false when currentValues.title is empty string", () => {
      expect(hasPickedEntity({ title: "" }, "task")).toBe(false);
    });

    it("returns false when currentValues.title is missing", () => {
      expect(hasPickedEntity({ clientId: "client_x" }, "task")).toBe(false);
    });

    it("returns false when currentValues.title is non-string", () => {
      expect(hasPickedEntity({ title: 123 }, "task")).toBe(false);
      expect(hasPickedEntity({ title: null }, "task")).toBe(false);
    });
  });

  describe("project", () => {
    it("returns true when currentValues.name is a non-empty string", () => {
      expect(hasPickedEntity({ name: "Brand Refresh" }, "project")).toBe(true);
    });

    it("returns false when currentValues.name is empty string", () => {
      expect(hasPickedEntity({ name: "" }, "project")).toBe(false);
    });

    it("returns false when currentValues.name is missing", () => {
      expect(hasPickedEntity({ clientId: "client_x" }, "project")).toBe(false);
    });

    it("does NOT treat task title as project picked", () => {
      expect(hasPickedEntity({ title: "Concept Writeup" }, "project")).toBe(
        false,
      );
    });
  });

  describe("team-member", () => {
    it("returns true when fullName is a non-empty string", () => {
      expect(
        hasPickedEntity({ fullName: "Lane Carter" }, "team-member"),
      ).toBe(true);
    });

    it("returns true when only legacy name is set", () => {
      expect(hasPickedEntity({ name: "Riley" }, "team-member")).toBe(true);
    });

    it("returns true when both fullName and name are set", () => {
      expect(
        hasPickedEntity({ fullName: "Riley S", name: "Riley" }, "team-member"),
      ).toBe(true);
    });

    it("returns false when both are missing", () => {
      expect(
        hasPickedEntity({ clientId: "client_x" }, "team-member"),
      ).toBe(false);
    });

    it("returns false when both are empty strings", () => {
      expect(
        hasPickedEntity({ fullName: "", name: "" }, "team-member"),
      ).toBe(false);
    });
  });

  describe("null / undefined edges", () => {
    it("returns false when currentValues is undefined", () => {
      expect(hasPickedEntity(undefined, "task")).toBe(false);
      expect(hasPickedEntity(undefined, "project")).toBe(false);
      expect(hasPickedEntity(undefined, "team-member")).toBe(false);
    });

    it("returns false when currentValues is null", () => {
      expect(hasPickedEntity(null, "task")).toBe(false);
      expect(hasPickedEntity(null, "project")).toBe(false);
      expect(hasPickedEntity(null, "team-member")).toBe(false);
    });

    it("returns false when currentValues is empty object", () => {
      expect(hasPickedEntity({}, "task")).toBe(false);
      expect(hasPickedEntity({}, "project")).toBe(false);
      expect(hasPickedEntity({}, "team-member")).toBe(false);
    });
  });
});
