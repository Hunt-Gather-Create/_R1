/**
 * A run without --apply opens staging, never prod, whatever flags it carries.
 * A --live dry run writes sheet_sync_ledger rows, so the database it opens is
 * the database those rows land in.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { opensStaging } from "./db-target";

const CLI = ["node", "runway-sheet-sync.ts"];

describe("opensStaging", () => {
  it.each([
    [["--live"]],
    [["--live", "--staging"]],
    [[]],
    [["--live", "--target", "staging"]],
    [["--live", "--apply", "--dry-run"]],
  ])("a run without --apply opens staging: %j", (flags) => {
    expect(opensStaging([...CLI, ...flags], undefined)).toBe(true);
  });

  it("an --apply run opens staging only for --target staging", () => {
    expect(opensStaging([...CLI, "--live", "--apply"], "staging")).toBe(true);
    expect(opensStaging([...CLI, "--live", "--apply"], undefined)).toBe(false);
  });
});

describe("the sync CLI", () => {
  const source = readFileSync(join(__dirname, "..", "runway-sheet-sync.ts"), "utf8");

  it("resolves its database through opensStaging and reads no --staging flag of its own", () => {
    expect(source).toContain("const staging = opensStaging(process.argv, target);");
    expect(source).toContain("createRunwayDb({ staging })");
    expect(source).not.toContain('includes("--staging")');
  });
});
