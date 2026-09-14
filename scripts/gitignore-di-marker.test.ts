/**
 * _R1#168: the two DI-TP .gitignore lines are scoped to a single calendar
 * month each (2026-06, 2026-09), so a DI working script written in any
 * other month is neither tracked nor ignored, and `git status` cannot
 * distinguish that from a working rule. The durable fix, named in the
 * .gitignore comment this ticket replaces, is a filename marker: a
 * `.di.ts` suffix, one glob, no date, forever.
 *
 * Every check here runs `git check-ignore -v` against a fresh temp clone
 * of this worktree's own HEAD, never the live checkout, per the ticket's
 * explicit instruction. `git check-ignore` reports purely on pattern
 * match; the fixture paths below do not need to exist on disk.
 *
 * Every git call strips GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE/
 * GIT_COMMON_DIR from the spawned process's environment, the same
 * scrub check-base-ancestry.test.ts documents: git push's own pre-push
 * hook runs with those variables set in its process environment, and an
 * unstripped clone silently redirects onto the real worktree instead of
 * the isolated tmp fixture.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ISOLATED_GIT_ENV = { ...process.env };
delete ISOLATED_GIT_ENV.GIT_DIR;
delete ISOLATED_GIT_ENV.GIT_WORK_TREE;
delete ISOLATED_GIT_ENV.GIT_INDEX_FILE;
delete ISOLATED_GIT_ENV.GIT_COMMON_DIR;

const GIT_IDENTITY = [
  "-c",
  "user.name=gate-test",
  "-c",
  "user.email=gate-test@example.invalid",
  "-c",
  "gc.auto=0",
];

function git(args: string[], cwd: string): string {
  return execFileSync("git", [...GIT_IDENTITY, ...args], {
    cwd,
    encoding: "utf8",
    env: ISOLATED_GIT_ENV,
  }).trim();
}

/** Exit code and matched-rule line from `git check-ignore -v <path>`, run against `cwd`. */
function checkIgnore(path: string, cwd: string): { ignored: boolean; verbose: string } {
  try {
    const out = execFileSync("git", [...GIT_IDENTITY, "check-ignore", "-v", path], {
      cwd,
      encoding: "utf8",
      env: ISOLATED_GIT_ENV,
    });
    return { ignored: true, verbose: out.trim() };
  } catch (err) {
    const e = err as { status?: number; stdout?: string };
    if (e.status === 1) {
      return { ignored: false, verbose: "" };
    }
    throw err;
  }
}

describe("gitignore DI-TP marker, _R1#168", () => {
  let root: string;
  let tipDir: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "gitignore-di-marker-"));
    // rev-parse from this file's own directory: works whether the suite
    // runs from the main checkout or a worktree, since --show-toplevel
    // resolves a worktree's own working directory, not the shared gitdir.
    const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: __dirname,
      encoding: "utf8",
      env: ISOLATED_GIT_ENV,
    }).trim();
    const headSha = git(["rev-parse", "HEAD"], repoRoot);
    tipDir = join(root, "tip-clone");
    execFileSync("git", ["clone", "--quiet", repoRoot, tipDir], { env: ISOLATED_GIT_ENV });
    git(["checkout", "--quiet", headSha], tipDir);
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("ignores a DI-TP working script carrying the .di.ts marker", () => {
    const { ignored, verbose } = checkIgnore("scripts/runway-migrations/x-2026-10-01.di.ts", tipDir);
    expect(ignored).toBe(true);
    expect(verbose).toMatch(/scripts\/runway-migrations\/\*\.di\.ts/);
  });

  it("does not ignore the same path without the .di.ts marker", () => {
    const { ignored } = checkIgnore("scripts/runway-migrations/x-2026-10-01.ts", tipDir);
    expect(ignored).toBe(false);
  });

  it("no longer ignores the old month-scoped shape, proving the dated lines are gone", () => {
    const { ignored } = checkIgnore("scripts/runway-migrations/x-2026-06-01.ts", tipDir);
    expect(ignored).toBe(false);
  });

  it("the marked and unmarked arms report opposite exit codes, both stated before either runs", () => {
    const markedExpected = true;
    const trackedExpected = false;
    const marked = checkIgnore("scripts/runway-migrations/x-2026-10-01.di.ts", tipDir);
    const tracked = checkIgnore("scripts/runway-migrations/kathy-real-migration-2026-10-01.ts", tipDir);
    expect(marked.ignored).toBe(markedExpected);
    expect(tracked.ignored).toBe(trackedExpected);
    expect(marked.ignored).not.toBe(tracked.ignored);
  });

  it("swallows none of the currently tracked migration files", () => {
    const tracked = git(["ls-files", "scripts/runway-migrations/"], tipDir)
      .split("\n")
      .filter((line) => line.endsWith(".ts"));
    expect(tracked.length).toBeGreaterThan(0);

    let anyIgnored = false;
    try {
      execFileSync("git", [...GIT_IDENTITY, "check-ignore", "--stdin", "-v"], {
        cwd: tipDir,
        input: tracked.join("\n"),
        encoding: "utf8",
        env: ISOLATED_GIT_ENV,
      });
      anyIgnored = true;
    } catch (err) {
      const e = err as { status?: number };
      if (e.status !== 1) {
        throw err;
      }
    }
    expect(anyIgnored).toBe(false);
  });
});
