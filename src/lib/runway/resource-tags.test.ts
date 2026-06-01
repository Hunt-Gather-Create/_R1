import { describe, expect, it } from "vitest";
import {
  ROLE_TAGS,
  parseResourceChips,
  serializeResourceChips,
  type ResourceChip,
} from "./resource-tags";

describe("ROLE_TAGS", () => {
  it("exposes the canonical 7-role set in operator-locked order", () => {
    expect([...ROLE_TAGS]).toEqual([
      "AM",
      "CD",
      "Dev",
      "CW",
      "PM",
      "CM",
      "Strat",
    ]);
  });
});

describe("parseResourceChips", () => {
  it("parses a single 'Role: Name' entry", () => {
    expect(parseResourceChips("AM: Jill")).toEqual([
      { role: "AM", name: "Jill" },
    ]);
  });

  it("parses the standard comma-separated 'Role: Name' format operator locked", () => {
    expect(parseResourceChips("AM: Jill, CD: Mark")).toEqual([
      { role: "AM", name: "Jill" },
      { role: "CD", name: "Mark" },
    ]);
  });

  it("trims whitespace around role and name", () => {
    expect(parseResourceChips("  AM :   Jill  ,   CD :   Mark  ")).toEqual([
      { role: "AM", name: "Jill" },
      { role: "CD", name: "Mark" },
    ]);
  });

  it("returns an empty list for null, undefined, or empty input", () => {
    expect(parseResourceChips(null)).toEqual([]);
    expect(parseResourceChips(undefined)).toEqual([]);
    expect(parseResourceChips("")).toEqual([]);
    expect(parseResourceChips("   ")).toEqual([]);
  });

  it("reports parsability=false when the string includes an arrow sequence (advanced form)", () => {
    // Arrow sequences (e.g. "CW: Kathy -> Dev: Lane") are valid in the
    // canonical operations-utils parser but the chip editor doesn't model
    // them. Caller falls back to free-text editing when this happens.
    expect(parseResourceChips("CW: Kathy -> Dev: Lane")).toEqual([]);
    expect(parseResourceChips("CW: Kathy → Dev: Lane")).toEqual([]);
  });

  it("returns an empty list when an entry lacks a role prefix (untagged is not chip-shaped)", () => {
    expect(parseResourceChips("Jill")).toEqual([]);
    expect(parseResourceChips("AM: Jill, Mark")).toEqual([]);
  });
});

describe("serializeResourceChips", () => {
  it("serializes chips to the operator-locked 'Role: Name, Role: Name' string", () => {
    const chips: ResourceChip[] = [
      { role: "AM", name: "Jill" },
      { role: "CD", name: "Mark" },
    ];
    expect(serializeResourceChips(chips)).toBe("AM: Jill, CD: Mark");
  });

  it("returns an empty string when no chips are supplied (lets caller write null on save)", () => {
    expect(serializeResourceChips([])).toBe("");
  });

  it("drops chips whose name is empty so an in-progress add-chip row doesn't leak 'Role: ' into the save string", () => {
    const chips: ResourceChip[] = [
      { role: "AM", name: "Jill" },
      { role: "CD", name: "" },
      { role: "Dev", name: "  " },
    ];
    expect(serializeResourceChips(chips)).toBe("AM: Jill");
  });

  it("round-trips a parsed string back to the original (preserving the format operator expects)", () => {
    const original = "AM: Jill, CD: Mark, Dev: Lane";
    expect(serializeResourceChips(parseResourceChips(original))).toBe(original);
  });
});
