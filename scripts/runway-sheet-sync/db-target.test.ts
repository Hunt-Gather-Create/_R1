/**
 * A run without --apply opens prod read-only, whatever flags it carries. Only
 * --apply may write, to prod or to runway-staging with --target staging. The
 * coverage and discovery CLIs read prod through the same read-only handle.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { runDatabase } from "./db-target";

const CLI = ["node", "runway-sheet-sync.ts"];
const DRY_RUN = { staging: false, readOnly: true };

describe("runDatabase", () => {
  it.each([
    [["--live"], undefined],
    [["--live", "--staging"], undefined],
    [[], undefined],
    [["--live", "--target", "staging"], "staging"],
    [["--live", "--apply", "--dry-run"], undefined],
    [["--apply", "--dry-run", "--target", "staging"], "staging"],
  ])("a run without --apply opens prod read-only: %j", (flags, target) => {
    expect(runDatabase([...CLI, ...flags], target)).toEqual(DRY_RUN);
  });

  it("an --apply run may write, and opens staging only for --target staging", () => {
    expect(runDatabase([...CLI, "--live", "--apply"], "staging")).toEqual({ staging: true, readOnly: false });
    expect(runDatabase([...CLI, "--live", "--apply"], undefined)).toEqual({ staging: false, readOnly: false });
  });
});

describe("the sync CLIs", () => {
  const read = (name: string) => readFileSync(join(__dirname, "..", name), "utf8");

  it("the sync CLI resolves its database through runDatabase and wraps a dry run read-only", () => {
    const source = read("runway-sheet-sync.ts");
    expect(source).toContain("const { staging, readOnly } = runDatabase(process.argv, target);");
    expect(source).toContain("createRunwayDb({ staging })");
    expect(source).toContain("readOnly ? readOnlyDb(opened.db) : opened.db");
    expect(source).toContain("const handle = apply ? db : readOnlyDb(db);");
    expect(source).not.toContain('includes("--staging")');
  });

  it.each(["runway-sheet-coverage.ts", "runway-sheet-discovery.ts"])("%s reads prod through a read-only handle", (name) => {
    const source = read(name);
    expect(source).toContain("liveDiscoveryDeps(readOnlyDb(createRunwayDb().db))");
    expect(source).not.toContain("staging: true");
  });
});
