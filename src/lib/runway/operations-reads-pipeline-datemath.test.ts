import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * DST-boundary regression guard (issue #43, TP gate condition b).
 *
 * The pipeline staleness window is computed with immutable millisecond math
 * (`new Date(nowMs - N * 24 * 60 * 60 * 1000)`), NOT mutable `Date.setDate`.
 * Mutable `.setDate` day arithmetic is a DST hazard and was the original
 * concern in #43. This tripwire fails if a `.setDate` mutation is ever
 * reintroduced into the pipeline reads, so the fix stays fixed.
 */
describe("operations-reads-pipeline date math stays immutable (DST guard)", () => {
  const source = readFileSync(
    join(__dirname, "operations-reads-pipeline.ts"),
    "utf-8"
  );

  it("uses no mutable .setDate() day arithmetic", () => {
    expect(source).not.toMatch(/\.setDate\s*\(/);
  });

  it("computes the staleness window with immutable millisecond math", () => {
    // Guards against a refactor that silently drops the immutable pattern.
    expect(source).toMatch(/new Date\(\s*nowMs\s*-/);
  });
});
