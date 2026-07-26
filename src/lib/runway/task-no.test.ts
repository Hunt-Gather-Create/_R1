/**
 * taskNo pure helpers — G3 coverage for plan §4.3 (SP-3 numeric parse).
 */

import { describe, it, expect } from "vitest";
import { parseTaskNo, computeNextTaskNo } from "./task-no";

describe("parseTaskNo", () => {
  it("splits prefix and trailing numeric component", () => {
    expect(parseTaskNo("3.2")).toEqual({ prefix: "3", trailing: 2 });
    expect(parseTaskNo("10.4.12")).toEqual({ prefix: "10.4", trailing: 12 });
  });

  it("handles bare numbers (no dot) with empty prefix", () => {
    expect(parseTaskNo("7")).toEqual({ prefix: "", trailing: 7 });
  });

  it("returns null for non-numeric trailing components", () => {
    expect(parseTaskNo("3.2a")).toBeNull();
    expect(parseTaskNo("TBD")).toBeNull();
    expect(parseTaskNo("")).toBeNull();
    expect(parseTaskNo("3.")).toBeNull();
  });
});

describe("computeNextTaskNo", () => {
  it("SP-3: numeric-parse beats lexicographic — max('3.9','3.10') appends 3.11", () => {
    expect(computeNextTaskNo(["3.9", "3.10"])).toBe("3.11");
  });

  it("appends max+1 with the sibling prefix", () => {
    expect(computeNextTaskNo(["2.1", "2.3", "2.2"])).toBe("2.4");
  });

  it("returns null when no sibling has a parseable taskNo (SP-2 basis)", () => {
    expect(computeNextTaskNo([null, null])).toBeNull();
    expect(computeNextTaskNo([])).toBeNull();
    expect(computeNextTaskNo(["TBD", null])).toBeNull();
  });

  it("skips unparseable siblings but continues the numeric sequence", () => {
    expect(computeNextTaskNo(["3.1", "junk", null, "3.5"])).toBe("3.6");
  });

  it("continues bare-number sequences without a prefix dot", () => {
    expect(computeNextTaskNo(["7", "9"])).toBe("10");
  });

  it("gap-preserving: deletion of 3.3 does not slot-fill (max+1 semantics)", () => {
    // Siblings after deleting "3.3" from [3.1..3.5]: next is 3.6, never 3.3.
    expect(computeNextTaskNo(["3.1", "3.2", "3.4", "3.5"])).toBe("3.6");
  });
});
