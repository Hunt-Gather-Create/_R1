/**
 * _R1#167: proves the pre-push hygiene guard actually refuses on fossil
 * state, actually passes on clean state, resolves trunk from the repo
 * rather than a literal "main", fires as a real hook execution rather than
 * a library call nobody wires up, and refuses by exit code rather than by
 * printed text. Those are the five controls from the ticket, and no two of
 * them may be satisfied by the same evidence, which is the point of
 * listing them separately.
 *
 * A sixth control comes from the same-day addendum: a worktree whose
 * content is already in trunk but which ALSO holds uncommitted changes
 * must never be recommended for removal. The addendum's own incident,
 * Overwatch finding a 41-modified-file worktree the original spec would
 * have called cleanly disposable, is reproduced directly below rather than
 * only described.
 *
 * Fixtures are local, offline git repos built with execFileSync, same
 * shape as scripts/check-base-ancestry.test.ts, so the suite is
 * deterministic and never touches GitHub or the real worktree this suite
 * itself runs inside of.
 *
 * Every git call strips GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, and
 * GIT_COMMON_DIR, for the identical reason documented in
 * check-base-ancestry.test.ts: a hook process inherits those from git
 * itself, and leaving them set lets a fixture's git calls silently
 * resolve against the real repository running the suite instead of the
 * isolated tmp fixture.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkHygiene,
  formatResult,
  isContentPresentInTrunk,
  resolveGitCommonDir,
  resolveTrunk,
} from "./check-hygiene";

const SCRIPT_PATH = join(__dirname, "check-hygiene.ts");

const ISOLATED_GIT_ENV = { ...process.env };
delete ISOLATED_GIT_ENV.GIT_DIR;
delete ISOLATED_GIT_ENV.GIT_WORK_TREE;
delete ISOLATED_GIT_ENV.GIT_INDEX_FILE;
delete ISOLATED_GIT_ENV.GIT_COMMON_DIR;

const GIT_IDENTITY = [
  "-c",
  "user.name=hygiene-guard-test",
  "-c",
  "user.email=hygiene-guard-test@example.invalid",
  "-c",
  "gc.auto=0",
];

function git(args: string[], cwd: string, env: NodeJS.ProcessEnv = ISOLATED_GIT_ENV): string {
  return execFileSync("git", [...GIT_IDENTITY, ...args], { cwd, encoding: "utf8", env }).trim();
}

function writeFile(dir: string, name: string, content: string) {
  writeFileSync(join(dir, name), content);
}

/**
 * Builds a bare "origin" remote plus a working clone. trunkName is
 * deliberately configurable, and most tests use "trunk", not "main", per
 * the ticket's own measured fact that _R1's real trunk is "runway", not
 * "main". A guard whose test fixtures all happen to use "main" would not
 * exercise its own reason for existing.
 */
function buildRepo(root: string, trunkName: string) {
  const originDir = join(root, "origin.git");
  mkdirSync(originDir, { recursive: true });
  git(["init", "--quiet", "--bare", "-b", trunkName], originDir);

  const workDir = join(root, "work");
  git(["clone", "--quiet", originDir, workDir], root);
  git(["checkout", "--quiet", "-b", trunkName], workDir);
  writeFile(workDir, "README.md", "root\n");
  git(["add", "."], workDir);
  git(["commit", "--quiet", "-m", "root"], workDir);
  git(["push", "--quiet", "origin", `HEAD:${trunkName}`], workDir);
  git(["symbolic-ref", `refs/remotes/origin/HEAD`, `refs/remotes/origin/${trunkName}`], workDir);

  return { originDir, workDir };
}

/** Squash-merges a feature branch's single-file change into trunk on origin, simulating a real PR squash merge with no ancestor relationship preserved. */
function squashMergeToTrunk(workDir: string, trunkName: string, featureBranch: string) {
  git(["checkout", "--quiet", trunkName], workDir);
  git(["pull", "--quiet", "origin", trunkName], workDir);
  git(["merge", "--squash", featureBranch], workDir);
  git(["commit", "--quiet", "-m", `squash ${featureBranch}`], workDir);
  git(["push", "--quiet", "origin", trunkName], workDir);
}

describe("resolveTrunk", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "hygiene-trunk-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("resolves trunk from refs/remotes/origin/HEAD, for a trunk NOT named main", () => {
    const { workDir } = buildRepo(root, "runway");
    const result = resolveTrunk(workDir);
    expect(result).toEqual({ status: "resolved", trunkRef: "origin/runway", branchName: "runway" });
  });

  it("falls back to the live remote when the cached symref is missing", () => {
    const { workDir } = buildRepo(root, "runway");
    // Simulate a clone/worktree that never ran `git remote set-head origin -a`.
    git(["symbolic-ref", "--delete", "refs/remotes/origin/HEAD"], workDir);
    const result = resolveTrunk(workDir);
    expect(result).toEqual({ status: "resolved", trunkRef: "origin/runway", branchName: "runway" });
  });

  it("exits with an unresolved status, not a guess, when origin cannot be reached at all", () => {
    const workDir = join(root, "no-origin");
    mkdirSync(workDir, { recursive: true });
    git(["init", "--quiet", "-b", "runway"], workDir);
    git(["commit", "--quiet", "--allow-empty", "-m", "root"], workDir);
    // No "origin" remote configured at all.
    const result = resolveTrunk(workDir);
    expect(result.status).toBe("unresolved");
  });
});

describe("isContentPresentInTrunk, the reverse-apply primitive", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "hygiene-content-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("is true for a branch whose content is squash-merged into trunk, where --is-ancestor would wrongly say false", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "feature/squashed"], workDir);
    writeFile(workDir, "feature.txt", "feature content\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "feature work"], workDir);

    squashMergeToTrunk(workDir, "runway", "feature/squashed");
    git(["fetch", "--quiet", "origin"], workDir);

    // The real failure mode this ticket names: --is-ancestor exits 1 here
    // because squash merge never creates a real ancestor edge.
    expect(() =>
      execFileSync("git", ["merge-base", "--is-ancestor", "feature/squashed", "origin/runway"], {
        cwd: workDir,
        env: ISOLATED_GIT_ENV,
      }),
    ).toThrow();

    expect(isContentPresentInTrunk("feature/squashed", "origin/runway", workDir)).toBe(true);
  });

  it("is false for a branch with a real, unmerged change", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "feature/unmerged"], workDir);
    writeFile(workDir, "unmerged.txt", "never merged\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "unmerged work"], workDir);

    expect(isContentPresentInTrunk("feature/unmerged", "origin/runway", workDir)).toBe(false);
  });

  it("is false for a branch that MUTATES a squash-merged patch after the merge, not just for an unmerged one", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "feature/mutated"], workDir);
    writeFile(workDir, "mutated.txt", "original\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "original work"], workDir);

    squashMergeToTrunk(workDir, "runway", "feature/mutated");

    // Now the branch drifts further, after the point that got merged.
    git(["checkout", "--quiet", "feature/mutated"], workDir);
    writeFile(workDir, "mutated.txt", "changed after merge\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "post-merge drift"], workDir);
    git(["fetch", "--quiet", "origin"], workDir);

    expect(isContentPresentInTrunk("feature/mutated", "origin/runway", workDir)).toBe(false);
  });

  it("is false for a freshly created branch with zero commits ahead, even though its diff against trunk is empty (_R1#167 G1_BOUNCE)", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "feature/just-started"], workDir);
    expect(isContentPresentInTrunk("feature/just-started", "origin/runway", workDir)).toBe(false);
  });

  it("writes nothing to the caller's real working tree or index", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "feature/untouched"], workDir);
    writeFile(workDir, "untouched.txt", "should stay staged only on disk, never committed by the check\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "untouched work"], workDir);

    const statusBefore = git(["status", "--porcelain"], workDir);
    isContentPresentInTrunk("feature/untouched", "origin/runway", workDir);
    const statusAfter = git(["status", "--porcelain"], workDir);
    expect(statusAfter).toBe(statusBefore);
  });
});

describe("checkHygiene, control 1: refuses on a fossil state you construct", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "hygiene-fossil-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("flags a local branch whose content already landed in trunk via squash merge", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "fix/leftover"], workDir);
    writeFile(workDir, "leftover.txt", "leftover\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "leftover fix"], workDir);
    squashMergeToTrunk(workDir, "runway", "fix/leftover");
    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    const result = checkHygiene(workDir);
    expect(result.status).toBe("disposable");
    if (result.status === "disposable") {
      expect(result.items.some((i) => i.branch === "fix/leftover")).toBe(true);
    }
    const { exitCode } = formatResult(result);
    expect(exitCode).toBe(1);
  });

  it("flags a registered worktree whose branch already landed in trunk", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "fix/wt-leftover"], workDir);
    writeFile(workDir, "wt-leftover.txt", "leftover\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "wt leftover fix"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    const wtPath = join(root, "wt-leftover");
    git(["worktree", "add", "--quiet", wtPath, "fix/wt-leftover"], workDir);

    squashMergeToTrunk(workDir, "runway", "fix/wt-leftover");
    git(["fetch", "--quiet", "origin"], workDir);

    const result = checkHygiene(workDir);
    expect(result.status).toBe("disposable");
    if (result.status === "disposable") {
      const item = result.items.find((i) => i.branch === "fix/wt-leftover");
      expect(item?.kind).toBe("worktree");
      expect(item?.disposalCommand).toContain("git worktree remove --force");
      expect(item?.disposalCommand).toContain(wtPath);
    }
  });
});

describe("checkHygiene, control 2: exits clean on real clean state, same session", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "hygiene-clean-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("passes when the only branch is trunk itself", () => {
    const { workDir } = buildRepo(root, "runway");
    const result = checkHygiene(workDir);
    expect(result.status).toBe("clean");
    const { exitCode } = formatResult(result);
    expect(exitCode).toBe(0);
  });

  it("passes when a local branch has real, unmerged work", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "feature/in-flight"], workDir);
    writeFile(workDir, "in-flight.txt", "still working\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "in flight"], workDir);

    const result = checkHygiene(workDir);
    expect(result.status).toBe("clean");
  });

  it("passes when a zero-commit branch is present alongside trunk (_R1#167 G1_BOUNCE: control 2's prior fixtures could not tell this apart from a tidy repo)", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["branch", "feature/just-started"], workDir);

    const result = checkHygiene(workDir);
    expect(result.status).toBe("clean");
    const { exitCode } = formatResult(result);
    expect(exitCode).toBe(0);
  });
});

describe("checkHygiene, control 3: runs correctly in a repo other than the one it was written in, trunk not named main", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "hygiene-scratch-clone-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("a fresh scratch clone with trunk named 'trunk' (not main, not runway) still refuses on fossil state", () => {
    const { workDir } = buildRepo(root, "trunk");
    git(["checkout", "--quiet", "-b", "chore/scratch"], workDir);
    writeFile(workDir, "scratch.txt", "scratch\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "scratch work"], workDir);
    squashMergeToTrunk(workDir, "trunk", "chore/scratch");
    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "trunk"], workDir);

    const result = checkHygiene(workDir);
    expect(result.status).toBe("disposable");
    if (result.status === "disposable") {
      expect(result.trunkRef).toBe("origin/trunk");
    }
  });
});

describe("check-hygiene.ts and pre-push, control 4: actually executes, and control 5: refuses by exit code not text", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "hygiene-cli-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function runCli(cwd: string): { stdout: string; stderr: string; status: number } {
    try {
      const stdout = execFileSync(
        process.execPath,
        [
          "--experimental-strip-types",
          "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
          SCRIPT_PATH,
          cwd,
          "origin",
        ],
        { cwd, encoding: "utf8", env: ISOLATED_GIT_ENV },
      );
      return { stdout, stderr: "", status: 0 };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; status?: number };
      return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", status: e.status ?? -1 };
    }
  }

  it("the CLI subprocess call site exits 1, by exit code, on fossil state", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "fix/cli-leftover"], workDir);
    writeFile(workDir, "cli-leftover.txt", "leftover\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "cli leftover"], workDir);
    squashMergeToTrunk(workDir, "runway", "fix/cli-leftover");
    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    const { status, stderr } = runCli(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/REFUSE, FOSSIL STATE/);
  });

  it("the CLI subprocess call site exits 0 on clean state", () => {
    const { workDir } = buildRepo(root, "runway");
    const { status, stdout } = runCli(workDir);
    expect(status).toBe(0);
    expect(stdout).toMatch(/hygiene-guard: clean/);
  });

  it("the real pre-push hook, run as a real git hook subprocess via GIT_DIR, refuses a push on fossil state by exit code, ignoring any printed text", () => {
    const { originDir, workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "fix/hook-leftover"], workDir);
    writeFile(workDir, "hook-leftover.txt", "leftover\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "hook leftover"], workDir);
    squashMergeToTrunk(workDir, "runway", "fix/hook-leftover");
    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    // Point core.hooksPath at the repo's real scripts/hooks/, installed the
    // same way scripts/hooks/install.sh does, then fire a real `git push`
    // so the hook actually fires as a subprocess rather than being called
    // as a library function. RUNWAY_SKIP_PREPUSH is set so this exercises
    // only the hygiene guard step, not the (separately covered) test-suite
    // step, and proves the guard runs even when that skip flag is set.
    const hooksSrc = join(__dirname, "hooks");
    git(["config", "core.hooksPath", hooksSrc], workDir);
    // The real pre-push script resolves check-hygiene.ts relative to
    // `git rev-parse --show-toplevel` of the repo doing the pushing, this
    // fixture, not the real _R1 checkout this suite runs inside of. Copy
    // the actual script under test into the fixture so that path resolves,
    // the same layout install.sh assumes for any real clone.
    mkdirSync(join(workDir, "scripts"), { recursive: true });
    execFileSync("cp", [SCRIPT_PATH, join(workDir, "scripts", "check-hygiene.ts")]);

    let threw = false;
    let combinedOutput = "";
    try {
      execFileSync("git", ["push", "origin", "fix/hook-leftover:refs/heads/should-not-land"], {
        cwd: workDir,
        env: { ...ISOLATED_GIT_ENV, RUNWAY_SKIP_PREPUSH: "1" },
        encoding: "utf8",
      });
    } catch (err) {
      threw = true;
      const e = err as { stdout?: string; stderr?: string };
      // The hook's own echo lines land on the git subprocess's stdout, and
      // the guard's own console.error output lands on stderr; the test
      // only needs to know the hook actually ran, so check both.
      combinedOutput = `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
    }

    expect(threw).toBe(true);
    // Confirm by exit-code behavior (the push was refused, nothing new
    // landed on the remote), not by grepping the printed banner text.
    const remoteRefs = execFileSync("git", ["ls-remote", originDir], {
      cwd: workDir,
      encoding: "utf8",
      env: ISOLATED_GIT_ENV,
    });
    expect(remoteRefs).not.toMatch(/should-not-land/);
    expect(combinedOutput).toMatch(/pre-push/);
  });
});

describe("checkHygiene, addendum control 6: a content-present worktree that is ALSO dirty is never recommended for removal", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "hygiene-dirty-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("reports DISPOSABLE-BUT-DIRTY with the uncommitted count and emits NO removal command, but still refuses the push", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "fix/dirty-leftover"], workDir);
    writeFile(workDir, "dirty-leftover.txt", "leftover\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "leftover fix"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    const wtPath = join(root, "wt-dirty-leftover");
    git(["worktree", "add", "--quiet", wtPath, "fix/dirty-leftover"], workDir);

    // The branch's committed content lands in trunk via squash merge...
    squashMergeToTrunk(workDir, "runway", "fix/dirty-leftover");
    git(["fetch", "--quiet", "origin"], workDir);

    // ...but the worktree is reused afterward and picks up real,
    // uncommitted changes: the exact Overwatch-found shape (41 modified
    // tracked files), reproduced here as one modified plus one untracked
    // file, which is sufficient to prove the mechanism.
    writeFile(wtPath, "dirty-leftover.txt", "modified after the squash merge, never committed\n");
    writeFile(wtPath, "scratch-note.txt", "untracked scratch file\n");

    const result = checkHygiene(workDir);
    expect(result.status).toBe("disposable");
    if (result.status !== "disposable") throw new Error("unreachable");

    const item = result.items.find((i) => i.kind === "worktree-dirty" && i.branch === "fix/dirty-leftover");
    expect(item).toBeDefined();
    if (item?.kind !== "worktree-dirty") throw new Error("unreachable");
    expect(item.dirtyCount).toBe(2);

    const { message, exitCode } = formatResult(result);
    // Still refuses: the repo still needs a decision.
    expect(exitCode).toBe(1);
    // But NO removal command anywhere in the rendered message for this item.
    expect(message).toMatch(/DISPOSABLE-BUT-DIRTY/);
    expect(message).toMatch(/holds 2 uncommitted/);
    expect(message).not.toMatch(/git worktree remove --force .*wt-dirty-leftover/);
  });

  it("a clean worktree with the identical content-present branch DOES still get a removal command, proving the dirty check is what changed the outcome", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "fix/clean-leftover"], workDir);
    writeFile(workDir, "clean-leftover.txt", "leftover\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "leftover fix"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    const wtPath = join(root, "wt-clean-leftover");
    git(["worktree", "add", "--quiet", wtPath, "fix/clean-leftover"], workDir);
    squashMergeToTrunk(workDir, "runway", "fix/clean-leftover");
    git(["fetch", "--quiet", "origin"], workDir);
    // No modifications made in wtPath after this: it stays clean.

    const result = checkHygiene(workDir);
    expect(result.status).toBe("disposable");
    if (result.status !== "disposable") throw new Error("unreachable");
    const item = result.items.find((i) => i.branch === "fix/clean-leftover");
    expect(item?.kind).toBe("worktree");
    if (item?.kind !== "worktree") throw new Error("unreachable");
    expect(item.disposalCommand).toContain("git worktree remove --force");
  });
});

describe("checkHygiene, addendum control: prunable worktree records are always reported, dirty check does not apply", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "hygiene-prunable-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("a worktree record whose directory is gone is reported as prunable with `git worktree prune`, not scanned by directory position", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "chore/gone"], workDir);
    writeFile(workDir, "gone.txt", "will vanish\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "will vanish"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    const wtPath = join(root, "wt-gone");
    git(["worktree", "add", "--quiet", wtPath, "chore/gone"], workDir);
    // Simulate the exact fleet finding: the directory is removed by hand
    // (rm, not `git worktree remove`), leaving a dangling record.
    rmSync(wtPath, { recursive: true, force: true });

    const result = checkHygiene(workDir);
    expect(result.status).toBe("disposable");
    if (result.status !== "disposable") throw new Error("unreachable");
    const item = result.items.find((i) => i.kind === "worktree-prunable");
    expect(item).toBeDefined();
    if (item?.kind !== "worktree-prunable") throw new Error("unreachable");
    expect(item.disposalCommand).toBe("git worktree prune");
  });

  it("resolveGitCommonDir resolves the true parent repo, not the cwd's own directory position", () => {
    const { workDir } = buildRepo(root, "runway");
    const wtPath = join(root, "wt-common-dir-check");
    git(["checkout", "--quiet", "-b", "chore/common-dir"], workDir);
    git(["worktree", "add", "--quiet", "-b", "chore/common-dir-2", wtPath], workDir);

    // Asked from the LINKED worktree's own directory, the common dir must
    // still resolve back to the main repo's .git, not to something under
    // the linked worktree's own path.
    const commonDir = resolveGitCommonDir(wtPath);
    const mainCommonDir = resolveGitCommonDir(workDir);
    expect(commonDir).toBe(mainCommonDir);
    expect(commonDir).not.toContain("wt-common-dir-check");
  });
});

describe("checkHygiene, control 8: a brand-new branch is a starting point, not a fossil (_R1#167 G1_BOUNCE)", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "hygiene-fresh-branch-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("half A: a freshly created branch with zero commits does NOT cause a refusal, the ordinary first act of any ticket", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["branch", "feat/just-started"], workDir);

    const ahead = git(["rev-list", "--count", "origin/runway..feat/just-started"], workDir);
    expect(ahead).toBe("0");

    const result = checkHygiene(workDir);
    expect(result.status).toBe("clean");
    const { exitCode } = formatResult(result);
    expect(exitCode).toBe(0);
  });

  it("half B: the real squash-merged fossil still DOES cause a refusal after the fix, same run as half A", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "fix/real-fossil"], workDir);
    writeFile(workDir, "real-fossil.txt", "leftover\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "real fossil work"], workDir);
    squashMergeToTrunk(workDir, "runway", "fix/real-fossil");
    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    const ahead = git(["rev-list", "--count", "origin/runway..fix/real-fossil"], workDir);
    expect(Number(ahead)).toBeGreaterThan(0);

    const result = checkHygiene(workDir);
    expect(result.status).toBe("disposable");
    if (result.status === "disposable") {
      expect(result.items.some((i) => i.branch === "fix/real-fossil")).toBe(true);
    }
    const { exitCode } = formatResult(result);
    expect(exitCode).toBe(1);
  });
});

describe("mutation floor: the checks above can fail, and their failure is caused by the specific mechanism named", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "hygiene-mutation-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("breaking trunk resolution (comparing against the wrong ref) turns a real fossil into a false clean", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "fix/mut-trunk"], workDir);
    writeFile(workDir, "mut-trunk.txt", "leftover\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "mut trunk leftover"], workDir);
    squashMergeToTrunk(workDir, "runway", "fix/mut-trunk");
    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    // Control: the real check refuses.
    expect(checkHygiene(workDir).status).toBe("disposable");

    // Mutation: compare against a stale local branch instead of the real
    // trunk ref. This is the literal shape of "hardcode main and never
    // re-resolve" the ticket warns about: a branch that is genuinely
    // disposable against origin/runway reads as not-present against a
    // ref that never received the squash-merge commit.
    git(["branch", "stale-runway", "runway~0"], workDir);
    // stale-runway currently equals runway, so force it stale by resetting
    // to the pre-merge commit.
    const preMergeSha = git(["rev-parse", "runway~1"], workDir);
    git(["branch", "-f", "stale-runway", preMergeSha], workDir);

    expect(isContentPresentInTrunk("fix/mut-trunk", "stale-runway", workDir)).toBe(false);
  });

  it("breaking the content check to the forward form (apply-then-compare-tree-hash) goes RED for the exact reason the ticket names: a failed apply is indistinguishable from a no-op one", () => {
    const { workDir } = buildRepo(root, "runway");

    // The forward form's blind spot needs the SAME file to diverge on both
    // sides of history: the branch changes it one way, trunk changes it
    // another way after the branch forked. Then the branch's forward patch
    // no longer finds its expected context in trunk's tree, `git apply`
    // fails outright, the scratch index is left exactly equal to trunk's
    // (untouched), and the buggy tree-hash comparison reads that failure
    // as "already applied, no-op" rather than as a failure. A simple
    // new-file addition, with no such divergence, would apply cleanly and
    // wouldn't exercise the bug at all.
    git(["checkout", "--quiet", "-b", "feature/should-not-be-flagged"], workDir);
    writeFile(workDir, "README.md", "feature content, never in trunk\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "real unmerged work"], workDir);

    git(["checkout", "--quiet", "runway"], workDir);
    writeFile(workDir, "README.md", "trunk diverged independently\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "trunk diverges"], workDir);
    git(["push", "--quiet", "origin", "runway"], workDir);
    git(["fetch", "--quiet", "origin"], workDir);

    // Control: the real, reverse-apply check correctly says NOT present.
    expect(isContentPresentInTrunk("feature/should-not-be-flagged", "origin/runway", workDir)).toBe(false);

    // Mutation: the forward form. Apply the diff to a scratch index seeded
    // from trunk, then compare the resulting tree hash to trunk's tree
    // hash. A failed `git apply` leaves the scratch index untouched, so its
    // tree hash still equals trunk's, and this buggy primitive reports
    // "present" for a branch that plainly is not.
    const forwardFormBuggyCheck = (ref: string, trunkRef: string, cwd: string): boolean => {
      const base = execFileSync("git", GIT_IDENTITY.concat(["merge-base", ref, trunkRef]), {
        cwd,
        encoding: "utf8",
        env: ISOLATED_GIT_ENV,
      }).trim();
      const diff = execFileSync("git", ["diff", base, ref], {
        cwd,
        encoding: "utf8",
        env: ISOLATED_GIT_ENV,
      });
      const scratchDir = mkdtempSync(join(tmpdir(), "forward-form-"));
      try {
        const patchFile = join(scratchDir, "patch.diff");
        const scratchIndex = join(scratchDir, "index");
        writeFileSync(patchFile, diff);
        const env = { ...ISOLATED_GIT_ENV, GIT_INDEX_FILE: scratchIndex };
        execFileSync("git", ["read-tree", trunkRef], { cwd, env });
        const trunkTreeHash = execFileSync("git", ["write-tree"], { cwd, env, encoding: "utf8" }).trim();
        try {
          execFileSync("git", ["apply", "--cached", patchFile], { cwd, env });
        } catch {
          // Apply failed; index is untouched. The buggy form does not
          // distinguish this from "already applied, no-op".
        }
        const resultTreeHash = execFileSync("git", ["write-tree"], { cwd, env, encoding: "utf8" }).trim();
        return resultTreeHash === trunkTreeHash;
      } finally {
        rmSync(scratchDir, { recursive: true, force: true });
      }
    };

    // The mutant misapplies (fails to apply cleanly, since trunk's tree
    // doesn't have real-work.txt's base content in a form the forward
    // patch expects to land on top of) and, per the bug, reports present.
    expect(forwardFormBuggyCheck("feature/should-not-be-flagged", "origin/runway", workDir)).toBe(true);
  });

  it("breaking the exit-code check (reading the wrong end of a piped command) goes RED the way the ticket's own incident did", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "fix/pipe-mut"], workDir);
    writeFile(workDir, "pipe-mut.txt", "leftover\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "pipe mut leftover"], workDir);
    squashMergeToTrunk(workDir, "runway", "fix/pipe-mut");
    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    // Control: real CLI, run directly (no pipe), exits 1.
    const direct = (() => {
      try {
        execFileSync(
          process.execPath,
          ["--experimental-strip-types", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", SCRIPT_PATH, workDir, "origin"],
          { cwd: workDir, encoding: "utf8", env: ISOLATED_GIT_ENV },
        );
        return 0;
      } catch (err) {
        return (err as { status?: number }).status ?? -1;
      }
    })();
    expect(direct).toBe(1);

    // Mutation: the exact bug named in the ticket, `cmd | head` then `$?`,
    // reads head's exit status, not the guard's. head on a nonempty stream
    // exits 0 regardless of what it received, so this always "passes".
    // Redirect the guard's stderr into the pipe too (2>&1), matching how a
    // naive caller would capture "the output" without separating streams,
    // then echo the masked status so this test can read it without relying
    // on execFileSync's own throw/no-throw behavior.
    const pipedOutput = execFileSync(
      "sh",
      [
        "-c",
        `node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "${SCRIPT_PATH}" "${workDir}" origin 2>&1 | head -1; echo "MASKED_EXIT:$?"`,
      ],
      { cwd: workDir, encoding: "utf8", env: ISOLATED_GIT_ENV },
    );
    const maskedStatus = pipedOutput.match(/MASKED_EXIT:(\d+)/)?.[1];
    // head's own exit status, 0, is what `$?` reads here, masking the
    // guard's real exit 1 even though the guard genuinely refused.
    expect(maskedStatus).toBe("0");
    expect(direct).not.toBe(0);
  });
});
