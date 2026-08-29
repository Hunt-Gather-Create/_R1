import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression guard for _R1#114: vitest.config.mts had no `exclude`, so
 * running the suite from a checkout that has sibling git worktrees under
 * `.worktrees/`, which every builder in this fleet does, collects and
 * runs each worktree's copy of every test file too, on whatever branch
 * that worktree happens to be sitting on. That produced the exact "green
 * here, red there, identical commits" shape #111 was filed for, one layer
 * up: the main checkout failed a suite that every worktree passed,
 * because it was also running four other worktrees' stale copies of the
 * same test.
 *
 * This asserts on the COLLECTED FILE LIST, not the run result. A green
 * suite is exactly what this bug produces from inside a worktree with no
 * nested worktrees of its own, so a passing `vitest run` proves nothing.
 * The list comes from `vitest list`, the same collection path the real
 * test run uses, not a hand-rolled glob resolution that could drift from
 * vitest's actual behavior.
 */
const ROOT = process.cwd();
const FIXTURE_REL = ".worktrees/vitest-exclude-fixture-114";
const FIXTURE_ABS = join(ROOT, FIXTURE_REL);
const FIXTURE_BRANCH = "chore/114-vitest-exclude-fixture-temp";

function collectTestFilePaths(filterPattern: string): string[] {
  const output = execFileSync(
    "pnpm",
    ["vitest", "list", filterPattern, "--reporter=verbose"],
    { cwd: ROOT, encoding: "utf8" },
  );
  const paths = new Set<string>();
  for (const line of output.split("\n")) {
    const [filePath] = line.split(" > ");
    if (filePath && filePath.trim()) paths.add(filePath.trim());
  }
  return Array.from(paths);
}

function removeFixtureWorktree(): void {
  if (existsSync(FIXTURE_ABS)) {
    execFileSync("git", ["worktree", "remove", "--force", FIXTURE_REL], { cwd: ROOT });
  }
  try {
    execFileSync("git", ["branch", "-D", FIXTURE_BRANCH], { cwd: ROOT, stdio: "pipe" });
  } catch {
    // Branch may not exist if a prior run already cleaned up, fine.
  }
}

describe("vitest config: worktree exclusion, _R1#114", () => {
  it(
    "does not collect test files from nested .worktrees/ directories",
    () => {
      // Clean slate in case a prior interrupted run left the fixture behind.
      removeFixtureWorktree();

      execFileSync(
        "git",
        ["worktree", "add", FIXTURE_REL, "-b", FIXTURE_BRANCH, "HEAD"],
        { cwd: ROOT },
      );

      try {
        const paths = collectTestFilePaths("source-coverage");
        const offenders = paths.filter((p) => p.includes(".worktrees/"));
        expect(
          offenders,
          `Expected no collected test file to sit inside a .worktrees/ directory, ` +
            `but found:\n${offenders.join("\n")}\n\nFull collected list:\n${paths.join("\n")}`,
        ).toEqual([]);
      } finally {
        removeFixtureWorktree();
        expect(existsSync(FIXTURE_ABS)).toBe(false);
      }
    },
    30_000,
  );

  it(
    "still excludes node_modules from collection, proving the fix did not replace configDefaults.exclude",
    () => {
      // Plants a real, matching test file inside a node_modules directory,
      // the same technique used above for .worktrees/, rather than relying
      // on whatever incidental .test.ts files happen to ship inside real
      // npm packages. This is a plain directory outside .worktrees/, not
      // the symlinked top-level node_modules shared with other worktrees
      // and the main checkout, so planting here never touches shared state.
      // A fix that replaces `exclude` outright instead of spreading
      // configDefaults would pass the .worktrees/ test above and still be
      // wrong; only this fixture, confined to node_modules and outside
      // .worktrees/, catches that specific regression.
      const nmFixtureRel = "tmp-114-node-modules-fixture/node_modules/fake-package";
      const nmFixtureAbs = join(ROOT, nmFixtureRel);
      const nmFixtureFile = join(nmFixtureAbs, "fixture-114-nm-check.test.ts");
      const nmFixtureRoot = join(ROOT, "tmp-114-node-modules-fixture");

      if (existsSync(nmFixtureRoot)) rmSync(nmFixtureRoot, { recursive: true, force: true });
      mkdirSync(nmFixtureAbs, { recursive: true });
      writeFileSync(
        nmFixtureFile,
        `import { it, expect } from "vitest";\nit("fixture-114-nm-check placeholder", () => { expect(true).toBe(true); });\n`,
      );

      try {
        const paths = collectTestFilePaths("fixture-114-nm-check");
        const offenders = paths.filter((p) => p.includes("node_modules/"));
        expect(
          offenders,
          `Expected the planted node_modules fixture to be excluded from collection, ` +
            `but it was collected:\n${paths.join("\n")}`,
        ).toEqual([]);
      } finally {
        rmSync(nmFixtureRoot, { recursive: true, force: true });
        expect(existsSync(nmFixtureRoot)).toBe(false);
      }
    },
    30_000,
  );
});
