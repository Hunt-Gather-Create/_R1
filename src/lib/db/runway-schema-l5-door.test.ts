/**
 * L5-door regression guard (Delta A, runway-schema-change-plan-v4-delta-a.md §4).
 *
 * The v4 plan (§3.4) architects the L5 door as a COMMENTED-OUT drizzle column
 * on week_items — `parentTaskId` stays a comment until an operator decision
 * ships it. This test greps the schema source and fails if anyone uncomments
 * it (which would silently change the live schema surface without a plan
 * revision or migration).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SCHEMA_PATH = join(__dirname, "runway-schema.ts");

describe("L5 door stays commented (v4 §3.4)", () => {
  const source = readFileSync(SCHEMA_PATH, "utf8");
  const lines = source.split("\n");

  it("the parentTaskId door comment is still present", () => {
    const doorLines = lines.filter(
      (l) => l.includes("parentTaskId") && l.includes('text("parent_task_id")'),
    );
    expect(doorLines.length).toBe(1);
  });

  it("every parentTaskId column reference is commented out", () => {
    const uncommented = lines.filter(
      (l) =>
        l.includes('text("parent_task_id")') && !l.trimStart().startsWith("//"),
    );
    expect(uncommented).toEqual([]);
  });
});
