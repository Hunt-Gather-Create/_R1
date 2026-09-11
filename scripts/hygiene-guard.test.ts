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
 * must never be recommended for removal. A seventh addendum covers
 * prunable worktree records. Control 8, added on the G1_BOUNCE that also
 * produced this rewrite, proves a brand-new zero-commit branch is not
 * mistaken for a fossil.
 *
 * This suite drives scripts/hygiene-guard.sh, the ONE implementation, by
 * subprocess: execFileSync, asserting on exit code as the primary verdict
 * (control 5's own rule: read the exit code, not printed text). An earlier
 * pass on this ticket also shipped a TypeScript port with its own unit-level
 * tests calling its functions directly. That let two independent
 * implementations exist with nothing comparing their verdicts, which
 * `opeff#870` already names as its own defect class. The TypeScript port is
 * deleted rather than kept in sync; this suite now exercises the shipped
 * shell script exactly the way the real pre-push hook does, and every
 * scenario that used to assert on an internal function's return value now
 * asserts on the guard's exit code and, where useful for the test itself
 * (never for the guard's own logic) its printed BLOCK/clean text.
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
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT_PATH = join(__dirname, "hygiene-guard.sh");

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
  // Suppresses git's own background auto-gc during fixture setup. This is
  // here to stop an accidental race -- a fixture repo's rapid-fire commits
  // and squash-merges can trip git's own gc.auto threshold mid-test and
  // repack while a later command in the same test is still reading loose
  // objects -- not because auto-gc behavior is itself something this
  // suite is testing or controlling for. Do not read this line as a
  // control on gc; it is a determinism guard for the harness alone.
  "-c",
  "gc.auto=0",
  // Local-path submodules (control 23) need this on modern git (2.38+
  // disallows the "file" transport by default). Harmless for every other
  // test: it only relaxes what THIS test harness's own git invocations may
  // do, never the guard script under test, which runs as its own process.
  "-c",
  "protocol.file.allow=always",
];

function git(args: string[], cwd: string, env: NodeJS.ProcessEnv = ISOLATED_GIT_ENV): string {
  return execFileSync("git", [...GIT_IDENTITY, ...args], { cwd, encoding: "utf8", env }).trim();
}

function writeFile(dir: string, name: string, content: string) {
  writeFileSync(join(dir, name), content);
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface GuardResult {
  status: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs the real, shipped shell guard as a subprocess, the way pre-push does.
 * extraEnv layers on top of ISOLATED_GIT_ENV rather than replacing it -- used
 * by control 17 to add a GIT_TRACE-family variable to an otherwise normal
 * caller environment, the exact way a developer debugging git would trigger
 * it, without losing the PATH/HOME isolation the rest of the suite relies on.
 */
function runGuard(
  cwd: string,
  remote = "origin",
  scriptPath = SCRIPT_PATH,
  extraEnv: NodeJS.ProcessEnv = {},
): GuardResult {
  try {
    const stdout = execFileSync("sh", [scriptPath, cwd, remote], {
      cwd,
      encoding: "utf8",
      env: { ...ISOLATED_GIT_ENV, ...extraEnv },
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { status: e.status ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

/**
 * Runs the real, shipped guard with an explicit pre-push ref-update stream
 * on stdin -- the "<local ref> <local sha> <remote ref> <remote sha>" lines
 * git itself provides. Every other test in this suite calls runGuard,
 * which supplies execFileSync's own default stdin (a pipe closed with
 * immediate EOF, never a tty): that is real, honest "nothing piped in"
 * coverage for the orphan-detection trigger, not an accidental gap, so it
 * is left alone rather than switched to this helper everywhere.
 */
function runGuardWithStdin(
  cwd: string,
  stdin: string,
  remote = "origin",
  scriptPath = SCRIPT_PATH,
  env: NodeJS.ProcessEnv = ISOLATED_GIT_ENV,
): GuardResult {
  try {
    const stdout = execFileSync("sh", [scriptPath, cwd, remote], {
      cwd,
      encoding: "utf8",
      env,
      input: stdin,
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { status: e.status ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

/**
 * Builds a bare "origin" remote plus a working clone. trunkName is
 * deliberately configurable, and most tests use "trunk", not "main", per
 * the ticket's own measured fact that _R1's real trunk is "runway", not
 * "main". A guard whose test fixtures all happen to use "main" would not
 * exercise its own reason for existing.
 *
 * The root commit also adds a placeholder scripts/hygiene-guard.sh, unless
 * withGuardMarker is false. That file's first-add commit on trunk IS the
 * guard's install point (_R1#167 ruling 1: only branches forked at or after
 * install are governed). Installing it at the root commit means every
 * existing test in this suite, which creates its fossil/clean branches
 * AFTER buildRepo returns, is exercising a governed branch by default,
 * without needing to know the install-point mechanism exists. Tests that
 * specifically exercise install-point scoping use withGuardMarker=false and
 * installGuardMarker() below to control exactly when the marker commit lands.
 */
function buildRepo(root: string, trunkName: string, withGuardMarker = true, withHoldFile = true) {
  const originDir = join(root, "origin.git");
  mkdirSync(originDir, { recursive: true });
  git(["init", "--quiet", "--bare", "-b", trunkName], originDir);

  const workDir = join(root, "work");
  git(["clone", "--quiet", originDir, workDir], root);
  git(["checkout", "--quiet", "-b", trunkName], workDir);
  writeFile(workDir, "README.md", "root\n");
  if (withGuardMarker) {
    mkdirSync(join(workDir, "scripts"), { recursive: true });
    writeFile(workDir, "scripts/hygiene-guard.sh", "#!/bin/sh\n# placeholder for install-point tests\n");
  }
  if (withHoldFile) {
    // Present but empty: the guard's genuine, silent "zero holds" state.
    // Every existing test in this suite predates the hold-list addition
    // and exercises no hold at all, so buildRepo ships one by default,
    // same shape as withGuardMarker for the install point. Tests that
    // specifically exercise the hold list use withHoldFile=false plus
    // writeHoldFile()/appendHoldEntry() below to control its content.
    writeFile(workDir, ".hygiene-hold", "");
  }
  git(["add", "."], workDir);
  git(["commit", "--quiet", "-m", "root"], workDir);
  git(["push", "--quiet", "origin", `HEAD:${trunkName}`], workDir);
  git(["symbolic-ref", `refs/remotes/origin/HEAD`, `refs/remotes/origin/${trunkName}`], workDir);

  return { originDir, workDir };
}

/**
 * Sets the hold list's content on trunk as a new commit, pushed to origin.
 * Used with buildRepo(..., withHoldFile=false) so a test controls exactly
 * what the tracked hold list contains, including malformed content or its
 * total absence (never call this at all, and pass withHoldFile=false, to
 * get a repo whose trunk never had the file).
 */
function writeHoldFile(workDir: string, trunkName: string, content: string) {
  git(["checkout", "--quiet", trunkName], workDir);
  writeFile(workDir, ".hygiene-hold", content);
  git(["add", ".hygiene-hold"], workDir);
  git(["commit", "--quiet", "-m", "update hold list"], workDir);
  git(["push", "--quiet", "origin", trunkName], workDir);
}

/**
 * Adds scripts/hygiene-guard.sh to trunk as a new commit, pushed to origin.
 * Used with buildRepo(..., false) to control exactly when the guard's
 * install point lands relative to other branch/commit activity, which
 * buildRepo's own root-commit default can't express.
 */
function installGuardMarker(workDir: string, trunkName: string): string {
  git(["checkout", "--quiet", trunkName], workDir);
  mkdirSync(join(workDir, "scripts"), { recursive: true });
  writeFile(workDir, "scripts/hygiene-guard.sh", "#!/bin/sh\n# placeholder for install-point tests\n");
  git(["add", "."], workDir);
  git(["commit", "--quiet", "-m", "install hygiene guard"], workDir);
  git(["push", "--quiet", "origin", trunkName], workDir);
  return git(["rev-parse", "HEAD"], workDir);
}

/** Squash-merges a feature branch's single-file change into trunk on origin, simulating a real PR squash merge with no ancestor relationship preserved. */
function squashMergeToTrunk(workDir: string, trunkName: string, featureBranch: string) {
  git(["checkout", "--quiet", trunkName], workDir);
  git(["pull", "--quiet", "origin", trunkName], workDir);
  git(["merge", "--squash", featureBranch], workDir);
  git(["commit", "--quiet", "-m", `squash ${featureBranch}`], workDir);
  git(["push", "--quiet", "origin", trunkName], workDir);
}

describe("hygiene-guard.sh, trunk resolution, exercised through the guard's exit code", () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "hygiene-trunk-")));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("resolves trunk from refs/remotes/origin/HEAD for a trunk NOT named main, then correctly finds no fossil", () => {
    const { workDir } = buildRepo(root, "runway");
    const { status, stdout } = runGuard(workDir);
    expect(status).toBe(0);
    expect(stdout).toMatch(/clean/);
  });

  it("falls back to the live remote when the cached symref is missing, and still catches a real fossil through it", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "fix/fallback-leftover"], workDir);
    writeFile(workDir, "fallback-leftover.txt", "leftover\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "fallback leftover"], workDir);
    squashMergeToTrunk(workDir, "runway", "fix/fallback-leftover");
    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    // Simulate a clone/worktree that never ran `git remote set-head origin -a`.
    git(["symbolic-ref", "--delete", "refs/remotes/origin/HEAD"], workDir);

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/fix\/fallback-leftover/);
  });

  it("refuses without guessing, not a fossil verdict, when origin cannot be reached at all", () => {
    const workDir = join(root, "no-origin");
    mkdirSync(workDir, { recursive: true });
    git(["init", "--quiet", "-b", "runway"], workDir);
    git(["commit", "--quiet", "--allow-empty", "-m", "root"], workDir);
    // No "origin" remote configured at all.

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    // Diagnostic only, to prove this is the "could not resolve trunk" path
    // and not a coincidental fossil match: the guard's own pass/fail
    // decision the test cares about is still the exit code above.
    expect(stderr).toMatch(/could not resolve trunk/);
  });
});

/**
 * Runs the real, shipped guard with an explicit trunk-branch override, the
 * 5th positional argument added for _R1#171. guard-path and hold-path (3rd,
 * 4th args) are passed as empty strings, not omitted, to reach the 5th
 * position while keeping their own defaults: "${3:-default}" in POSIX sh
 * treats an empty string the same as unset, exactly the "empty means
 * unset, never passed through" contract this ticket also requires of
 * pre-push's own config reads.
 */
function runGuardWithTrunkOverride(cwd: string, remote: string, trunkOverride: string): GuardResult {
  try {
    const stdout = execFileSync("sh", [SCRIPT_PATH, cwd, remote, "", "", trunkOverride], {
      cwd,
      encoding: "utf8",
      env: ISOLATED_GIT_ENV,
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { status: e.status ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

describe("hygiene-guard.sh, control 24: explicit trunk-branch override, 5th positional arg (_R1#171)", () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "hygiene-trunk-override-")));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("an override naming the same branch HEAD would have resolved anyway still finds the install point and reports clean", () => {
    const { workDir } = buildRepo(root, "runway");
    const { status, stdout } = runGuardWithTrunkOverride(workDir, "origin", "runway");
    expect(status).toBe(0);
    expect(stdout).toMatch(/clean/);
  });

  it("an override naming a branch that does not exist as <remote>/<branch> REFUSES by name, and does not fall back to HEAD-derived resolution", () => {
    // origin/HEAD resolves to "runway" here, and "runway" is clean (no
    // fossil, guard installed). If the override silently fell back to
    // HEAD-derived resolution on failure, this would incorrectly report
    // exit 0 clean; the fix must refuse instead.
    const { workDir } = buildRepo(root, "runway");
    const { status, stderr } = runGuardWithTrunkOverride(workDir, "origin", "does-not-exist");
    expect(status).toBe(1);
    expect(stderr).toMatch(/configured trunk branch 'does-not-exist' does not resolve as 'origin\/does-not-exist'/);
    expect(stderr).not.toMatch(/clean/);
  });

  it("an override naming a DIFFERENT real branch than HEAD's default actually switches resolution, proven by a distinct install-point refusal naming that branch", () => {
    // "runway" (HEAD's default) has the guard installed and is clean.
    // "other-trunk" is a second real branch on origin that does NOT carry
    // the guard file. An override that merely validated the ref existed,
    // without actually being used for TRUNK_REF, would still resolve
    // against "runway" and report clean -- this proves the override value
    // itself drives every downstream lookup, not just the existence check.
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "--orphan", "other-trunk"], workDir);
    git(["rm", "-rf", "--quiet", "."], workDir);
    writeFile(workDir, "README.md", "other trunk, no guard installed\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "other-trunk root"], workDir);
    git(["push", "--quiet", "origin", "other-trunk"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    const defaultResolved = runGuardWithTrunkOverride(workDir, "origin", "runway");
    expect(defaultResolved.status).toBe(0);

    const { status, stderr } = runGuardWithTrunkOverride(workDir, "origin", "other-trunk");
    expect(status).toBe(1);
    expect(stderr).toMatch(/could not resolve an install point: no commit on origin\/other-trunk adds/);
  });
});

describe("hygiene-guard.sh, the reverse-apply primitive, exercised through the guard's exit code", () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "hygiene-content-")));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses on a branch whose content is squash-merged into trunk, where --is-ancestor would wrongly say false", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "feature/squashed"], workDir);
    writeFile(workDir, "feature.txt", "feature content\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "feature work"], workDir);

    squashMergeToTrunk(workDir, "runway", "feature/squashed");
    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    // The real failure mode this ticket names: --is-ancestor exits 1 here
    // because squash merge never creates a real ancestor edge.
    expect(() =>
      execFileSync("git", ["merge-base", "--is-ancestor", "feature/squashed", "origin/runway"], {
        cwd: workDir,
        env: ISOLATED_GIT_ENV,
      }),
    ).toThrow();

    const { status } = runGuard(workDir);
    expect(status).toBe(1);
  });

  it("passes on a branch with a real, unmerged change", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "feature/unmerged"], workDir);
    writeFile(workDir, "unmerged.txt", "never merged\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "unmerged work"], workDir);

    const { status } = runGuard(workDir);
    expect(status).toBe(0);
  });

  it("passes on a branch that MUTATES a squash-merged patch after the merge, not just an unmerged one", () => {
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
    git(["checkout", "--quiet", "runway"], workDir);

    const { status } = runGuard(workDir);
    expect(status).toBe(0);
  });

  it("passes on a freshly created branch with zero commits ahead, even though its diff against trunk is empty (_R1#167 G1_BOUNCE)", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "feature/just-started"], workDir);

    const { status } = runGuard(workDir);
    expect(status).toBe(0);
  });

  it("writes nothing to the caller's real working tree or index while it flags an unrelated fossil branch", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "fix/leftover-for-status-check"], workDir);
    writeFile(workDir, "leftover.txt", "leftover\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "leftover fix"], workDir);
    squashMergeToTrunk(workDir, "runway", "fix/leftover-for-status-check");
    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    // Real, unrelated uncommitted state on the checked-out branch itself.
    writeFile(workDir, "untouched.txt", "should stay staged only on disk, never committed or reset by the guard\n");
    git(["add", "untouched.txt"], workDir);

    const statusBefore = git(["status", "--porcelain"], workDir);
    const { status } = runGuard(workDir);
    expect(status).toBe(1); // still flags fix/leftover-for-status-check
    const statusAfter = git(["status", "--porcelain"], workDir);
    expect(statusAfter).toBe(statusBefore);
  });
});

describe("hygiene-guard.sh, control 1: refuses on a fossil state you construct", () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "hygiene-fossil-")));
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

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/branch already in origin\/runway \(detected via .+?\): fix\/leftover/);
    expect(stderr).toMatch(/Disposal: git branch -D fix\/leftover/);
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

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/worktree already in origin\/runway \(detected via .+?\): fix\/wt-leftover/);
    // Quoted (QA gap, _R1#167 G1_BOUNCE): a space-containing path made the
    // unquoted form fail with exit 129 when pasted verbatim.
    expect(stderr).toMatch(new RegExp(`git worktree remove --force '${escapeRegExp(wtPath)}'`));
  });
});

describe("hygiene-guard.sh, control 2: exits clean on real clean state, same session", () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "hygiene-clean-")));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("passes when the only branch is trunk itself", () => {
    const { workDir } = buildRepo(root, "runway");
    const { status, stdout } = runGuard(workDir);
    expect(status).toBe(0);
    expect(stdout).toMatch(/clean/);
  });

  it("passes when a local branch has real, unmerged work", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "feature/in-flight"], workDir);
    writeFile(workDir, "in-flight.txt", "still working\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "in flight"], workDir);

    const { status } = runGuard(workDir);
    expect(status).toBe(0);
  });

  it("passes when a zero-commit branch is present alongside trunk (_R1#167 G1_BOUNCE: control 2's prior fixtures could not tell this apart from a tidy repo)", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["branch", "feature/just-started"], workDir);

    const { status, stdout } = runGuard(workDir);
    expect(status).toBe(0);
    expect(stdout).toMatch(/clean/);
  });
});

describe("hygiene-guard.sh, control 3: runs correctly in a repo other than the one it was written in, trunk not named main", () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "hygiene-scratch-clone-")));
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

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/origin\/trunk/);
  });
});

describe("hygiene-guard.sh and pre-push, control 4: actually executes, and control 5: refuses by exit code not text", () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "hygiene-cli-")));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("the guard subprocess call site exits 1, by exit code, on fossil state", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "fix/cli-leftover"], workDir);
    writeFile(workDir, "cli-leftover.txt", "leftover\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "cli leftover"], workDir);
    squashMergeToTrunk(workDir, "runway", "fix/cli-leftover");
    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/REFUSE. Fossil state found/);
  });

  it("the guard subprocess call site exits 0 on clean state", () => {
    const { workDir } = buildRepo(root, "runway");
    const { status, stdout } = runGuard(workDir);
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
    // The real pre-push script resolves scripts/hygiene-guard.sh relative
    // to `git rev-parse --show-toplevel` of the repo doing the pushing,
    // this fixture, not the real _R1 checkout this suite runs inside of.
    // Copy the actual script under test into the fixture so that path
    // resolves, the same layout install.sh assumes for any real clone.
    mkdirSync(join(workDir, "scripts"), { recursive: true });
    execFileSync("cp", [SCRIPT_PATH, join(workDir, "scripts", "hygiene-guard.sh")]);

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
      // the guard's own stderr output lands on stderr; the test only needs
      // to know the hook actually ran, so check both.
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

describe("hygiene-guard.sh, addendum control 6: a content-present worktree that is ALSO dirty is never recommended for removal", () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "hygiene-dirty-")));
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

    const { status, stderr } = runGuard(workDir);
    // Still refuses: the repo still needs a decision.
    expect(status).toBe(1);
    expect(stderr).toMatch(/DISPOSABLE-BUT-DIRTY/);
    expect(stderr).toMatch(/holds 2 uncommitted/);
    // But NO removal command anywhere in the printed message for this item.
    expect(stderr).not.toMatch(/git worktree remove --force .*wt-dirty-leftover/);
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

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    // Quoted (QA gap, _R1#167 G1_BOUNCE): a space-containing path made the
    // unquoted form fail with exit 129 when pasted verbatim.
    expect(stderr).toMatch(new RegExp(`git worktree remove --force '${escapeRegExp(wtPath)}'`));
  });
});

describe("hygiene-guard.sh, addendum control: prunable worktree records are always reported, dirty check does not apply", () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "hygiene-prunable-")));
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

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/prunable/);
    expect(stderr).toMatch(/git worktree prune/);
  });

  it("common-dir resolution enumerates a THIRD worktree's dangling record even when the guard is run from a different linked worktree, not scoped to cwd's own position", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "chore/gone-elsewhere"], workDir);
    writeFile(workDir, "gone-elsewhere.txt", "will vanish\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "will vanish"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    const goneWtPath = join(root, "wt-gone-elsewhere");
    git(["worktree", "add", "--quiet", goneWtPath, "chore/gone-elsewhere"], workDir);
    // Simulate the fleet finding: directory removed by hand, dangling record.
    rmSync(goneWtPath, { recursive: true, force: true });

    // A second, unrelated, still-healthy worktree.
    const checkFromWtPath = join(root, "wt-common-dir-check");
    git(["worktree", "add", "--quiet", "-b", "chore/common-dir", checkFromWtPath], workDir);

    // Run the guard with repo-path pointed at the SECOND worktree, neither
    // main nor the one with the dangling record. `git worktree list` must
    // still surface wt-gone-elsewhere: that only happens if the guard
    // resolved the shared --git-common-dir rather than scoping worktree
    // enumeration to checkFromWtPath's own position.
    const { status, stderr } = runGuard(checkFromWtPath);
    expect(status).toBe(1);
    expect(stderr).toMatch(/prunable/);
    expect(stderr).toMatch(new RegExp(escapeRegExp(goneWtPath)));
  });
});

describe("hygiene-guard.sh, control 8: a brand-new branch is a starting point, not a fossil (_R1#167 G1_BOUNCE)", () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "hygiene-fresh-branch-")));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("half A: a freshly created branch with zero commits does NOT cause a refusal, the ordinary first act of any ticket", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["branch", "feat/just-started"], workDir);

    const ahead = git(["rev-list", "--count", "origin/runway..feat/just-started"], workDir);
    expect(ahead).toBe("0");

    const { status, stdout } = runGuard(workDir);
    expect(status).toBe(0);
    expect(stdout).toMatch(/clean/);
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

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/fix\/real-fossil/);
  });
});

describe("hygiene-guard.sh, control 9: only branches forked at or after the guard's own install point are governed (_R1#167 Overwatch ruling 1)", () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "hygiene-install-point-")));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("does NOT refuse on a genuine fossil branch that forked from trunk BEFORE the guard's install commit landed", () => {
    // withGuardMarker=false: this repo does not start with the guard
    // already "installed" on trunk. A branch forks and gets squash-merged
    // first, THEN the guard's own script lands on trunk. A backlog fossil
    // like this is exactly what ruling 1 says must not be an entry fee.
    const { workDir } = buildRepo(root, "runway", false);
    git(["checkout", "--quiet", "-b", "fix/pre-install-fossil"], workDir);
    writeFile(workDir, "pre-install.txt", "leftover from before install\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "pre-install fossil work"], workDir);
    squashMergeToTrunk(workDir, "runway", "fix/pre-install-fossil");

    installGuardMarker(workDir, "runway");
    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    // Sanity: this branch genuinely IS a fossil by content -- if governed,
    // the guard would refuse on it. The assertion below is that it isn't
    // governed, not that it isn't a fossil.
    const { status, stdout } = runGuard(workDir);
    expect(status).toBe(0);
    expect(stdout).toMatch(/clean/);
  });

  it("DOES refuse on an otherwise-identical fossil branch that forked AFTER the guard's install commit", () => {
    const { workDir } = buildRepo(root, "runway", false);
    installGuardMarker(workDir, "runway");

    git(["checkout", "--quiet", "-b", "fix/post-install-fossil"], workDir);
    writeFile(workDir, "post-install.txt", "leftover from after install\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "post-install fossil work"], workDir);
    squashMergeToTrunk(workDir, "runway", "fix/post-install-fossil");
    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/fix\/post-install-fossil/);
  });

  it("with no install point resolvable on trunk at all, REFUSES and says so, rather than silently treating every branch as ungoverned", () => {
    // No installGuardMarker() call: guard-path was never added to trunk.
    // A guard that reads "can't find my own install point" as "skip
    // everything" would exit 0 quietly here even with zero fossils present
    // -- the same failure shape the ticket names six times: a check that
    // executes, detects nothing, and looks identical to a check with
    // nothing to catch.
    const { workDir } = buildRepo(root, "runway", false);

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/could not resolve an install point/);
  });
});

describe("hygiene-guard.sh, control 10: two content-presence detectors, OR-combined (_R1#167 G1_BOUNCE, TP's own primitive)", () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "hygiene-two-detector-")));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /**
   * Several branches that each append one line to the SAME file, squash-
   * merged into trunk immediately, one after another. QA-Scout-1's gate-1
   * finding: reverse-apply alone only catches the LAST one in the chain,
   * because once trunk grows past an earlier fossil's append point, that
   * fossil's diff hunk no longer finds its trailing-context boundary in
   * trunk's current tree, and `git apply --reverse --check` fails on a
   * change that genuinely is already there. git cherry (patch-id) doesn't
   * diff against a tree, so it isn't sensitive to trunk having grown past
   * the hunk -- this is the detector-A-only case.
   */
  function buildSequentialAppendFossils(workDir: string, count: number): string[] {
    const names: string[] = [];
    let content = "";
    for (let i = 1; i <= count; i++) {
      const branch = `fossil-${i}`;
      git(["checkout", "--quiet", "-b", branch], workDir);
      content += `line ${i}\n`;
      writeFile(workDir, "shared.txt", content);
      git(["add", "."], workDir);
      git(["commit", "--quiet", "-m", `append ${i}`], workDir);
      squashMergeToTrunk(workDir, "runway", branch);
      names.push(branch);
    }
    return names;
  }

  it("detector A (git cherry) still SEES all three sequential same-file fossils that detector B (reverse-apply) alone would miss but the last -- but (_R1#167 G1_BOUNCE 2) only the one reverse-apply also confirms gets a disposal command; the other two are refused as DISPUTED, never auto-disposed from ancestry alone", () => {
    const { workDir } = buildRepo(root, "runway");
    writeFile(workDir, "shared.txt", "");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "seed shared.txt"], workDir);
    git(["push", "--quiet", "origin", "runway"], workDir);

    const fossils = buildSequentialAppendFossils(workDir, 3);
    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    const lines = stderr.split("\n");
    // fossil-1 and fossil-2: reverse-apply cannot confirm them (trunk grew
    // past their append's hunk boundary once later fossils also appended
    // to shared.txt), so cherry alone must not authorize a disposal
    // command for either -- DISPUTED, no "Disposal:" line.
    for (const branch of ["fossil-1", "fossil-2"]) {
      const line = lines.find((l) => l.includes(branch));
      expect(line, `no BLOCK line found for ${branch}`).toBeTruthy();
      expect(line).toMatch(/DISPUTED/);
      expect(line).not.toMatch(/Disposal:/);
    }
    // fossil-3 is the one reverse-apply CAN still confirm directly (it is
    // the last append, so trunk has not grown past its own hunk boundary):
    // both detectors agree, and it gets the real disposal command.
    const fossil3Line = lines.find((l) => l.includes("fossil-3"));
    expect(fossil3Line).toMatch(/Disposal: git branch -D fossil-3/);
    expect(fossil3Line).toMatch(/detected via git cherry \(patch-id\) and reverse-apply, in agreement/);
  });

  it("detector B (reverse-apply) catches a multi-commit squash that detector A (git cherry) alone cannot, since squashing N commits produces one new patch-id with no equivalent in trunk's separately-committed history", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "multi"], workDir);
    writeFile(workDir, "multi.txt", "a\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "multi 1"], workDir);
    writeFile(workDir, "multi.txt", "a\nb\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "multi 2"], workDir);
    writeFile(workDir, "multi.txt", "a\nb\nc\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "multi 3"], workDir);
    squashMergeToTrunk(workDir, "runway", "multi");
    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    // Sanity: git cherry alone genuinely cannot see this one, confirming
    // the test exercises detector B and not an accidental double-catch.
    const cherryOut = git(["cherry", "origin/runway", "multi"], workDir);
    expect(cherryOut.split("\n").some((l) => l.startsWith("+"))).toBe(true);

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/multi/);
    expect(stderr).toMatch(/detected via reverse-apply/);
  });

  it("neither detector false-positives on a real, unmerged branch (negative control, same session as both positives above)", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "live-work"], workDir);
    writeFile(workDir, "live.txt", "never merged\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "live work"], workDir);

    const { status, stdout } = runGuard(workDir);
    expect(status).toBe(0);
    expect(stdout).toMatch(/clean/);
  });

  it("git cherry's per-commit answer is NOT stable across a merge in range, but real unmerged work is still never false-flagged (permanent negative control, QA/TP _R1#167)", () => {
    // QA proved this directly (own-hands reproduced here, not taken on
    // faith): a commit whose diff is byte-identical to a commit already
    // on trunk reports "-" (patch-id equivalent) in isolation. Once a
    // later merge of trunk into the branch, with a hand-resolved
    // conflict folded into the merge commit itself, enters the walked
    // range, that SAME commit reports "+" (no equivalent). Cherry's
    // per-commit verdict is a property of the walked range, not a
    // context-free property of the commit.
    //
    // The direction is the safe one: this instability can turn a real
    // fossil into a MISS, never turn real unmerged work into a false
    // fossil. This test proves the safe half directly, independent of
    // whether reverse-apply happens to save any particular fossil case:
    // build a branch that (a) triggers the exact instability QA measured
    // and (b) still carries genuine, real, unmerged content the hand
    // resolution keeps. The guard must stay clean.
    const { workDir } = buildRepo(root, "runway");

    git(["checkout", "--quiet", "-b", "twin"], workDir);
    writeFile(workDir, "twin.txt", "same content\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "add twin.txt"], workDir);

    // Independently commit byte-identical content to trunk -- not a
    // cherry-pick, not a squash, a separately-authored commit with the
    // same diff, which is exactly what makes git cherry initially report
    // it as patch-id equivalent.
    git(["checkout", "--quiet", "runway"], workDir);
    writeFile(workDir, "twin.txt", "same content\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "add twin.txt (independent, same content)"], workDir);
    git(["push", "--quiet", "origin", "runway"], workDir);

    const cherryBefore = git(["cherry", "origin/runway", "twin"], workDir);
    expect(cherryBefore.split("\n").some((l) => l.startsWith("-"))).toBe(true);
    expect(cherryBefore.split("\n").some((l) => l.startsWith("+"))).toBe(false);

    // Diverge with REAL, never-merged content, then merge trunk in and
    // hand-resolve the conflict by keeping that real content. The branch
    // now genuinely holds work absent from trunk (the divergent line),
    // and the merge is folded into the merge commit itself, exactly the
    // shape QA measured.
    git(["checkout", "--quiet", "twin"], workDir);
    writeFile(workDir, "twin.txt", "same content DIVERGED, never merged\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "diverge with real unmerged content"], workDir);

    // The merge is expected to conflict on twin.txt (both sides touched
    // it since the fork), so it is run outside the `git()` helper, which
    // throws on any nonzero exit. Any status other than the documented
    // "merge attempted, conflict left for the caller to resolve" (1) is a
    // genuine fixture-setup failure and must not be swallowed.
    const mergeAttempt = spawnSync(
      "git",
      [...GIT_IDENTITY, "merge", "--quiet", "origin/runway", "-m", "merge runway into twin"],
      { cwd: workDir, encoding: "utf8", env: ISOLATED_GIT_ENV },
    );
    expect(mergeAttempt.status).toBe(1);
    writeFile(workDir, "twin.txt", "same content DIVERGED, never merged\n");
    git(["add", "twin.txt"], workDir);
    git(["commit", "--quiet", "--no-edit"], workDir);

    // Confirm the instability actually manifested: the original commit's
    // verdict flipped to "+" now that the merge is in range. If this
    // assertion ever fails, the fixture stopped exercising the mechanism
    // this test is named for.
    const cherryAfter = git(["cherry", "origin/runway", "twin"], workDir);
    expect(cherryAfter.split("\n").filter((l) => l.startsWith("+")).length).toBeGreaterThanOrEqual(1);

    git(["checkout", "--quiet", "runway"], workDir);
    const { status, stdout } = runGuard(workDir);
    expect(status).toBe(0);
    expect(stdout).toMatch(/clean/);
  });
});

describe("hygiene-guard.sh, DEFECT 5 (_R1#167 G1_BOUNCE 2): cherry (ancestry) alone must never authorize a disposal command, only reverse-apply (content) can", () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "hygiene-defect5-")));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /**
   * Lands feature.txt's exact patch on trunk via a real squash merge (so
   * detector B is a genuine, unbroken content check on this file -- no
   * hunk-boundary confusion), leaving a patch-id-equivalent commit in
   * trunk's history either way. When `revertAfterLanding` is true, an
   * extra commit removes feature.txt from trunk right after the squash,
   * so cherry's patch-id answer (which never forgets) and reverse-apply's
   * answer (which reads trunk's CURRENT tree) diverge: this is DEFECT 5's
   * own trigger, content that landed and was later reverted.
   *
   * BED VALIDITY GATE (TP's own trap, hit twice on this ticket before this
   * fix): asserts `rev-list --count` is nonzero and `git cherry -v` prints
   * a line before ever trusting the guard's verdict, so a byte-identical-
   * commit collapse (which reads as "zero commits ahead", a false clean)
   * cannot silently pass this test.
   */
  function buildLandedThenMaybeRevertedFixture(workDir: string, revertAfterLanding: boolean) {
    git(["checkout", "--quiet", "-b", "fossil"], workDir);
    writeFile(workDir, "feature.txt", "X content line 1\nX content line 2\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "add feature X on branch"], workDir);

    git(["checkout", "--quiet", "runway"], workDir);
    squashMergeToTrunk(workDir, "runway", "fossil");

    if (revertAfterLanding) {
      git(["rm", "--quiet", "feature.txt"], workDir);
      git(["commit", "--quiet", "-m", "remove feature.txt"], workDir);
      git(["push", "--quiet", "origin", "runway"], workDir);
    }

    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    // BED VALIDITY GATE, run before scoring anything (TP's own instruction).
    const ahead = git(["rev-list", "--count", "runway..fossil"], workDir);
    expect(Number(ahead), "bed invalid: fossil is not ahead of trunk at all").toBeGreaterThan(0);
    const cherryOut = git(["cherry", "-v", "runway", "fossil"], workDir);
    expect(cherryOut.length, "bed invalid: git cherry printed nothing").toBeGreaterThan(0);
  }

  it("CONTROL: content genuinely present in trunk's tree (never reverted) still gets exactly one disposal command, both detectors agreeing", () => {
    const { workDir } = buildRepo(root, "runway");
    buildLandedThenMaybeRevertedFixture(workDir, false);

    // stdin gate (TP's second trap): explicit </dev/null via runGuard's
    // own default (execFileSync's closed pipe) -- not relying on an
    // inherited tty, so a refusal here can never be the stdin gate firing
    // for the wrong reason.
    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    const disposalLines = stderr.split("\n").filter((l) => l.includes("Disposal:"));
    expect(disposalLines).toHaveLength(1);
    expect(disposalLines[0]).toMatch(/git branch -D fossil/);
    expect(stderr).toMatch(/detected via git cherry \(patch-id\) and reverse-apply, in agreement/);
  });

  it("REVERTED: content landed then was reverted -- cherry still matches by patch-id forever, but reverse-apply reads trunk's CURRENT tree and disagrees. Zero disposal commands; the branch is the only remaining copy", () => {
    const { workDir } = buildRepo(root, "runway");
    buildLandedThenMaybeRevertedFixture(workDir, true);

    // Independent confirmation of cherry's half of the disagreement,
    // own-hands, before trusting the guard's verdict about it: cherry
    // still reports this commit as patch-id equivalent, even though
    // feature.txt is gone from trunk's current tree.
    const cherryOut = git(["cherry", "runway", "fossil"], workDir);
    expect(cherryOut.split("\n").some((l) => l.startsWith("-"))).toBe(true);
    expect(() => git(["cat-file", "-e", "runway:feature.txt"], workDir)).toThrow();

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1); // refusal posture is UNCHANGED -- TP explicit: do not touch this
    expect(stderr).not.toMatch(/Disposal:/); // the one thing that must change
    expect(stderr).toMatch(/DISPUTED/);
    expect(stderr).toMatch(/fossil/);
    expect(stderr).toMatch(/reverse-apply could not confirm/);
  });

  it("the reverted and control arms do not render alike (byte-inequality, not just a different assertion path)", () => {
    const controlRoot = join(root, "control");
    mkdirSync(controlRoot, { recursive: true });
    const { workDir: controlDir } = buildRepo(controlRoot, "runway");
    buildLandedThenMaybeRevertedFixture(controlDir, false);
    const control = runGuard(controlDir);

    const revertedRoot = join(root, "reverted");
    mkdirSync(revertedRoot, { recursive: true });
    const { workDir: revertedDir } = buildRepo(revertedRoot, "runway");
    buildLandedThenMaybeRevertedFixture(revertedDir, true);
    const reverted = runGuard(revertedDir);

    expect(control.stderr).not.toBe(reverted.stderr);
    expect(control.stderr).toMatch(/Disposal:/);
    expect(reverted.stderr).not.toMatch(/Disposal:/);
  });

  it("mutation: removing the agreement requirement (DISPUTED silently promoted to CONFIRMED) brings the destructive disposal command back on the reverted arm -- RED without the fix, GREEN with it", () => {
    const { workDir } = buildRepo(root, "runway");
    buildLandedThenMaybeRevertedFixture(workDir, true);

    // Control: the real, unmutated script is silent on Disposal for this arm.
    const controlResult = runGuard(workDir);
    expect(controlResult.stderr).not.toMatch(/Disposal:/);

    // Mutation: the exact clause that keeps a cherry-only hit from being
    // treated as confirmed. This is the agreement requirement itself --
    // removing it collapses DISPUTED back into CONFIRMED, which is
    // byte-for-byte the pre-fix behavior for this bed.
    const anchor = '_CONTENT_MODE="disputed"';
    const source = readFileSync(SCRIPT_PATH, "utf8");
    const occurrences = source.split(anchor).length - 1;
    expect(occurrences).toBe(1); // targets a unique anchor, not a guess
    const mutated = source.replace(anchor, '_CONTENT_MODE="confirmed"');
    expect(mutated).not.toBe(source); // the mutation actually landed

    const mutantPath = join(root, "mutant-no-agreement.sh");
    writeFileSync(mutantPath, mutated);

    const mutantResult = runGuard(workDir, "origin", mutantPath);
    expect(mutantResult.status).toBe(1);
    expect(mutantResult.stderr).toMatch(/Disposal: git branch -D fossil/); // RED: destructive command is back
  });
});

describe("mutation floor: the checks above can fail, and their failure is caused by the specific mechanism named", () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "hygiene-mutation-")));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("breaking trunk resolution (hardcoding the trunk ref instead of re-resolving it) turns a real fossil into a false clean", () => {
    const { workDir } = buildRepo(root, "runway");
    // The mutation below hardcodes TRUNK_REF to "$_REMOTE/main". Since
    // _R1#167 ruling 1, install-point resolution runs against TRUNK_REF too
    // and would otherwise be the first thing to fail here (no commit on a
    // nonexistent origin/main adds the guard script), refusing for THAT
    // reason and never reaching the content check this test means to
    // isolate. Push an origin/main pointing at the same root commit
    // (which already has the guard marker per buildRepo's default) so
    // install-point resolution succeeds under the mutant too, and the only
    // thing that fails is the content-presence check the mutation targets.
    git(["push", "--quiet", "origin", "runway:main"], workDir);
    git(["checkout", "--quiet", "-b", "fix/mut-trunk"], workDir);
    writeFile(workDir, "mut-trunk.txt", "leftover\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "mut trunk leftover"], workDir);
    squashMergeToTrunk(workDir, "runway", "fix/mut-trunk");
    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    // Control: the real, unmutated script refuses.
    expect(runGuard(workDir).status).toBe(1);

    // Mutation: hardcode TRUNK_REF to "$_REMOTE/main" instead of the
    // resolved branch name, the literal shape of "hardcode main and never
    // re-resolve" the ticket warns about. This fixture's trunk is "runway",
    // so origin/main does not exist: rev-list/merge-base against it fail,
    // and the real fossil, which genuinely IS present in origin/runway,
    // now reads as not-present against a ref that was never resolved from
    // the repo at all.
    const anchor = 'TRUNK_REF="$_REMOTE/$TRUNK_BRANCH"';
    const source = readFileSync(SCRIPT_PATH, "utf8");
    const occurrences = source.split(anchor).length - 1;
    expect(occurrences).toBe(1); // mutation targets a unique anchor, not a guess
    const mutated = source.replace(anchor, 'TRUNK_REF="$_REMOTE/main"');
    expect(mutated).not.toBe(source); // the mutation actually landed

    const mutantPath = join(root, "mutant-trunk.sh");
    writeFileSync(mutantPath, mutated);

    const mutantResult = runGuard(workDir, "origin", mutantPath);
    expect(mutantResult.status).toBe(0); // false clean: the mutation's failure
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

    // Control: the real, reverse-apply script correctly passes (not present).
    expect(runGuard(workDir).status).toBe(0);

    // Mutation: the forward form, as a hand-written reimplementation of the
    // exact bug the ticket names, not a live edit of the shipped script
    // (there is no single-line anchor for this one; the bug is a different
    // shape of the whole check, apply-then-compare-tree-hash instead of
    // reverse-apply-and-read-its-own-exit-code). Apply the diff to a
    // scratch index seeded from trunk, then compare the resulting tree
    // hash to trunk's tree hash. A failed `git apply` leaves the scratch
    // index untouched, so its tree hash still equals trunk's, and this
    // buggy primitive reports "present" for a branch that plainly is not.
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
    // doesn't have README.md's base content in a form the forward patch
    // expects to land on top of) and, per the bug, reports present.
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

    // Control: real guard, run directly (no pipe), exits 1.
    const direct = runGuard(workDir).status;
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
      ["-c", `sh "${SCRIPT_PATH}" "${workDir}" origin 2>&1 | head -1; echo "MASKED_EXIT:$?"`],
      { cwd: workDir, encoding: "utf8", env: ISOLATED_GIT_ENV },
    );
    const maskedStatus = pipedOutput.match(/MASKED_EXIT:(\d+)/)?.[1];
    // head's own exit status, 0, is what `$?` reads here, masking the
    // guard's real exit 1 even though the guard genuinely refused.
    expect(maskedStatus).toBe("0");
    expect(direct).not.toBe(0);
  });

  it("disabling detector A (git cherry) turns the sequential-same-file fossils it alone catches into a false clean, proving the OR is actually wired to it", () => {
    const { workDir } = buildRepo(root, "runway");
    writeFile(workDir, "shared.txt", "");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "seed shared.txt"], workDir);
    git(["push", "--quiet", "origin", "runway"], workDir);

    let content = "";
    for (let i = 1; i <= 3; i++) {
      const branch = `fossil-${i}`;
      git(["checkout", "--quiet", "-b", branch], workDir);
      content += `line ${i}\n`;
      writeFile(workDir, "shared.txt", content);
      git(["add", "."], workDir);
      git(["commit", "--quiet", "-m", `append ${i}`], workDir);
      git(["checkout", "--quiet", "runway"], workDir);
      git(["pull", "--quiet", "origin", "runway"], workDir);
      git(["merge", "--quiet", "--squash", branch], workDir);
      git(["commit", "--quiet", "-m", `squash ${branch}`], workDir);
      git(["push", "--quiet", "origin", "runway"], workDir);
    }
    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    // Control: the real, unmutated script refuses (control 10's own test
    // proves all three are caught; this just re-confirms before mutating).
    expect(runGuard(workDir).status).toBe(1);

    // Mutation: disable detector A only, leaving detector B (reverse-apply)
    // running exactly as shipped. If the OR isn't really wired to detector
    // A, disabling it changes nothing; if it is, fossil-1 and fossil-2
    // (which detector B alone cannot see -- see control 10) go undetected.
    const anchor = 'if _is_cherry_fossil "$_ref" "$_trunk"; then';
    const source = readFileSync(SCRIPT_PATH, "utf8");
    const occurrences = source.split(anchor).length - 1;
    expect(occurrences).toBe(1);
    const mutated = source.replace(anchor, "if false; then");
    expect(mutated).not.toBe(source);

    const mutantPath = join(root, "mutant-no-cherry.sh");
    writeFileSync(mutantPath, mutated);

    const mutantResult = runGuard(workDir, "origin", mutantPath);
    expect(mutantResult.status).toBe(1); // fossil-3 is still caught by detector B
    expect(mutantResult.stderr).toMatch(/fossil-3/);
    expect(mutantResult.stderr).not.toMatch(/fossil-1/); // false clean for these two:
    expect(mutantResult.stderr).not.toMatch(/fossil-2/); // detector A was their only catch
  });

  it("disabling detector B (reverse-apply) turns the multi-commit-squash fossil it alone catches into a false clean, proving the OR is actually wired to it", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "multi"], workDir);
    writeFile(workDir, "multi.txt", "a\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "multi 1"], workDir);
    writeFile(workDir, "multi.txt", "a\nb\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "multi 2"], workDir);
    writeFile(workDir, "multi.txt", "a\nb\nc\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "multi 3"], workDir);
    squashMergeToTrunk(workDir, "runway", "multi");
    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    // Control: the real, unmutated script refuses.
    expect(runGuard(workDir).status).toBe(1);

    // Mutation: disable detector B only, leaving detector A (git cherry)
    // running exactly as shipped. git cherry cannot see this fossil (its
    // three commits squash into one new patch-id with no equivalent in
    // trunk's separately-committed history -- control 10's own sanity
    // check on `git cherry` proves this), so with detector B disabled the
    // OR has nothing left to catch it with.
    const anchor = 'if _is_reverse_apply_fossil "$_ref" "$_trunk"; then';
    const source = readFileSync(SCRIPT_PATH, "utf8");
    const occurrences = source.split(anchor).length - 1;
    expect(occurrences).toBe(1);
    const mutated = source.replace(anchor, "if false; then");
    expect(mutated).not.toBe(source);

    const mutantPath = join(root, "mutant-no-reverse-apply.sh");
    writeFileSync(mutantPath, mutated);

    const mutantResult = runGuard(workDir, "origin", mutantPath);
    expect(mutantResult.status).toBe(0); // false clean: detector B was multi's only catch
  });
});

describe("hygiene-guard.sh, control 11: content presence fails toward NOT-present on a mode-only change (_R1#167 G1_BOUNCE 4, DEFECT 1)", () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "hygiene-mode-")));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("a branch whose ONLY change is a file mode flip is genuine unmerged work, never flagged as a fossil", () => {
    const { workDir } = buildRepo(root, "runway");
    // CHANGELOG.md does not exist yet; add it at 644 on trunk first so the
    // branch's only unique commit is a pure mode flip, not a mode flip
    // bundled with a content add (which would be flagged for the content
    // reason and wouldn't isolate DEFECT 1 at all).
    writeFile(workDir, "CHANGELOG.md", "unreleased\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "add changelog"], workDir);
    git(["push", "--quiet", "origin", "runway"], workDir);

    git(["checkout", "--quiet", "-b", "mode-only", "runway"], workDir);
    execFileSync("chmod", ["+x", join(workDir, "CHANGELOG.md")]);
    git(["add", "CHANGELOG.md"], workDir);
    git(["commit", "--quiet", "-m", "mark changelog executable"], workDir);

    // Confirm the fixture is what it claims to be: trunk has 100644,
    // branch has 100755, before trusting the guard's verdict on it.
    const trunkMode = git(["ls-tree", "runway", "CHANGELOG.md"], workDir).split(/\s+/)[0];
    const branchMode = git(["ls-tree", "mode-only", "CHANGELOG.md"], workDir).split(/\s+/)[0];
    expect(trunkMode).toBe("100644");
    expect(branchMode).toBe("100755");

    git(["checkout", "--quiet", "runway"], workDir);
    const { status, stdout } = runGuard(workDir);
    expect(status).toBe(0);
    expect(stdout).toMatch(/clean/);
  });

  it("mutation: skipping the mode-divergence check and trusting apply --check's exit code alone calls the mode-only branch a fossil and hands out git branch -D", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "runway"], workDir);
    writeFile(workDir, "CHANGELOG.md", "unreleased\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "add changelog"], workDir);
    git(["push", "--quiet", "origin", "runway"], workDir);

    git(["checkout", "--quiet", "-b", "mode-only", "runway"], workDir);
    execFileSync("chmod", ["+x", join(workDir, "CHANGELOG.md")]);
    git(["add", "CHANGELOG.md"], workDir);
    git(["commit", "--quiet", "-m", "mark changelog executable"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    // Control: the real, fixed guard passes (asserted above; re-confirmed
    // here in the same session as the mutant for a direct before/after).
    expect(runGuard(workDir).status).toBe(0);

    // Mutation: the exact bug DEFECT 1 named, reintroduced by removing the
    // call to _mode_diverges -- the fix's load-bearing line after the
    // GIT_TRACE bounce replaced stderr-capture with a direct mode
    // comparison. Trusting apply --check's exit code alone again is
    // exactly what the pre-fix and the pre-GIT_TRACE-fix code both did.
    const anchor =
      'GIT_INDEX_FILE="$_index" _g apply --whitespace=nowarn --cached --reverse --check "$_patch" >/dev/null 2>/dev/null\n' +
      "  _apply_status=$?\n" +
      '  rm -rf "$_scratch"\n' +
      '  if [ "$_apply_status" -eq 0 ]; then\n' +
      '    if _mode_diverges "$_ref" "$_trunk" "$_base"; then\n' +
      "      return 1\n" +
      "    fi\n" +
      "    return 0\n" +
      "  fi\n" +
      '  if [ "$_apply_status" -gt 1 ]; then\n' +
      '    rm -f "$_wt_records" "$_wt_map" "$_branches" "$_hold_entries" "$_STDIN_FILE"\n' +
      '    _block "could not check whether $_ref reverse-applies onto $_trunk (git apply exited $_apply_status). Not treating an instrument failure as not-present."\n' +
      "    exit 1\n" +
      "  fi\n" +
      "  return 1";
    const source = readFileSync(SCRIPT_PATH, "utf8");
    const occurrences = source.split(anchor).length - 1;
    expect(occurrences).toBe(1); // mutation targets a unique anchor, not a guess
    const mutated = source.replace(
      anchor,
      'GIT_INDEX_FILE="$_index" _g apply --whitespace=nowarn --cached --reverse --check "$_patch" >/dev/null 2>/dev/null\n  _apply_status=$?\n  rm -rf "$_scratch"\n  [ "$_apply_status" -eq 0 ] && return 0\n  return 1',
    );
    expect(mutated).not.toBe(source);

    const mutantPath = join(root, "mutant-trust-exit-code.sh");
    writeFileSync(mutantPath, mutated);

    const mutantResult = runGuard(workDir, "origin", mutantPath);
    expect(mutantResult.status).toBe(1); // false refusal: mode-only now reads as a fossil
    expect(mutantResult.stderr).toMatch(/mode-only/);
    expect(mutantResult.stderr).toMatch(/git branch -D mode-only/); // the destructive remedy DEFECT 1 warned about
  });
});

describe("hygiene-guard.sh, control 17: GIT_TRACE and its siblings must never change a verdict (_R1#167 G1_BOUNCE, Overwatch/TP GIT_TRACE finding)", () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "hygiene-trace-")));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // The exact bed TP measured: one branch, a multi-commit squash, nothing
  // else in the repo that could cause a refusal on its own. Reverse-apply
  // is the ONLY detector that can catch this shape (git cherry cannot,
  // since squashing N commits produces one new patch-id with no
  // equivalent in trunk's separately-committed history), so this fixture
  // discriminates the GIT_TRACE regression specifically: if trace output
  // on stderr defeats reverse-apply, this is the one case with nothing
  // else to fall back on.
  function buildSquashFixture(workDir: string) {
    git(["checkout", "--quiet", "-b", "multi"], workDir);
    writeFile(workDir, "multi.txt", "a\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "multi 1"], workDir);
    writeFile(workDir, "multi.txt", "a\nb\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "multi 2"], workDir);
    writeFile(workDir, "multi.txt", "a\nb\nc\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "multi 3"], workDir);
    squashMergeToTrunk(workDir, "runway", "multi");
    git(["checkout", "--quiet", "runway"], workDir);
  }

  const TRACE_VARS = [
    "GIT_TRACE",
    "GIT_TRACE_PERFORMANCE",
    "GIT_TRACE_SETUP",
    "GIT_TRACE2",
    "GIT_TRACE2_EVENT",
    "GIT_CURL_VERBOSE",
  ];

  it.each(TRACE_VARS)(
    "%s=1 in the caller's environment does not change the verdict on a squash-merged fossil",
    (traceVar) => {
      const { workDir } = buildRepo(root, "runway");
      buildSquashFixture(workDir);

      const clean = runGuard(workDir);
      expect(clean.status).toBe(1);
      expect(clean.stderr).toMatch(/multi/);
      expect(clean.stderr).toMatch(/git branch -D multi/);

      const traced = runGuard(workDir, "origin", undefined, { [traceVar]: "1" });
      // Byte-identical verdict, not just the same exit code: same BLOCK
      // line, same detector attribution, per TP's own requirement that
      // this be a full-verdict comparison, not an exit-code-only one.
      expect(traced.status).toBe(clean.status);
      expect(traced.stderr).toBe(clean.stderr);
      expect(traced.stdout).toBe(clean.stdout);
    },
  );

  it("GIT_CURL_VERBOSE=1 does not touch the verdict either way, since it only affects network calls this guard never makes", () => {
    const { workDir } = buildRepo(root, "runway");
    buildSquashFixture(workDir);
    const clean = runGuard(workDir);
    const traced = runGuard(workDir, "origin", undefined, { GIT_CURL_VERBOSE: "1" });
    expect(traced.status).toBe(clean.status);
    expect(traced.stderr).toBe(clean.stderr);
  });

  it("mutation: removing the environment sanitization block lets a GIT_TRACE var reach the guard's own git subprocesses", () => {
    // This mutation does NOT reintroduce the GIT_TRACE false-clean verdict
    // by itself: _mode_diverges (the DEFECT 1 replacement) no longer reads
    // apply's stderr for a verdict at all, so the trace-defeats-the-
    // detector bug is already closed independent of this sanitization
    // block. That block is defense-in-depth, requested separately ("this
    // guard's own git calls must never inherit trace/verbose settings"),
    // and general timing-stability hygiene. Proving IT is wired needs a
    // check on what env a git subprocess actually sees, not on the
    // verdict -- so this uses a PATH shim that logs whether any
    // GIT_TRACE-family variable is present at invocation time, then
    // delegates to the real git. A verdict-based assertion here would be
    // vacuous: it would pass whether or not the sanitization ran, which is
    // exactly the shape of test this ticket has been finding all night.
    const { workDir } = buildRepo(root, "runway");
    buildSquashFixture(workDir);

    const leakLog = join(root, "trace-leak.log");
    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    const shimDir = join(root, "git-leak-shim");
    mkdirSync(shimDir, { recursive: true });
    const shimPath = join(shimDir, "git");
    writeFileSync(
      shimPath,
      `#!/bin/sh\n` +
        `for _v in GIT_TRACE GIT_TRACE2 GIT_TRACE_PERFORMANCE GIT_TRACE_SETUP GIT_CURL_VERBOSE; do\n` +
        `  eval "_val=\\"\\$$_v\\""\n` +
        `  if [ -n "$_val" ]; then\n` +
        `    echo "leak: $_v seen by git $*" >> '${leakLog}'\n` +
        `  fi\n` +
        `done\n` +
        `exec '${realGit}' "$@"\n`,
    );
    execFileSync("chmod", ["+x", shimPath]);
    const shimEnv = { PATH: `${shimDir}:${process.env.PATH ?? ""}`, GIT_TRACE: "1" };

    // Control: the real, fixed guard's git subprocesses never see GIT_TRACE
    // even though the caller's own environment has it set.
    rmSync(leakLog, { force: true });
    const clean = runGuard(workDir, "origin", undefined, shimEnv);
    expect(clean.status).toBe(1); // verdict is also correct, incidentally
    expect(existsSync(leakLog)).toBe(false);

    const anchor =
      "for _trace_var in GIT_TRACE GIT_TRACE_FSMONITOR GIT_TRACE_PACK_ACCESS \\\n" +
      "  GIT_TRACE_PACKET GIT_TRACE_PACKFILE GIT_TRACE_PERFORMANCE GIT_TRACE_REFS \\\n" +
      "  GIT_TRACE_SETUP GIT_TRACE_SHALLOW GIT_TRACE_CURL GIT_TRACE_CURL_NO_DATA \\\n" +
      "  GIT_CURL_VERBOSE GIT_TRACE2 GIT_TRACE2_EVENT GIT_TRACE2_PERF \\\n" +
      "  GIT_TRACE2_BRIEF GIT_TRACE2_CONFIG_PARAMS GIT_TRACE2_ENV_VARS \\\n" +
      "  GIT_TRACE2_PARENT_SID; do\n" +
      '  unset "$_trace_var"\n' +
      "done";
    const source = readFileSync(SCRIPT_PATH, "utf8");
    const occurrences = source.split(anchor).length - 1;
    expect(occurrences).toBe(1); // mutation targets a unique anchor, not a guess
    const mutated = source.replace(anchor, ": # sanitization removed by mutation");
    expect(mutated).not.toBe(source);

    const mutantPath = join(root, "mutant-no-env-sanitize.sh");
    writeFileSync(mutantPath, mutated);

    rmSync(leakLog, { force: true });
    runGuard(workDir, "origin", mutantPath, shimEnv);
    expect(existsSync(leakLog)).toBe(true); // the leak this control exists to catch
  });
});

describe("hygiene-guard.sh, control 26: GIT_DIR and its worktree-identity siblings must never override the repo argument (TP, _R1#174)", () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "hygiene-gitdir-leak-")));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // The exact mechanism TP measured own-hands: _g is `git -C "$_REPO" "$@"`
  // with no scrubbing, and GIT_DIR overrides -C for every call through it,
  // not just the dirty-check call site #175 fixed in the test file. A real
  // pre-push run never diverges _REPO from GIT_DIR for the repo being
  // pushed, but the guard also enumerates OTHER linked worktrees by path
  // (the dirty check at :1259/:1302, the worktree list read at :1372),
  // and those ARE a different directory than the one GIT_DIR names. This
  // fixture reproduces the divergence directly, the same way TP's own
  // measurement did, rather than only through the harder-to-drive
  // multi-worktree shape.
  function buildFossilFixture(workDir: string) {
    git(["checkout", "--quiet", "-b", "fossil-one"], workDir);
    writeFile(workDir, "fossil-one.txt", "a\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "fossil-one 1"], workDir);
    writeFile(workDir, "fossil-one.txt", "a\nb\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "fossil-one 2"], workDir);
    squashMergeToTrunk(workDir, "runway", "fossil-one");
    git(["checkout", "--quiet", "runway"], workDir);
  }

  it("direction 1: a repo with a real fossil still REFUSES, byte-identical to the no-leak verdict, when GIT_DIR is exported pointing at an unrelated clean repo", () => {
    const { workDir: fossilBed } = buildRepo(root, "runway");
    buildFossilFixture(fossilBed);
    const { workDir: cleanBed } = buildRepo(join(root, "clean-bed"), "runway");

    const baseline = runGuard(fossilBed);
    expect(baseline.status).toBe(1);
    expect(baseline.stderr).toMatch(/fossil-one/);
    expect(baseline.stderr).toMatch(/git branch -D fossil-one/);

    const leaked = runGuard(fossilBed, "origin", undefined, { GIT_DIR: join(cleanBed, ".git") });
    // Byte-identical, not just the same exit code, per TP's own requirement
    // (control 17's precedent): a leak that changes WHICH fossil gets
    // named, or drops the disposal command, is still a defect even if the
    // exit code happens to survive.
    expect(leaked.status).toBe(baseline.status);
    expect(leaked.stderr).toBe(baseline.stderr);
    expect(leaked.stdout).toBe(baseline.stdout);
  });

  it("direction 2: the guard never names a ref that does not exist in the repo it was given, even with GIT_DIR pointed at a repo that has one", () => {
    const { workDir: fossilBed } = buildRepo(root, "runway");
    buildFossilFixture(fossilBed);
    const { workDir: cleanBed } = buildRepo(join(root, "clean-bed"), "runway");

    const cleanBaseline = runGuard(cleanBed);
    expect(cleanBaseline.status).toBe(0);
    expect(cleanBaseline.stdout).toMatch(/hygiene-guard: clean/);

    const leaked = runGuard(cleanBed, "origin", undefined, { GIT_DIR: join(fossilBed, ".git") });
    // fossil-one exists only in fossilBed. A leak that reads fossilBed's
    // refs while claiming to inspect cleanBed would hand back a BLOCK line
    // (or a disposal command) naming a branch that is not present in the
    // repo the guard was told to check -- exactly the DIRECTION 2 failure
    // TP measured. Byte-identical to cleanBed's own baseline is the
    // strongest form of this assertion; the explicit name check below is
    // the one that would survive even if some future change made the two
    // verdicts diverge in a way that still avoided naming a foreign ref.
    expect(leaked.status).toBe(cleanBaseline.status);
    expect(leaked.stdout).toBe(cleanBaseline.stdout);
    expect(leaked.stderr).not.toMatch(/fossil-one/);
  });

  it("mutation: removing the GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE/GIT_COMMON_DIR scrub brings the false clean back on direction 1's exact fixture", () => {
    const { workDir: fossilBed } = buildRepo(root, "runway");
    buildFossilFixture(fossilBed);
    const { workDir: cleanBed } = buildRepo(join(root, "clean-bed"), "runway");

    // Control: the real, fixed guard is unaffected (re-asserted here in
    // the same session as the mutant, same discipline as control 12's own
    // mutation test).
    const fixed = runGuard(fossilBed, "origin", undefined, { GIT_DIR: join(cleanBed, ".git") });
    expect(fixed.status).toBe(1);
    expect(fixed.stderr).toMatch(/fossil-one/);

    const anchor =
      "for _repo_var in GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR; do\n" +
      '  unset "$_repo_var"\n' +
      "done";
    const source = readFileSync(SCRIPT_PATH, "utf8");
    const occurrences = source.split(anchor).length - 1;
    expect(occurrences).toBe(1); // mutation targets a unique anchor, not a guess
    const mutated = source.replace(anchor, ": # GIT_DIR scrub removed by mutation");
    expect(mutated).not.toBe(source);

    const mutantPath = join(root, "mutant-no-gitdir-scrub.sh");
    writeFileSync(mutantPath, mutated);

    const mutant = runGuard(fossilBed, "origin", mutantPath, { GIT_DIR: join(cleanBed, ".git") });
    // The false clean this control exists to catch: without the scrub,
    // GIT_DIR overrides -C and the guard reads cleanBed's (empty) fossil
    // state instead of fossilBed's real one.
    expect(mutant.status).toBe(0);
  });
});

describe("hygiene-guard.sh, control 12: the dirty check reports UNKNOWN, never a false clean, when it cannot read git status (_R1#167 G1_BOUNCE 4, DEFECT 2)", () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "hygiene-unknown-")));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("a worktree holding real uncommitted content, with a broken .git pointer, is reported UNKNOWN with no removal command, and still refuses", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "fix/corrupt-leftover"], workDir);
    writeFile(workDir, "corrupt-leftover.txt", "leftover\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "leftover fix"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    const wtPath = join(root, "wt-corrupt");
    git(["worktree", "add", "--quiet", wtPath, "fix/corrupt-leftover"], workDir);
    squashMergeToTrunk(workDir, "runway", "fix/corrupt-leftover");
    git(["fetch", "--quiet", "origin"], workDir);

    // Real, uncommitted content in the worktree, written before the .git
    // pointer is corrupted (the write itself needs a working filesystem,
    // not a working git).
    writeFile(wtPath, "scratch-note.txt", "real uncommitted content\n");

    // Corrupt the linked worktree's .git pointer file, the exact shape
    // Overwatch's own fleet finding hit: a worktree whose gitdir the
    // repository can no longer resolve.
    writeFileSync(join(wtPath, ".git"), "gitdir: /nonexistent/broken-gitdir\n");

    // Confirm the fixture is what it claims to be: git status genuinely
    // cannot read this worktree, before trusting the guard's verdict on it.
    expect(() => git(["status", "--porcelain"], wtPath)).toThrow();

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/UNKNOWN dirty-state/);
    expect(stderr).toMatch(/wt-corrupt/);
    // No removal command anywhere in the printed message for this item.
    expect(stderr).not.toMatch(/git worktree remove --force .*wt-corrupt/);
  });

  it("mutation: piping git status into awk, the pre-fix shape, reads the corrupted worktree's unreadable state as zero uncommitted changes", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "fix/corrupt-leftover-2"], workDir);
    writeFile(workDir, "corrupt-leftover-2.txt", "leftover\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "leftover fix"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    const wtPath = join(root, "wt-corrupt-2");
    git(["worktree", "add", "--quiet", wtPath, "fix/corrupt-leftover-2"], workDir);
    squashMergeToTrunk(workDir, "runway", "fix/corrupt-leftover-2");
    git(["fetch", "--quiet", "origin"], workDir);
    writeFile(wtPath, "scratch-note.txt", "real uncommitted content\n");
    writeFileSync(join(wtPath, ".git"), "gitdir: /nonexistent/broken-gitdir\n");

    // Control: the real, fixed guard reports UNKNOWN (asserted in full
    // above; re-confirmed here in the same session as the mutant).
    expect(runGuard(workDir).stderr).toMatch(/UNKNOWN dirty-state/);

    // Mutation: the exact pre-fix shape. `status --porcelain` piped
    // directly into awk means the guard's only readable signal is awk's
    // own exit status (always 0) counting an empty stream (because
    // status's stderr, which says the repository is unreadable, went to
    // /dev/null and its own nonzero exit was never read by anything).
    // Reproduced here as a standalone primitive, the same pattern this
    // file already uses for the forward-form and piped-exit-code
    // mutations, rather than a live multi-line edit of the shipped
    // function.
    const buggyCountDirty = (wt: string): number => {
      try {
        const out = execFileSync("sh", ["-c", `git -C "${wt}" status --porcelain 2>/dev/null | awk 'NF{c++} END{print c+0}'`], {
          encoding: "utf8",
          env: ISOLATED_GIT_ENV,
        });
        return Number(out.trim());
      } catch {
        return -1;
      }
    };
    expect(buggyCountDirty(wtPath)).toBe(0); // false clean: git status's own fatal exit never surfaces
  });

  // The actual mechanism under test: it takes an AMBIENT env, one that may
  // already carry a real leak, and scrubs the four GIT_* worktree-identity
  // vars itself before calling git. That mirrors the shipped fix, which
  // scrubs whatever is ambient at the call site rather than being handed
  // a pre-cleaned env from outside. Passing leakedEnv straight into this
  // function is what makes the leak an actually injected one instead of
  // a JS variable nothing downstream ever reads.
  const scopedCountDirty = (wt: string, ambientEnv: NodeJS.ProcessEnv): number => {
    const scoped = { ...ambientEnv };
    delete scoped.GIT_DIR;
    delete scoped.GIT_WORK_TREE;
    delete scoped.GIT_INDEX_FILE;
    delete scoped.GIT_COMMON_DIR;
    try {
      const out = execFileSync("sh", ["-c", `git -C "${wt}" status --porcelain 2>/dev/null | awk 'NF{c++} END{print c+0}'`], {
        encoding: "utf8",
        env: scoped,
      });
      return Number(out.trim());
    } catch {
      return -1;
    }
  };

  it("control: scopedCountDirty stays isolated from an ambient GIT_DIR, the exact leak a real pre-push hook creates (_R1#175)", () => {
    // A second, unrelated repo standing in for "the repo git actually set
    // GIT_DIR to when the hook ran". It carries a committed file the
    // target repo does not have, so a leaked GIT_DIR (ambient index,
    // target's actual files) reports that file as deleted: a nonzero
    // count that can only come from reading the wrong repo, not from
    // ambient untracked noise that a leak-scoped scan might just miss.
    const { workDir: ambientRepo } = buildRepo(root, "runway");
    writeFile(ambientRepo, "ambient-only.txt", "tracked only in the ambient repo\n");
    git(["add", "."], ambientRepo);
    git(["commit", "--quiet", "-m", "ambient-only file"], ambientRepo);

    // The actual target: a plain, genuinely clean worktree.
    const { workDir: targetRepo } = buildRepo(join(root, "target"), "runway");

    // Built from ISOLATED_GIT_ENV plus one override, not raw process.env,
    // so an ambient GIT_WORK_TREE, GIT_INDEX_FILE, or GIT_COMMON_DIR
    // already sitting in this vitest process can't ride along and
    // confound the positive-control arm below with a leak that isn't the
    // one this test claims to be injecting.
    const leakedEnv = { ...ISOLATED_GIT_ENV, GIT_DIR: join(ambientRepo, ".git") };

    // Positive control: prove the leak is real by running the RAW,
    // unscoped git call under leakedEnv with no stripping at all, spawned
    // as its own subprocess with GIT_DIR genuinely exported. If this
    // doesn't come back nonzero, leakedEnv never leaked and a 0 below
    // would pass for the wrong reason.
    const rawLeak = execFileSync("sh", ["-c", `git -C "${targetRepo}" status --porcelain 2>/dev/null | awk 'NF{c++} END{print c+0}'`], {
      encoding: "utf8",
      env: leakedEnv,
    });
    expect(Number(rawLeak.trim())).toBeGreaterThan(0);

    // scopedCountDirty receives leakedEnv itself as the ambient env it
    // runs under. Its own scrub is what has to do the work here, not a
    // hardcoded clean env swapped in from outside the function.
    expect(scopedCountDirty(targetRepo, leakedEnv)).toBe(0);
  });

  it("mutation: removing scopedCountDirty's own scrub brings the leak back on this exact fixture (_R1#175)", () => {
    const { workDir: ambientRepo } = buildRepo(root, "runway");
    writeFile(ambientRepo, "ambient-only.txt", "tracked only in the ambient repo\n");
    git(["add", "."], ambientRepo);
    git(["commit", "--quiet", "-m", "ambient-only file"], ambientRepo);
    const { workDir: targetRepo } = buildRepo(join(root, "target"), "runway");
    const leakedEnv = { ...ISOLATED_GIT_ENV, GIT_DIR: join(ambientRepo, ".git") };

    // Control: the fixed helper stays green on this fixture in the same
    // session as the mutant, same discipline as control 12's own
    // mutation test.
    expect(scopedCountDirty(targetRepo, leakedEnv)).toBe(0);

    // Mutant: the exact pre-fix shape, no scrub at all, the ambient env
    // (with its live leak) passed straight through to git.
    const unscopedCountDirty = (wt: string, ambientEnv: NodeJS.ProcessEnv): number => {
      try {
        const out = execFileSync("sh", ["-c", `git -C "${wt}" status --porcelain 2>/dev/null | awk 'NF{c++} END{print c+0}'`], {
          encoding: "utf8",
          env: ambientEnv,
        });
        return Number(out.trim());
      } catch {
        return -1;
      }
    };
    expect(unscopedCountDirty(targetRepo, leakedEnv)).toBeGreaterThan(0);
  });
});

describe("hygiene-guard.sh, control 13: a shallow clone refuses explicitly rather than resolving a fabricated install point (_R1#167 G1_BOUNCE 4, DEFECT 3)", () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "hygiene-shallow-")));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses and says 'shallow', and the raw git walk a resolver would otherwise trust lands on a commit after the real install commit, not on it", () => {
    const { originDir, workDir } = buildRepo(root, "runway", false);
    const installSha = installGuardMarker(workDir, "runway");

    for (let i = 0; i < 3; i++) {
      writeFile(workDir, `filler-${i}.txt`, `filler ${i}\n`);
      git(["add", "."], workDir);
      git(["commit", "--quiet", "-m", `filler ${i}`], workDir);
    }
    git(["push", "--quiet", "origin", "runway"], workDir);

    const shallowDir = join(root, "shallow-clone");
    execFileSync("git", GIT_IDENTITY.concat(["clone", "--quiet", "--depth", "1", `file://${originDir}`, shallowDir]), {
      cwd: root,
      encoding: "utf8",
      env: ISOLATED_GIT_ENV,
    });

    // Confirm the fixture is what it claims to be: genuinely shallow,
    // before trusting the guard's verdict on it.
    expect(git(["rev-parse", "--is-shallow-repository"], shallowDir)).toBe("true");

    // The raw walk _resolve_install_sha performs, run directly against the
    // shallow clone: the parentless graft commit has no parent to diff
    // against, so every path git can see in its tree, including
    // guard-path, reads as "added" AT THE GRAFT, not at the real,
    // unreachable commit that actually added it. own-hands reproduction of
    // the mechanism QA named, not a repeat of QA's own claim.
    const fabricatedSha = git(
      ["log", "origin/runway", "--diff-filter=A", "--format=%H", "--", "scripts/hygiene-guard.sh"],
      shallowDir,
    );
    expect(fabricatedSha).not.toBe("");
    expect(fabricatedSha).not.toBe(installSha); // wrong-but-plausible: NOT the real install commit

    // Control: the real, fixed guard refuses on shallow before ever
    // running that walk for a verdict.
    const { status, stderr } = runGuard(shallowDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/shallow/i);
  });

  it("mutation: disabling the shallow check removes the only thing standing between this fixture and a fabricated install point", () => {
    const { originDir, workDir } = buildRepo(root, "runway", false);
    installGuardMarker(workDir, "runway");
    for (let i = 0; i < 3; i++) {
      writeFile(workDir, `filler-${i}.txt`, `filler ${i}\n`);
      git(["add", "."], workDir);
      git(["commit", "--quiet", "-m", `filler ${i}`], workDir);
    }
    git(["push", "--quiet", "origin", "runway"], workDir);

    const shallowDir = join(root, "shallow-clone-2");
    execFileSync("git", GIT_IDENTITY.concat(["clone", "--quiet", "--depth", "1", `file://${originDir}`, shallowDir]), {
      cwd: root,
      encoding: "utf8",
      env: ISOLATED_GIT_ENV,
    });
    expect(git(["rev-parse", "--is-shallow-repository"], shallowDir)).toBe("true");

    // Control: the real, fixed guard refuses for the shallow reason.
    expect(runGuard(shallowDir).stderr).toMatch(/shallow/i);

    const anchor = 'if [ "$_is_shallow" = "true" ]; then';
    const source = readFileSync(SCRIPT_PATH, "utf8");
    const occurrences = source.split(anchor).length - 1;
    expect(occurrences).toBe(1);
    const mutated = source.replace(anchor, "if false; then");
    expect(mutated).not.toBe(source);

    const mutantPath = join(root, "mutant-no-shallow-check.sh");
    writeFileSync(mutantPath, mutated);

    const mutantResult = runGuard(shallowDir, "origin", mutantPath);
    // The specific thing this control checks: disabling the guard removes
    // the shallow refusal. It no longer stops here for that reason -- the
    // walk proven fabricated above is left free to run.
    expect(mutantResult.stderr).not.toMatch(/shallow/i);
  });
});

describe("hygiene-guard.sh, control 14: an empty-commit branch is never described as already-in-trunk (_R1#167 G1_BOUNCE 4, DEFECT 4)", () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "hygiene-empty-")));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("a branch whose only commit is `git commit --allow-empty` is left alone, not called already-in-trunk", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "empty-commit"], workDir);
    git(["commit", "--quiet", "--allow-empty", "-m", "empty"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    const { status, stdout } = runGuard(workDir);
    expect(status).toBe(0);
    expect(stdout).toMatch(/clean/);
  });

  it("mutation: the pre-fix empty-diff shortcut calls an empty-commit branch already-in-trunk and recommends deleting it", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "empty-commit-2"], workDir);
    git(["commit", "--quiet", "--allow-empty", "-m", "empty"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    // Control: the real, fixed guard stays silent.
    expect(runGuard(workDir).status).toBe(0);

    // Mutation: DEFECT 4's exact pre-fix shape -- an empty diff read as
    // "content is present" instead of "nothing to compare".
    const anchor =
      '  if [ ! -s "$_patch" ]; then\n' +
      '    rm -rf "$_scratch"\n' +
      "    # DEFECT 4 (_R1#167 G1_BOUNCE 4): an empty diff between the branch and\n" +
      "    # its own merge-base with trunk means the branch's unique commits made\n" +
      "    # NO content change at all (e.g. `git commit --allow-empty`). That is\n" +
      "    # not evidence trunk already contains the branch's work -- there is no\n" +
      "    # work to compare. The old shortcut returned 0 here and the BLOCK line\n" +
      '    # said "already in $TRUNK_REF", which is false: nothing was ever\n' +
      "    # contributed. Treat it as not-content-present; ahead-count already\n" +
      "    # excludes the zero-commit fresh-branch case upstream of this call, and\n" +
      "    # a real zero-diff duplicate is detector A's job, not this shortcut's.\n" +
      "    # This shortcut is reached only when `git diff` above exited 0, so an\n" +
      "    # empty patch here is a genuine, trusted negative, never a failure.\n" +
      "    return 1\n" +
      "  fi";
    const source = readFileSync(SCRIPT_PATH, "utf8");
    const occurrences = source.split(anchor).length - 1;
    expect(occurrences).toBe(1); // mutation targets a unique anchor, not a guess
    const mutated = source.replace(
      anchor,
      '  if [ ! -s "$_patch" ]; then\n    rm -rf "$_scratch"\n    return 0 # pre-fix: empty diff read as content-present\n  fi',
    );
    expect(mutated).not.toBe(source);

    const mutantPath = join(root, "mutant-empty-diff-present.sh");
    writeFileSync(mutantPath, mutated);

    const mutantResult = runGuard(workDir, "origin", mutantPath);
    expect(mutantResult.status).toBe(1); // false refusal
    expect(mutantResult.stderr).toMatch(/empty-commit-2/);
    expect(mutantResult.stderr).toMatch(/already in .*\(detected via git cherry|reverse-apply\)/);
  });
});

describe("hygiene-guard.sh, control 15: negative-control suite, every false-refusal shape asserted in one place (_R1#167 G1_BOUNCE 4)", () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "hygiene-negctrl-")));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("mode-only change: silent", () => {
    const { workDir } = buildRepo(root, "runway");
    writeFile(workDir, "CHANGELOG.md", "unreleased\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "add changelog"], workDir);
    git(["push", "--quiet", "origin", "runway"], workDir);

    git(["checkout", "--quiet", "-b", "neg/mode-only", "runway"], workDir);
    execFileSync("chmod", ["+x", join(workDir, "CHANGELOG.md")]);
    git(["add", "CHANGELOG.md"], workDir);
    git(["commit", "--quiet", "-m", "mark executable"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    expect(runGuard(workDir).status).toBe(0);
  });

  it("empty commit: silent", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "neg/empty"], workDir);
    git(["commit", "--quiet", "--allow-empty", "-m", "empty"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    expect(runGuard(workDir).status).toBe(0);
  });

  it("rename-only, no content change: silent", () => {
    const { workDir } = buildRepo(root, "runway");
    writeFile(workDir, "old-name.txt", "same content, never changes\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "add old-name.txt"], workDir);
    git(["push", "--quiet", "origin", "runway"], workDir);

    git(["checkout", "--quiet", "-b", "neg/rename-only", "runway"], workDir);
    git(["mv", "old-name.txt", "new-name.txt"], workDir);
    git(["commit", "--quiet", "-m", "rename only"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    expect(runGuard(workDir).status).toBe(0);
  });

  it("pure whitespace change: silent", () => {
    const { workDir } = buildRepo(root, "runway");
    writeFile(workDir, "ws.txt", "line one\nline two\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "add ws.txt"], workDir);
    git(["push", "--quiet", "origin", "runway"], workDir);

    git(["checkout", "--quiet", "-b", "neg/whitespace", "runway"], workDir);
    writeFile(workDir, "ws.txt", "line one \nline two\n"); // trailing space added
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "trailing whitespace"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    expect(runGuard(workDir).status).toBe(0);
  });

  it("CRLF-only line-ending change: silent", () => {
    const { workDir } = buildRepo(root, "runway");
    writeFile(workDir, "crlf.txt", "line one\nline two\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "add crlf.txt"], workDir);
    git(["push", "--quiet", "origin", "runway"], workDir);

    git(["checkout", "--quiet", "-b", "neg/crlf", "runway"], workDir);
    writeFile(workDir, "crlf.txt", "line one\r\nline two\r\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "CRLF line endings"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    expect(runGuard(workDir).status).toBe(0);
  });

  it("unmerged binary file: silent", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "neg/binary"], workDir);
    writeFileSync(join(workDir, "blob.bin"), Buffer.from([0, 1, 2, 3, 255, 254, 253, 0, 0, 0]));
    git(["add", "blob.bin"], workDir);
    git(["commit", "--quiet", "-m", "add binary blob"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    expect(runGuard(workDir).status).toBe(0);
  });

  it("convergent edit (branch and trunk independently reach the same line value): NOT asserted silent -- documented, not a defect", () => {
    // Unlike the shapes above, this one is not a false refusal: if the
    // branch's only change is a line that trunk also, separately, changed
    // to the identical value, trunk genuinely already holds everything the
    // branch contributes. Disposing of the branch loses nothing real. This
    // test exists so the next person who touches a detector sees this
    // case was considered and is expected to be flagged, not silently
    // broken into silence.
    const { workDir } = buildRepo(root, "runway");
    writeFile(workDir, "shared-value.txt", "original\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "add shared-value.txt"], workDir);
    git(["push", "--quiet", "origin", "runway"], workDir);

    git(["checkout", "--quiet", "-b", "neg/convergent"], workDir);
    writeFile(workDir, "shared-value.txt", "converged\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "branch converges independently"], workDir);

    git(["checkout", "--quiet", "runway"], workDir);
    writeFile(workDir, "shared-value.txt", "converged\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "trunk converges independently"], workDir);
    git(["push", "--quiet", "origin", "runway"], workDir);
    git(["fetch", "--quiet", "origin"], workDir);

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/neg\/convergent/);
  });
});

describe("hygiene-guard.sh, control 19: config-only detector misses TP found on _R1#167 G1_BOUNCE", () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "hygiene-cfgmiss-")));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("a DELETING fossil (branch removes trunk's trailing-whitespace lines, squash-merged) still refuses identically whether apply.whitespace is unset or warn", () => {
    const { workDir } = buildRepo(root, "runway");
    writeFile(workDir, "wsd.txt", "dirty one \ndirty two \nclean\ndirty three \n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "trunk carries whitespace-dirty lines"], workDir);
    git(["push", "--quiet", "origin", "runway"], workDir);

    // THREE commits, so a squash merge produces one patch-id with no
    // equivalent among the branch's own separately-committed patch-ids:
    // git cherry cannot see this, only reverse-apply can, which is the
    // exact shape TP measured the config-only miss on.
    git(["checkout", "--quiet", "-b", "fix/wsdel", "runway"], workDir);
    writeFile(workDir, "wsd.txt", "dirty one\ndirty two\nclean\ndirty three \n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "strip whitespace, line one"], workDir);
    writeFile(workDir, "wsd.txt", "dirty one\ndirty two\nclean\ndirty three\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "strip whitespace, line two"], workDir);
    writeFile(workDir, "wsd.txt", "dirty one\ndirty two \nclean\ndirty three\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "reintroduce then fix, third commit"], workDir);
    writeFile(workDir, "wsd.txt", "dirty one\ndirty two\nclean\ndirty three\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "final strip"], workDir);

    squashMergeToTrunk(workDir, "runway", "fix/wsdel");
    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    const unset = runGuard(workDir);
    expect(unset.status).toBe(1);
    expect(unset.stderr).toMatch(/fix\/wsdel/);

    git(["config", "apply.whitespace", "warn"], workDir);
    const warn = runGuard(workDir);
    expect(warn.status).toBe(1);
    expect(warn.stderr).toMatch(/fix\/wsdel/);
    // Byte-identical BLOCK line to the unset run: the config key must not
    // change which reason the guard gives, only whether it fires at all.
    expect(warn.stderr).toBe(unset.stderr);

    git(["config", "apply.whitespace", "fix"], workDir);
    const fix = runGuard(workDir);
    expect(fix.status).toBe(1);
    expect(fix.stderr).toBe(unset.stderr);
  });

  it("a committed .gitattributes line marking a text path binary still refuses identically, and does not false-positive on genuinely unmerged work", () => {
    const { workDir } = buildRepo(root, "runway");
    writeFile(workDir, ".gitattributes", "multi.txt binary\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "mark multi.txt binary"], workDir);
    git(["push", "--quiet", "origin", "runway"], workDir);

    // THREE commits building the file up, so a squash merge produces one
    // patch-id with no equivalent among the branch's own commits: git
    // cherry cannot see this, only reverse-apply can (and git cherry
    // returning plus for all three commits, with no fossil found, is
    // exactly what TP measured on this bed).
    git(["checkout", "--quiet", "-b", "fix/binattr", "runway"], workDir);
    writeFile(workDir, "multi.txt", "line one\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "add multi.txt, line one"], workDir);
    writeFile(workDir, "multi.txt", "line one\nline two\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "add line two"], workDir);
    writeFile(workDir, "multi.txt", "line one\nline two\nline three\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "add line three"], workDir);

    squashMergeToTrunk(workDir, "runway", "fix/binattr");
    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    const withAttr = runGuard(workDir);
    expect(withAttr.status).toBe(1);
    expect(withAttr.stderr).toMatch(/fix\/binattr/);

    // Genuine unmerged work under the identical attribute must not false-positive.
    git(["checkout", "--quiet", "-b", "feature/binattr-unmerged", "runway"], workDir);
    writeFile(workDir, "still-unmerged.txt", "line one\nline two\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "genuinely unmerged, unrelated file"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    const negControl = runGuard(workDir);
    expect(negControl.status).toBe(1); // fix/binattr is still a fossil sitting there
    expect(negControl.stderr).toMatch(/fix\/binattr/);
    // The negative: genuinely unmerged work under the same committed
    // binary attribute must never get a BLOCK line of its own.
    expect(negControl.stderr).not.toMatch(/feature\/binattr-unmerged/);
  });
});

/**
 * A `git` PATH shim that fails exactly ONE named subcommand and passes
 * everything else through to the real git binary untouched. Overwatch's
 * actuator (_R1#167): "For every check, write a second control that BREAKS
 * THE INSTRUMENT rather than changing the input."
 *
 * TP's own first shim had a bug worth not repeating: scanning for the
 * subcommand by shifting the real argument list consumes the `-C <path>`
 * pair, then execs git without it, so the shim silently runs in the WRONG
 * repository and returns a real, plausible-looking answer from somewhere
 * else -- a broken instrument that still looks trustworthy, in the tool
 * built to catch exactly that. This scans a loop variable over a COPY of
 * "$@" to find the subcommand, and execs the ORIGINAL "$@", untouched, to
 * the real binary either way.
 */
function makeGitFailShim(root: string, failSubcommand: string, realGit: string): string {
  const shimDir = join(root, "git-shim");
  mkdirSync(shimDir, { recursive: true });
  const shimPath = join(shimDir, "git");
  const script = `#!/bin/sh
_target='${failSubcommand}'
_real='${realGit}'
_sub=""
_skip=0
for _a in "$@"; do
  if [ "$_skip" = "1" ]; then
    _skip=0
    continue
  fi
  case "$_a" in
    -C|-c)
      _skip=1
      continue
      ;;
    -*)
      continue
      ;;
    *)
      _sub="$_a"
      break
      ;;
  esac
done
if [ "$_sub" = "$_target" ]; then
  echo "git-fail-shim: simulated failure for '$_sub'" >&2
  exit 111
fi
exec "$_real" "$@"
`;
  writeFileSync(shimPath, script);
  execFileSync("chmod", ["+x", shimPath]);
  return shimDir;
}

/** Runs the real, shipped guard with exactly one named git subcommand broken via PATH shim. */
function runGuardFaultInjected(cwd: string, failSubcommand: string, root: string, realGit: string): GuardResult {
  const shimDir = makeGitFailShim(root, failSubcommand, realGit);
  const env = { ...ISOLATED_GIT_ENV, PATH: `${shimDir}:${process.env.PATH ?? ""}` };
  try {
    const stdout = execFileSync("sh", [SCRIPT_PATH, cwd, "origin"], { cwd, encoding: "utf8", env });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { status: e.status ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

/** Same as runGuardFaultInjected, but with an explicit stdin ref-update stream. */
function runGuardFaultInjectedWithStdin(
  cwd: string,
  failSubcommand: string,
  root: string,
  realGit: string,
  stdin: string,
): GuardResult {
  const shimDir = makeGitFailShim(root, failSubcommand, realGit);
  const env = { ...ISOLATED_GIT_ENV, PATH: `${shimDir}:${process.env.PATH ?? ""}` };
  try {
    const stdout = execFileSync("sh", [SCRIPT_PATH, cwd, "origin"], { cwd, encoding: "utf8", env, input: stdin });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { status: e.status ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

describe("hygiene-guard.sh, control 16: fault injection, every check refuses rather than reporting a value when its own git command fails (Overwatch actuator, _R1#167 G1_BOUNCE)", () => {
  let root: string;
  let realGit: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "hygiene-fault-")));
    realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /**
   * One fixture, built once per test with the REAL git (never the shim),
   * carrying: two cherry-only fossils (sequential appends to the same
   * file), one reverse-apply-only fossil (a multi-commit squash), one
   * content-present branch checked out into its OWN registered worktree so
   * a broken `status` has something to fail on, one real unmerged branch
   * (negative control), and all four shapes TP confirmed are already
   * correct today (mode-only, rename-only, whitespace-only, CRLF-only),
   * which must stay non-destructive even when an instrument breaks.
   */
  function buildFaultFixture() {
    const { workDir } = buildRepo(root, "runway");

    writeFile(workDir, "shared.txt", "");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "seed shared.txt"], workDir);
    git(["push", "--quiet", "origin", "runway"], workDir);
    let content = "";
    for (let i = 1; i <= 2; i++) {
      const branch = `fossil-${i}`;
      git(["checkout", "--quiet", "-b", branch], workDir);
      content += `line ${i}\n`;
      writeFile(workDir, "shared.txt", content);
      git(["add", "."], workDir);
      git(["commit", "--quiet", "-m", `append ${i}`], workDir);
      git(["checkout", "--quiet", "runway"], workDir);
      git(["pull", "--quiet", "origin", "runway"], workDir);
      git(["merge", "--quiet", "--squash", branch], workDir);
      git(["commit", "--quiet", "-m", `squash ${branch}`], workDir);
      git(["push", "--quiet", "origin", "runway"], workDir);
    }

    git(["checkout", "--quiet", "-b", "multi"], workDir);
    writeFile(workDir, "multi.txt", "a\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "multi 1"], workDir);
    writeFile(workDir, "multi.txt", "a\nb\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "multi 2"], workDir);
    squashMergeToTrunk(workDir, "runway", "multi");

    git(["checkout", "--quiet", "-b", "fix/wt-content-present"], workDir);
    writeFile(workDir, "wt-content.txt", "leftover\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "wt leftover"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);
    const wtPath = join(root, "wt-content-present");
    git(["worktree", "add", "--quiet", wtPath, "fix/wt-content-present"], workDir);
    squashMergeToTrunk(workDir, "runway", "fix/wt-content-present");

    git(["checkout", "--quiet", "-b", "live-work"], workDir);
    writeFile(workDir, "live-work.txt", "never merged\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "real unmerged work"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    writeFile(workDir, "CHANGELOG.md", "unreleased\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "add changelog"], workDir);
    git(["push", "--quiet", "origin", "runway"], workDir);
    git(["checkout", "--quiet", "-b", "neg/mode-only", "runway"], workDir);
    execFileSync("chmod", ["+x", join(workDir, "CHANGELOG.md")]);
    git(["add", "CHANGELOG.md"], workDir);
    git(["commit", "--quiet", "-m", "mark executable"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    writeFile(workDir, "old-name.txt", "same content, never changes\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "add old-name.txt"], workDir);
    git(["push", "--quiet", "origin", "runway"], workDir);
    git(["checkout", "--quiet", "-b", "neg/rename-only", "runway"], workDir);
    git(["mv", "old-name.txt", "new-name.txt"], workDir);
    git(["commit", "--quiet", "-m", "rename only"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    writeFile(workDir, "ws.txt", "line one\nline two\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "add ws.txt"], workDir);
    git(["push", "--quiet", "origin", "runway"], workDir);
    git(["checkout", "--quiet", "-b", "neg/whitespace", "runway"], workDir);
    writeFile(workDir, "ws.txt", "line one \nline two\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "trailing whitespace"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    writeFile(workDir, "crlf.txt", "line one\nline two\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "add crlf.txt"], workDir);
    git(["push", "--quiet", "origin", "runway"], workDir);
    git(["checkout", "--quiet", "-b", "neg/crlf", "runway"], workDir);
    writeFile(workDir, "crlf.txt", "line one\r\nline two\r\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "CRLF line endings"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    return { workDir };
  }

  it("baseline: the unshimmed, real guard refuses on this fixture (control before fault injection)", () => {
    const { workDir } = buildFaultFixture();
    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/fossil-1|fossil-2|multi|wt-content-present/);
    // The four already-correct shapes stay silent on the healthy guard too.
    expect(stderr).not.toMatch(/branch -D neg\/mode-only/);
    expect(stderr).not.toMatch(/branch -D neg\/rename-only/);
    expect(stderr).not.toMatch(/branch -D neg\/whitespace/);
    expect(stderr).not.toMatch(/branch -D neg\/crlf/);
  });

  it.each([
    "for-each-ref",
    "rev-list",
    "merge-base",
    "worktree",
    "status",
    "read-tree",
    "cherry",
    "apply",
    "diff",
    "log",
    "rev-parse",
  ])("breaking '%s' refuses rather than reporting a false clean or a false destructive verdict", (failCmd) => {
    const { workDir } = buildFaultFixture();
    const result = runGuardFaultInjected(workDir, failCmd, root, realGit);

    // The one universal assertion: a broken instrument never produces exit
    // 0. Every one of these eleven commands sits on a path the guard needs
    // in order to answer honestly; TP's own fault injection against
    // 57b291b proved for-each-ref, rev-list, and merge-base collapse to a
    // false "clean" (exit 0) here, so this is not a redundant check.
    expect(result.status).not.toBe(0);

    // The amplifier TP found: breaking diff turned the four already-correct
    // shapes destructive, because an empty (failed) patch used to read as
    // "content present". None of the four may ever get a real disposal
    // command under ANY of these eleven fault injections, not just diff.
    expect(result.stderr).not.toMatch(/branch -D neg\/mode-only/);
    expect(result.stderr).not.toMatch(/branch -D neg\/rename-only/);
    expect(result.stderr).not.toMatch(/branch -D neg\/whitespace/);
    expect(result.stderr).not.toMatch(/branch -D neg\/crlf/);
  });

  it("breaking 'status' specifically: isolated fixture, so the assertion cannot be satisfied by an unrelated branch (QA note, _R1#167 G1_BOUNCE)", () => {
    // QA found the shared fixture's `status` entry above is thin: it
    // asserts only `result.status).not.toBe(0)`, and the shared fixture
    // has fossil-1, fossil-2, and multi all driving that exit code
    // regardless of what `status` does. QA applied the D2 mutation
    // (piping git status into awk instead of reading its own exit code)
    // and this same it.each entry stayed green, because control 12
    // independently kills that mutant with its own dedicated fixture --
    // not a real gap TODAY, but a fault-injection case that would go
    // vacuous silently if control 12 were ever removed.
    //
    // This fixture has exactly ONE governed, content-present branch,
    // checked out into its own worktree, and NOTHING else that could
    // cause a refusal. With a healthy `status`, the guard still refuses
    // (content presence alone earns that), but via a real disposal
    // command. Breaking `status` must flip the MESSAGE, not just hold the
    // exit code nonzero -- that flip is the thing this fault-injection
    // table exists to prove for every entry in it, and this is the one
    // entry that could not prove it on the shared fixture.
    const { workDir } = (() => {
      const built = buildRepo(root, "runway");
      git(["checkout", "--quiet", "-b", "fix/only-content-present"], built.workDir);
      writeFile(built.workDir, "only-content.txt", "leftover\n");
      git(["add", "."], built.workDir);
      git(["commit", "--quiet", "-m", "leftover"], built.workDir);
      git(["checkout", "--quiet", "runway"], built.workDir);
      const wtPath = join(root, "status-isolated-wt");
      git(["worktree", "add", "--quiet", wtPath, "fix/only-content-present"], built.workDir);
      squashMergeToTrunk(built.workDir, "runway", "fix/only-content-present");
      git(["fetch", "--quiet", "origin"], built.workDir);
      git(["checkout", "--quiet", "runway"], built.workDir);
      return built;
    })();

    const baseline = runGuard(workDir);
    expect(baseline.status).toBe(1);
    expect(baseline.stderr).toMatch(/Disposal: git worktree remove --force/);
    expect(baseline.stderr).not.toMatch(/UNKNOWN dirty-state/);

    const faulted = runGuardFaultInjected(workDir, "status", root, realGit);
    expect(faulted.status).toBe(1);
    // The discriminating assertion: breaking status specifically changed
    // WHICH message this exact branch got, not just that some other
    // branch in the fixture happened to refuse anyway.
    expect(faulted.stderr).toMatch(/UNKNOWN dirty-state: fix\/only-content-present.*git status could not be read/);
    expect(faulted.stderr).not.toMatch(/remove --force/);
  });
});

describe("hygiene-guard.sh, control 17: content presence is decided before the worktree is ever touched, so an unrelated corrupt worktree never blocks a push (_R1#167 G1_QUEUED reorder)", () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "hygiene-reorder-")));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("a worktree that is NOT content-present, with an unreadable .git, produces no block at all", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "live-work-corrupt"], workDir);
    writeFile(workDir, "still-in-progress.txt", "unmerged, real work\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "wip"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    const wtPath = join(root, "wt-live-work-corrupt");
    git(["worktree", "add", "--quiet", wtPath, "live-work-corrupt"], workDir);
    // Deliberately NOT squash-merged into trunk: this branch's content is
    // genuinely not present in $TRUNK_REF, so the guard must never touch
    // this worktree's dirt state at all.

    writeFile(wtPath, "scratch-note.txt", "real uncommitted content\n");
    writeFileSync(join(wtPath, ".git"), "gitdir: /nonexistent/broken-gitdir\n");

    // Confirm the fixture is what it claims to be: git status genuinely
    // cannot read this worktree, before trusting the guard's verdict on it.
    expect(() => git(["status", "--porcelain"], wtPath)).toThrow();

    const { status, stdout, stderr } = runGuard(workDir);
    expect(status).toBe(0);
    expect(stdout).toMatch(/clean/);
    expect(stderr).not.toMatch(/live-work-corrupt/);
    expect(stderr).not.toMatch(/UNKNOWN dirty-state/);
  });

  it("mutation: removing the reorder brings the spurious block back on the same not-content-present, corrupt-gitdir fixture", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "live-work-corrupt-2"], workDir);
    writeFile(workDir, "still-in-progress-2.txt", "unmerged, real work\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "wip"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    const wtPath = join(root, "wt-live-work-corrupt-2");
    git(["worktree", "add", "--quiet", wtPath, "live-work-corrupt-2"], workDir);
    writeFile(wtPath, "scratch-note.txt", "real uncommitted content\n");
    writeFileSync(join(wtPath, ".git"), "gitdir: /nonexistent/broken-gitdir\n");

    // Control: the real, fixed guard stays completely silent on this
    // fixture (re-confirmed here in the same session as the mutant).
    const control = runGuard(workDir);
    expect(control.status).toBe(0);

    // Mutation: neutralize the early "decide content presence first"
    // continue, so the loop falls straight into the dirty-state check
    // unconditionally, the exact pre-reorder shape TP bounced on.
    const anchor =
      '  if ! _is_content_present "$_branch" "$TRUNK_REF"; then\n' + "    continue\n" + "  fi";
    const source = readFileSync(SCRIPT_PATH, "utf8");
    const occurrences = source.split(anchor).length - 1;
    expect(occurrences).toBe(1); // mutation targets a unique anchor, not a guess
    const mutated = source.replace(anchor, '  if false; then\n    continue\n  fi');
    expect(mutated).not.toBe(source);

    const mutantPath = join(root, "mutant-no-reorder.sh");
    writeFileSync(mutantPath, mutated);

    const mutantResult = runGuard(workDir, "origin", mutantPath);
    // The specific thing this control checks: without the reorder, an
    // unrelated worktree's unreadable .git blocks the whole push even
    // though its branch was never a disposal candidate.
    expect(mutantResult.status).toBe(1);
    expect(mutantResult.stderr).toMatch(/UNKNOWN dirty-state/);
    expect(mutantResult.stderr).toMatch(/live-work-corrupt-2/);
  });
});

describe("hygiene-guard.sh, control 18: a ref under an active hold is unrepresentable as a disposal candidate (_R1#167 G1_QUEUED, Overwatch spec addition)", () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "hygiene-hold-")));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("held ref that IS content-present: no disposal command, hold named, still refuses", () => {
    const { workDir } = buildRepo(root, "runway", true, false);
    git(["checkout", "--quiet", "-b", "held/present"], workDir);
    writeFile(workDir, "held-present.txt", "will be squashed\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "held work"], workDir);
    const heldSha = git(["rev-parse", "held/present"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);
    squashMergeToTrunk(workDir, "runway", "held/present");
    writeHoldFile(workDir, "runway", `held/present ${heldSha} OPERATOR-HOLD operator hold, do not touch\n`);
    git(["checkout", "--quiet", "runway"], workDir);

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/held: held\/present is under an active hold/);
    expect(stderr).not.toMatch(/branch -D held\/present/);
    expect(stderr).not.toMatch(/worktree remove --force.*held\/present/);
  });

  it("held ref that is NOT content-present: completely silent, exactly like an unheld live branch (TP self-correction, _R1#167 G1_BOUNCE)", () => {
    // Overwatch's actual requirement was that a held ref never BECOME a
    // disposal candidate, not that holding a ref refuses every push
    // regardless of whether it was ever a candidate. TP's first relay of
    // that requirement (asserted here until this rewrite) made this exact
    // shape refuse -- measured live on agency-doc-kit, where nine refs sit
    // under hold and none of them would ever be recommended for disposal,
    // yet the guard blocked every push through the repo until every hold
    // lifted. A held, genuinely unmerged branch with nothing else pending
    // must let the push through clean; the hold is not the guard's
    // business until content-presence says there would be a disposal
    // command to replace.
    const { workDir } = buildRepo(root, "runway", true, false);
    git(["checkout", "--quiet", "-b", "held/not-present"], workDir);
    writeFile(workDir, "held-not-present.txt", "real unmerged work\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "held work, never merged"], workDir);
    const heldSha = git(["rev-parse", "held/not-present"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);
    writeHoldFile(workDir, "runway", `held/not-present ${heldSha} OPERATOR-HOLD operator hold\n`);
    git(["checkout", "--quiet", "runway"], workDir);

    const { status, stdout, stderr } = runGuard(workDir);
    expect(status).toBe(0);
    expect(stdout).toMatch(/clean/);
    expect(stderr).not.toMatch(/held\/not-present/);
  });

  it("an unheld fossil beside a held one is still caught normally: the hold does not blind the guard", () => {
    const { workDir } = buildRepo(root, "runway", true, false);
    git(["checkout", "--quiet", "-b", "held/present-2"], workDir);
    writeFile(workDir, "held-present-2.txt", "x\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "held"], workDir);
    const heldSha = git(["rev-parse", "held/present-2"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);
    squashMergeToTrunk(workDir, "runway", "held/present-2");

    git(["checkout", "--quiet", "-b", "unheld/fossil"], workDir);
    writeFile(workDir, "unheld-fossil.txt", "y\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "unheld fossil"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);
    squashMergeToTrunk(workDir, "runway", "unheld/fossil");

    writeHoldFile(workDir, "runway", `held/present-2 ${heldSha} OPERATOR-HOLD\n`);
    git(["checkout", "--quiet", "runway"], workDir);

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/held: held\/present-2/);
    expect(stderr).toMatch(/branch -D unheld\/fossil/);
  });

  it("name matches but the recorded SHA has moved: still held, and the message says the tip moved off the recorded SHA", () => {
    // Made content-present (squash-merged) so the hold check actually runs
    // under the corrected spec: it only fires at the point a disposal
    // command would otherwise be printed.
    const { workDir } = buildRepo(root, "runway", true, false);
    git(["checkout", "--quiet", "-b", "held/moved"], workDir);
    writeFile(workDir, "held-moved.txt", "v1\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "v1, this is the SHA the hold entry will record"], workDir);
    const staleSha = git(["rev-parse", "held/moved"], workDir);
    writeFile(workDir, "held-moved.txt", "v2\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "v2, one more commit after the hold was recorded"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);
    squashMergeToTrunk(workDir, "runway", "held/moved");
    writeHoldFile(workDir, "runway", `held/moved ${staleSha} OPERATOR-HOLD\n`);
    git(["checkout", "--quiet", "runway"], workDir);

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/held: held\/moved is under an active hold, but its tip has moved off the recorded SHA/);
    expect(stderr).not.toMatch(/branch -D held\/moved/);
  });

  it("class COORDINATOR-HOLD also gets the tip-moved advisory: it is not OPERATOR-HOLD-only (_R1#167 item 4)", () => {
    const { workDir } = buildRepo(root, "runway", true, false);
    git(["checkout", "--quiet", "-b", "held/moved-coord"], workDir);
    writeFile(workDir, "held-moved-coord.txt", "v1\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "v1"], workDir);
    const staleSha = git(["rev-parse", "held/moved-coord"], workDir);
    writeFile(workDir, "held-moved-coord.txt", "v2\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "v2, one more commit after the hold was recorded"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);
    squashMergeToTrunk(workDir, "runway", "held/moved-coord");
    writeHoldFile(workDir, "runway", `held/moved-coord ${staleSha} COORDINATOR-HOLD\n`);
    git(["checkout", "--quiet", "runway"], workDir);

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/held: held\/moved-coord is under an active hold, but its tip has moved off the recorded SHA/);
    expect(stderr).not.toMatch(/branch -D held\/moved-coord/);
  });

  it("class PERMANENT with a real recorded SHA that has since moved: still held, but NOT the tip-moved advisory (_R1#167 item 4)", () => {
    // Same shape as the two tests above -- one more commit lands on the
    // held branch after the hold was recorded -- but under PERMANENT the
    // advisory text ("tip has moved ... needs re-recording") must not
    // appear, because a permanent hold is pinned by name, not by a
    // snapshot that is expected to go stale.
    const { workDir } = buildRepo(root, "runway", true, false);
    git(["checkout", "--quiet", "-b", "held/permanent-moved"], workDir);
    writeFile(workDir, "held-permanent-moved.txt", "v1\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "v1"], workDir);
    const staleSha = git(["rev-parse", "held/permanent-moved"], workDir);
    writeFile(workDir, "held-permanent-moved.txt", "v2\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "v2"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);
    squashMergeToTrunk(workDir, "runway", "held/permanent-moved");
    writeHoldFile(workDir, "runway", `held/permanent-moved ${staleSha} PERMANENT\n`);
    git(["checkout", "--quiet", "runway"], workDir);

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/held: held\/permanent-moved is under an active permanent hold \(class PERMANENT\)/);
    expect(stderr).not.toMatch(/tip has moved/);
    expect(stderr).not.toMatch(/branch -D held\/permanent-moved/);
  });

  it("class PERMANENT with SHA 'ANY': held by name alone, current tip never checked (_R1#167 item 4)", () => {
    const { workDir } = buildRepo(root, "runway", true, false);
    git(["checkout", "--quiet", "-b", "held/permanent-any"], workDir);
    writeFile(workDir, "held-permanent-any.txt", "x\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "held"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);
    squashMergeToTrunk(workDir, "runway", "held/permanent-any");
    writeHoldFile(workDir, "runway", "held/permanent-any ANY PERMANENT a long-lived branch, never expected to land\n");
    git(["checkout", "--quiet", "runway"], workDir);

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/held: held\/permanent-any is under an active permanent hold \(class PERMANENT\)/);
    expect(stderr).toMatch(/Reason: a long-lived branch, never expected to land/);
    expect(stderr).not.toMatch(/tip has moved/);
    expect(stderr).not.toMatch(/branch -D held\/permanent-any/);
  });

  it("mutation: removing the PERMANENT special-case wires the ANY entry into the wrong message (_R1#167 item 4)", () => {
    const { workDir } = buildRepo(root, "runway", true, false);
    git(["checkout", "--quiet", "-b", "held/permanent-any-mut"], workDir);
    writeFile(workDir, "held-permanent-any-mut.txt", "x\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "held"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);
    squashMergeToTrunk(workDir, "runway", "held/permanent-any-mut");
    writeHoldFile(workDir, "runway", "held/permanent-any-mut ANY PERMANENT\n");
    git(["checkout", "--quiet", "runway"], workDir);

    // Control: the real, fixed guard reports the PERMANENT-class message.
    const control = runGuard(workDir);
    expect(control.status).toBe(1);
    expect(control.stderr).toMatch(/active permanent hold \(class PERMANENT\)/);

    const anchor =
      '    if [ "$_name_match" -eq 1 ] && [ "$_e_class" = "PERMANENT" ]; then\n' +
      '      _HOLD_MSG="held: $_ref is under an active permanent hold (class PERMANENT). No disposal command. Its owner decides.${_e_reason:+ Reason: $_e_reason}"\n' +
      "      return 0\n" +
      "    fi\n";
    const source = readFileSync(SCRIPT_PATH, "utf8");
    const occurrences = source.split(anchor).length - 1;
    expect(occurrences).toBe(1); // mutation targets a unique anchor, not a guess
    const mutated = source.replace(anchor, "");
    expect(mutated).not.toBe(source);

    const mutantPath = join(root, "mutant-no-permanent-class.sh");
    writeFileSync(mutantPath, mutated);

    const mutantResult = runGuard(workDir, "origin", mutantPath);
    // Without the special-case, ANY's unresolved SHA falls into the
    // generic "could not be verified in this clone" branch instead --
    // still held, but the wrong message, proving the special-case (and
    // this control) is load-bearing rather than redundant with an
    // adjacent branch that would have caught it anyway.
    expect(mutantResult.status).toBe(1);
    expect(mutantResult.stderr).not.toMatch(/active permanent hold \(class PERMANENT\)/);
    expect(mutantResult.stderr).toMatch(/could not be verified in this clone/);
  });

  it("recorded SHA matches even though the branch was renamed: still held", () => {
    // Made content-present (squash-merged, under the original name, before
    // the rename) so the hold check actually runs under the corrected
    // spec: it only fires at the point a disposal command would otherwise
    // be printed.
    const { workDir } = buildRepo(root, "runway", true, false);
    git(["checkout", "--quiet", "-b", "held/original-name"], workDir);
    writeFile(workDir, "held-renamed.txt", "x\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "held work"], workDir);
    const heldSha = git(["rev-parse", "held/original-name"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);
    squashMergeToTrunk(workDir, "runway", "held/original-name");
    git(["branch", "-m", "held/original-name", "held/renamed"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);
    writeHoldFile(workDir, "runway", `held/original-name ${heldSha} OPERATOR-HOLD\n`);
    git(["checkout", "--quiet", "runway"], workDir);

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/held: held\/renamed \(recorded in the hold list under a different name, matched by its held commit/);
    expect(stderr).not.toMatch(/branch -D held\/renamed/);
  });

  it("an INDENTED comment does not take the repo offline (QA gap, _R1#167 G1_BOUNCE)", () => {
    // QA reproduced: the old comment/blank check matched only a '#' in
    // column 1, so `   # indented for readability` fell through to data
    // parsing, `$1` became `#`, and the entry was malformed -- refusing
    // every push in the repo over a formatting choice with no hint at the
    // real cause. A held branch is present in the same file to prove the
    // indented comment is genuinely ignored, not merely non-fatal.
    const { workDir } = buildRepo(root, "runway", true, false);
    git(["checkout", "--quiet", "-b", "held/indented-comment"], workDir);
    writeFile(workDir, "held-indented.txt", "x\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "held"], workDir);
    const heldSha = git(["rev-parse", "held/indented-comment"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);
    squashMergeToTrunk(workDir, "runway", "held/indented-comment");
    writeHoldFile(
      workDir,
      "runway",
      `# a comment in column one\n   # the same comment, indented for readability\n\n   \nheld/indented-comment ${heldSha} OPERATOR-HOLD\n`,
    );
    git(["checkout", "--quiet", "runway"], workDir);

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/held: held\/indented-comment/);
    expect(stderr).not.toMatch(/malformed entry/);
  });

  it("a CRLF-terminated, terse two-column entry parses correctly instead of refusing the whole run (QA gap, _R1#167 G1_BOUNCE)", () => {
    // QA reproduced: a trailing CR attached to the SHA column failed the
    // hex check, and the diagnostic named the SHA as the problem even
    // though stripping the invisible CR would have made it valid. Stripping
    // CR before validation means this terse (no reason column) entry now
    // parses correctly rather than merely producing a better error.
    const { workDir } = buildRepo(root, "runway", true, false);
    git(["checkout", "--quiet", "-b", "held/crlf-entry"], workDir);
    writeFile(workDir, "held-crlf.txt", "x\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "held"], workDir);
    const heldSha = git(["rev-parse", "held/crlf-entry"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);
    squashMergeToTrunk(workDir, "runway", "held/crlf-entry");
    writeHoldFile(workDir, "runway", `held/crlf-entry ${heldSha} OPERATOR-HOLD\r\n`);
    git(["checkout", "--quiet", "runway"], workDir);

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/held: held\/crlf-entry is under an active hold/);
    expect(stderr).not.toMatch(/malformed entry/);
  });

  it("a LEADING-WHITESPACE entry's reason column is the reason alone, not the whole raw line (QA-Scout-1 gap on e10fef66)", () => {
    // QA-Scout-1 found: the reason-extraction sed anchored at column 0, so
    // an indented entry never matched it at all, and the printed hold
    // message's "Reason:" carried the entire raw line -- name, SHA, and
    // class included -- instead of just the reason text after them.
    const { workDir } = buildRepo(root, "runway", true, false);
    git(["checkout", "--quiet", "-b", "held/leading-whitespace"], workDir);
    writeFile(workDir, "held-leading-ws.txt", "x\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "held"], workDir);
    const heldSha = git(["rev-parse", "held/leading-whitespace"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);
    squashMergeToTrunk(workDir, "runway", "held/leading-whitespace");
    writeHoldFile(
      workDir,
      "runway",
      `   held/leading-whitespace ${heldSha} OPERATOR-HOLD indented on purpose\n`,
    );
    git(["checkout", "--quiet", "runway"], workDir);

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/held: held\/leading-whitespace is under an active hold/);
    expect(stderr).toMatch(/Reason: indented on purpose/);
    expect(stderr).not.toMatch(/Reason: held\/leading-whitespace/);
    expect(stderr).not.toMatch(new RegExp(`Reason: ${escapeRegExp(heldSha)}`));
  });

  it("a genuinely malformed entry's diagnostic includes a visible rendering, not just the raw line", () => {
    // QA's ask (_R1#167 G1_BOUNCE): once an entry is genuinely malformed
    // for a reason unrelated to CRLF (here: a non-hex second column), the
    // message should still show a non-printing-character-safe rendering
    // of the offending line, not just echo it back verbatim, so a hidden
    // character elsewhere in a future bad entry does not get to hide
    // behind a raw echo that looks clean.
    const { workDir } = buildRepo(root, "runway", true, false);
    writeHoldFile(workDir, "runway", "some/branch not-a-sha-at-all\n");
    git(["checkout", "--quiet", "runway"], workDir);

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/malformed entry/);
    expect(stderr).toMatch(/visible:/);
  });

  it("entry with no SHA column: malformed, refuses the whole run", () => {
    const { workDir } = buildRepo(root, "runway", true, false);
    writeHoldFile(workDir, "runway", "some/branch\n");
    git(["checkout", "--quiet", "runway"], workDir);

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/malformed entry/);
    expect(stderr).toMatch(/SHA column/);
  });

  it("entry with no class column: malformed, refuses the whole run (_R1#167 item 4, class REQUIRED)", () => {
    const { workDir } = buildRepo(root, "runway", true, false);
    writeHoldFile(workDir, "runway", "some/branch deadbeef1234\n");
    git(["checkout", "--quiet", "runway"], workDir);

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/malformed entry/);
    expect(stderr).toMatch(/class column/);
  });

  it("entry with an unrecognized class value: malformed, names the bad value (_R1#167 item 4)", () => {
    const { workDir } = buildRepo(root, "runway", true, false);
    writeHoldFile(workDir, "runway", "some/branch deadbeef1234 URGENT-HOLD\n");
    git(["checkout", "--quiet", "runway"], workDir);

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/malformed entry/);
    expect(stderr).toMatch(/unrecognized class 'URGENT-HOLD'/);
  });

  it("SHA 'ANY' under class OPERATOR-HOLD: malformed, ANY is only legal under PERMANENT (_R1#167 item 4)", () => {
    const { workDir } = buildRepo(root, "runway", true, false);
    writeHoldFile(workDir, "runway", "some/branch ANY OPERATOR-HOLD\n");
    git(["checkout", "--quiet", "runway"], workDir);

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/malformed entry/);
    expect(stderr).toMatch(/ANY.*only legal under class PERMANENT/);
  });

  it("SHA 'ANY' under class COORDINATOR-HOLD: malformed too, not just OPERATOR-HOLD (_R1#167 item 4)", () => {
    const { workDir } = buildRepo(root, "runway", true, false);
    writeHoldFile(workDir, "runway", "some/branch ANY COORDINATOR-HOLD\n");
    git(["checkout", "--quiet", "runway"], workDir);

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/malformed entry/);
    expect(stderr).toMatch(/ANY.*only legal under class PERMANENT/);
  });

  it("entry in origin/... remote-tracking form: refuses and names the line, the census-paste footgun", () => {
    const { workDir } = buildRepo(root, "runway", true, false);
    writeHoldFile(workDir, "runway", "origin/mp-cc/clause-seed deadbeef1234\n");
    git(["checkout", "--quiet", "runway"], workDir);

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/malformed entry/);
    expect(stderr).toMatch(/remote-tracking/);
    expect(stderr).toMatch(/origin\/mp-cc\/clause-seed/);
  });

  it("hold file absent from trunk entirely: refuses, 'could not be read', no disposability check ran", () => {
    const { workDir } = buildRepo(root, "runway", true, false);
    git(["checkout", "--quiet", "-b", "would-be-fossil"], workDir);
    writeFile(workDir, "would-be-fossil.txt", "x\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "x"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);
    squashMergeToTrunk(workDir, "runway", "would-be-fossil");
    // Deliberately never calling writeHoldFile: .hygiene-hold never exists on trunk.

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/could not be read/);
    expect(stderr).not.toMatch(/branch -D would-be-fossil/);
  });

  it("hold file present but empty: proceeds silently, zero holds (this is buildRepo's own default fixture)", () => {
    const { workDir } = buildRepo(root, "runway");
    const { status, stdout } = runGuard(workDir);
    expect(status).toBe(0);
    expect(stdout).toMatch(/clean/);
  });

  it("recorded SHA the clone does not have: name match still holds, run is not refused for that alone", () => {
    // Made content-present (squash-merged) so the hold check actually runs
    // under the corrected spec.
    const { workDir } = buildRepo(root, "runway", true, false);
    git(["checkout", "--quiet", "-b", "held/unresolvable-sha"], workDir);
    writeFile(workDir, "held-unresolvable.txt", "x\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "held"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);
    squashMergeToTrunk(workDir, "runway", "held/unresolvable-sha");
    // A syntactically valid but nonexistent object id -- never landed in this repo.
    writeHoldFile(workDir, "runway", "held/unresolvable-sha deadbeefdeadbeefdeadbeefdeadbeefdeadbeef OPERATOR-HOLD\n");
    git(["checkout", "--quiet", "runway"], workDir);

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/held: held\/unresolvable-sha is under an active hold \(recorded SHA .* could not be verified in this clone\)/);
  });

  it("mutation: neutralizing the hold check lets a held, content-present ref acquire a disposal command again", () => {
    const { workDir } = buildRepo(root, "runway", true, false);
    git(["checkout", "--quiet", "-b", "held/mutation-target"], workDir);
    writeFile(workDir, "held-mutation.txt", "x\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "held"], workDir);
    const heldSha = git(["rev-parse", "held/mutation-target"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);
    squashMergeToTrunk(workDir, "runway", "held/mutation-target");
    writeHoldFile(workDir, "runway", `held/mutation-target ${heldSha} OPERATOR-HOLD\n`);
    git(["checkout", "--quiet", "runway"], workDir);

    // Control: the real, fixed guard holds it, in the same session as the mutant.
    const control = runGuard(workDir);
    expect(control.status).toBe(1);
    expect(control.stderr).toMatch(/held: held\/mutation-target/);
    expect(control.stderr).not.toMatch(/branch -D held\/mutation-target/);

    const anchor = '  if _is_held "$_branch" "$_branch_tip"; then\n    _block "$_HOLD_MSG"\n    continue\n  fi';
    const source = readFileSync(SCRIPT_PATH, "utf8");
    const occurrences = source.split(anchor).length - 1;
    expect(occurrences).toBe(1); // mutation targets a unique anchor, not a guess
    const mutated = source.replace(anchor, '  if false; then\n    _block "$_HOLD_MSG"\n    continue\n  fi');
    expect(mutated).not.toBe(source);

    const mutantPath = join(root, "mutant-no-hold-check.sh");
    writeFileSync(mutantPath, mutated);

    const mutantResult = runGuard(workDir, "origin", mutantPath);
    // The specific thing this control checks: without the hold check, the
    // held ref is exactly as disposable as an unheld one.
    expect(mutantResult.status).toBe(1);
    expect(mutantResult.stderr).toMatch(/branch -D held\/mutation-target/);
  });

  describe("with a hold active, none of the eleven fault injections may let the held ref acquire a disposal command", () => {
    let faultRealGit: string;
    beforeEach(() => {
      faultRealGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    });

    it.each([
      "for-each-ref",
      "rev-list",
      "merge-base",
      "worktree",
      "status",
      "read-tree",
      "cherry",
      "apply",
      "diff",
      "log",
      "rev-parse",
    ])("breaking '%s' with a hold active never hands the held ref a disposal command", (failCmd) => {
      const { workDir } = buildRepo(root, "runway", true, false);
      git(["checkout", "--quiet", "-b", "held/fault-injection"], workDir);
      writeFile(workDir, "held-fault.txt", "x\n");
      git(["add", "."], workDir);
      git(["commit", "--quiet", "-m", "held"], workDir);
      const heldSha = git(["rev-parse", "held/fault-injection"], workDir);
      git(["checkout", "--quiet", "runway"], workDir);
      squashMergeToTrunk(workDir, "runway", "held/fault-injection");
      writeHoldFile(workDir, "runway", `held/fault-injection ${heldSha} OPERATOR-HOLD\n`);
      git(["checkout", "--quiet", "runway"], workDir);
      git(["fetch", "--quiet", "origin"], workDir);

      const result = runGuardFaultInjected(workDir, failCmd, root, faultRealGit);

      // The assertion that matters most, per TP: a broken instrument may
      // make the guard refuse for an unrelated reason, or even (for a
      // command the hold path doesn't touch) still resolve the hold
      // correctly, but under no circumstance may the held ref come out
      // the other end with a real removal command attached to it.
      expect(result.stderr).not.toMatch(/branch -D held\/fault-injection/);
      expect(result.stderr).not.toMatch(/worktree remove --force.*held\/fault-injection/);
    });
  });

  describe("a hold entry's NAME can carry an invisible byte the printable-check must catch (_R1#167 G2_BOUNCE)", () => {
    // TP's own repro: three fossil branches, three PERMANENT/ANY hold
    // entries (no SHA to fall back on, so the name half of the OR is the
    // ONLY thing protecting these), a zero-width space glued to the head
    // of the middle entry's name only. Built fresh here rather than
    // reusing TP's fixtures on purpose, so this proof and TP's gate stay
    // independent measurements of the same defect.
    function buildThreeFossilsWithHoldFile(holdFileContent: string) {
      const { workDir } = buildRepo(root, "runway", true, false);
      for (const name of ["alpha", "bravo", "charlie"]) {
        git(["checkout", "--quiet", "-b", name], workDir);
        writeFile(workDir, `${name}.txt`, "x\n");
        git(["add", "."], workDir);
        git(["commit", "--quiet", "-m", name], workDir);
        git(["checkout", "--quiet", "runway"], workDir);
        squashMergeToTrunk(workDir, "runway", name);
      }
      writeHoldFile(workDir, "runway", holdFileContent);
      git(["checkout", "--quiet", "runway"], workDir);
      return workDir;
    }

    it("clean control: three PERMANENT/ANY entries, no bad bytes -- all three hold, zero disposal commands", () => {
      const workDir = buildThreeFossilsWithHoldFile(
        "alpha ANY PERMANENT\nbravo ANY PERMANENT\ncharlie ANY PERMANENT\n",
      );
      const { status, stderr } = runGuard(workDir);
      expect(status).toBe(1); // refused: every candidate is held, none disposed
      expect(stderr).toMatch(/held: alpha is under an active permanent hold/);
      expect(stderr).toMatch(/held: bravo is under an active permanent hold/);
      expect(stderr).toMatch(/held: charlie is under an active permanent hold/);
      expect(stderr).not.toMatch(/Disposal:/);
      expect(stderr).not.toMatch(/branch -D/);
    });

    it("a zero-width space on the MIDDLE entry's name: bravo refuses loudly and specifically, alpha and charlie still hold normally, and the fix is per-line not per-file", () => {
      const zwspName = "​bravo"; // E2 80 8B, glued to the front, not stripped
      const holdFile = `alpha ANY PERMANENT\n${zwspName} ANY PERMANENT\ncharlie ANY PERMANENT\n`;
      const workDir = buildThreeFossilsWithHoldFile(holdFile);

      const { status, stderr } = runGuard(workDir);
      expect(status).toBe(1);

      // Arm 1: loud and specific -- names the offending entry AND the byte,
      // not a generic "the hold file was rejected".
      expect(stderr).toMatch(/NAME contains a byte outside the printable set/);
      expect(stderr).toMatch(new RegExp(escapeRegExp(zwspName)));
      expect(stderr).toMatch(/visible:/);

      // Arm 2: per line, not per file -- alpha and charlie still hold on
      // their own real entries, unaffected by bravo's corrupted neighbour.
      expect(stderr).toMatch(/held: alpha is under an active permanent hold/);
      expect(stderr).toMatch(/held: charlie is under an active permanent hold/);

      // The defect this whole fix exists for: bravo must never get a
      // disposal command, precisely because the ONLY entry that could have
      // named it is the one whose name we can no longer trust.
      expect(stderr).not.toMatch(/branch -D bravo/);
      // And the refusal is not silent about WHY bravo, specifically, is
      // being withheld from disposal.
      expect(stderr).toMatch(/bravo could not be confirmed clear of the hold list/);
    });

    it("a BOM on the FIRST entry's name behaves the same as a zero-width space on the middle one: reject by byte range, not by a hand-picked list of characters", () => {
      const bomName = "﻿alpha"; // EF BB BF
      const holdFile = `${bomName} ANY PERMANENT\nbravo ANY PERMANENT\ncharlie ANY PERMANENT\n`;
      const workDir = buildThreeFossilsWithHoldFile(holdFile);

      const { status, stderr } = runGuard(workDir);
      expect(status).toBe(1);
      expect(stderr).toMatch(/NAME contains a byte outside the printable set/);
      expect(stderr).toMatch(/held: bravo is under an active permanent hold/);
      expect(stderr).toMatch(/held: charlie is under an active permanent hold/);
      expect(stderr).not.toMatch(/branch -D alpha/);
    });

    it("mutation: reverting the printable-name check on the pre-fix source brings bravo's disposal command back (RED), the fixed script does not (GREEN)", () => {
      const zwspName = "​bravo";
      const holdFile = `alpha ANY PERMANENT\n${zwspName} ANY PERMANENT\ncharlie ANY PERMANENT\n`;
      const workDir = buildThreeFossilsWithHoldFile(holdFile);

      // GREEN: the real, fixed guard in this working tree.
      const fixed = runGuard(workDir);
      expect(fixed.status).toBe(1);
      expect(fixed.stderr).not.toMatch(/branch -D bravo/);

      // RED: the guard as it shipped at 540462ed, before this fix, with
      // nothing else touched -- the anchor is the exact block this fix
      // added, so removing it is equivalent to never having written it.
      const anchor =
        '    if ! printf \'%s\' "$_hold_name" | LC_ALL=C grep -Eq \'^[[:graph:]]+$\'; then\n' +
        "      _HOLD_LIST_POISONED=1\n" +
        '      _hold_poisoned_desc="${_hold_poisoned_desc:+$_hold_poisoned_desc; }\'$_hold_line\' (visible: $(_visible "$_hold_line"))"\n' +
        '      _block "hold list \'$_HOLD_PATH\' at $TRUNK_REF has an entry whose NAME contains a byte outside the printable set: \'$_hold_line\' (visible: $(_visible "$_hold_line")). This name can never match a real ref, so it cannot be trusted to say what it does NOT hold. Refusing to let ANY branch fall through to a disposal command in this run until the hold list is fixed. Other, clean entries still hold normally."\n' +
        "    fi\n";
      const source = readFileSync(SCRIPT_PATH, "utf8");
      const occurrences = source.split(anchor).length - 1;
      expect(occurrences).toBe(1); // targets the real, unique block this fix added
      const mutated = source.replace(anchor, "");
      expect(mutated).not.toBe(source);
      // The fallback in _is_held is now dead code with the flag never set,
      // which is fine -- it must never fire, and this proves it doesn't
      // need to: bravo goes back to being decided by name/SHA match alone.

      const mutantPath = join(root, "mutant-no-printable-check.sh");
      writeFileSync(mutantPath, mutated);
      const red = runGuard(workDir, "origin", mutantPath);
      expect(red.status).toBe(1); // still refuses (still a fossil overall) --
      expect(red.stderr).toMatch(/branch -D bravo/); // -- but now offers to destroy the held one.
    });
  });
});

describe("hygiene-guard.sh, control 20: a locked worktree refuses with no removal command, never `-f -f` (QA gap, _R1#167 G1_BOUNCE)", () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "hygiene-locked-")));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("content-present worktree, locked with a reason: refuses, names the reason, never prints remove --force or -f -f", () => {
    // QA confirmed live: `git status` on a locked worktree works fine, so
    // the old code's content-presence and dirty-state both read correctly
    // and it printed `git worktree remove --force <path>`, which fails
    // with exit 128 ("cannot remove a locked working tree... use 'remove
    // -f -f' to override or unlock first"). Not destructive, but unusable
    // advice for a state that is very plausibly locked on purpose.
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "fix/locked-content-present"], workDir);
    writeFile(workDir, "locked-content.txt", "leftover\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "leftover"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);
    const wtPath = join(root, "locked-wt");
    git(["worktree", "add", "--quiet", wtPath, "fix/locked-content-present"], workDir);
    squashMergeToTrunk(workDir, "runway", "fix/locked-content-present");
    git(["worktree", "lock", "--reason", "operator hold, do not touch", wtPath], workDir);
    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/worktree LOCKED: fix\/locked-content-present/);
    expect(stderr).toMatch(/operator hold, do not touch/);
    expect(stderr).not.toMatch(/remove --force/);
    expect(stderr).not.toMatch(/-f -f/);
  });

  it("content-present worktree, locked with NO reason given: reports '(no reason recorded)', still no removal command", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "fix/locked-no-reason"], workDir);
    writeFile(workDir, "locked-no-reason.txt", "leftover\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "leftover"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);
    const wtPath = join(root, "locked-no-reason-wt");
    git(["worktree", "add", "--quiet", wtPath, "fix/locked-no-reason"], workDir);
    squashMergeToTrunk(workDir, "runway", "fix/locked-no-reason");
    git(["worktree", "lock", wtPath], workDir);
    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/worktree LOCKED: fix\/locked-no-reason.*\(no reason recorded\)/);
    expect(stderr).not.toMatch(/remove --force/);
  });

  it("a locked worktree that is NOT content-present is silent: a lock alone is not a disposal candidate", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "live/locked-unmerged"], workDir);
    writeFile(workDir, "live-locked.txt", "never merged\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "real unmerged work"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);
    const wtPath = join(root, "live-locked-wt");
    git(["worktree", "add", "--quiet", wtPath, "live/locked-unmerged"], workDir);
    git(["worktree", "lock", "--reason", "in progress", wtPath], workDir);

    const { status, stdout, stderr } = runGuard(workDir);
    expect(status).toBe(0);
    expect(stdout).toMatch(/clean/);
    expect(stderr).not.toMatch(/live\/locked-unmerged/);
  });

  it("mutation: removing the locked check lets a locked, content-present worktree get `remove --force` again", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "fix/locked-mutation"], workDir);
    writeFile(workDir, "locked-mutation.txt", "leftover\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "leftover"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);
    const wtPath = join(root, "locked-mutation-wt");
    git(["worktree", "add", "--quiet", wtPath, "fix/locked-mutation"], workDir);
    squashMergeToTrunk(workDir, "runway", "fix/locked-mutation");
    git(["worktree", "lock", "--reason", "do not remove", wtPath], workDir);
    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    // Control: the real, fixed guard refuses with no removal command, in
    // the same session as the mutant.
    const control = runGuard(workDir);
    expect(control.status).toBe(1);
    expect(control.stderr).toMatch(/worktree LOCKED: fix\/locked-mutation/);
    expect(control.stderr).not.toMatch(/remove --force/);

    const anchor =
      '  if [ -n "$_wt_path" ] && [ -n "$_wt_locked" ]; then\n' +
      "    # QA gap (_R1#167 G1_BOUNCE): git status reads fine on a locked\n" +
      "    # worktree, so this has to be checked before the dirty-state branches\n" +
      "    # below, not folded into them -- a locked worktree's dirty state is\n" +
      "    # genuinely knowable here, it just must never turn into a `remove\n" +
      "    # --force` (or `-f -f`) recommendation. A lock is a human saying do not\n" +
      "    # touch this; the guard's job is to report that, not to teach anyone\n" +
      "    # how to override a deliberate lock.\n" +
      '    _block "worktree LOCKED: $_branch ($_wt_path) already in $TRUNK_REF (detected via $_DETECTOR), but the worktree record is locked ($_wt_locked). No removal command. Its owner decides."\n' +
      "    continue\n" +
      "  fi\n";
    const source = readFileSync(SCRIPT_PATH, "utf8");
    const occurrences = source.split(anchor).length - 1;
    expect(occurrences).toBe(1); // mutation targets a unique anchor, not a guess
    const mutated = source.replace(anchor, "");
    expect(mutated).not.toBe(source);

    const mutantPath = join(root, "mutant-no-lock-check.sh");
    writeFileSync(mutantPath, mutated);

    const mutantResult = runGuard(workDir, "origin", mutantPath);
    expect(mutantResult.status).toBe(1);
    expect(mutantResult.stderr).toMatch(/Disposal: git worktree remove --force/);
  });
});

describe("hygiene-guard.sh, control 21: a ref UPDATE that would orphan a held object refuses, not only a ref DELETION (Overwatch ruling, _R1#167 G1_BOUNCE)", () => {
  let root: string;
  let realGit: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "hygiene-orphan-")));
    realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /**
   * This trigger reads the pre-push stdin protocol directly and is
   * independent of content-presence or governance -- it never depends on
   * the branch being a disposal candidate, only on a held commit becoming
   * unreachable. So every fixture here is deliberately a single, genuinely
   * unmerged branch: absent this check, the guard would find NOTHING to
   * refuse about it (not a fossil, not content-present, not otherwise
   * held-and-a-candidate), which is what makes each fixture's refusal (or
   * lack of one) attributable to this one trigger and nothing else --
   * exactly the discipline QA's status finding demands applied up front.
   */
  function buildHandworkFixture() {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "handwork"], workDir);
    writeFile(workDir, "handwork.txt", "hand-authored, cannot be reconstructed\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "handwork v1"], workDir);
    const heldSha = git(["rev-parse", "handwork"], workDir);
    git(["push", "--quiet", "origin", "handwork"], workDir); // this is what's "already pushed"
    git(["checkout", "--quiet", "runway"], workDir);
    writeHoldFile(workDir, "runway", `handwork ${heldSha} OPERATOR-HOLD\n`);
    git(["checkout", "--quiet", "handwork"], workDir);
    return { workDir, heldSha };
  }

  it("a force-push that moves the ref away from a held commit refuses, even though no ref was ever deleted", () => {
    const { workDir, heldSha } = buildHandworkFixture();

    // Simulate the force-push: rewrite handwork's tip to a commit that does
    // NOT contain heldSha as an ancestor (a hard reset to trunk plus a new,
    // unrelated commit, the ordinary shape of "rebased onto today's main").
    git(["reset", "--hard", "runway"], workDir);
    writeFile(workDir, "rebased.txt", "the branch after a force-push\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "rewritten history"], workDir);
    const newSha = git(["rev-parse", "handwork"], workDir);
    expect(() => execFileSync("git", ["merge-base", "--is-ancestor", heldSha, newSha], { cwd: workDir, env: ISOLATED_GIT_ENV })).toThrow(); // confirms the fixture: heldSha is genuinely not an ancestor of newSha

    const stdin = `refs/heads/handwork ${newSha} refs/heads/handwork ${heldSha}\n`;
    const { status, stderr } = runGuardWithStdin(workDir, stdin);
    expect(status).toBe(1);
    expect(stderr).toMatch(/orphan a held object/);
    expect(stderr).toMatch(new RegExp(heldSha));
  });

  it("a deletion of the ref holding a held commit refuses too: a delete is just the update whose new tip is nothing", () => {
    const { workDir, heldSha } = buildHandworkFixture();
    const zero = "0".repeat(40);
    const stdin = `(delete) ${zero} refs/heads/handwork ${heldSha}\n`;
    const { status, stderr } = runGuardWithStdin(workDir, stdin);
    expect(status).toBe(1);
    expect(stderr).toMatch(/orphan a held object/);
  });

  it("an ordinary fast-forward on the held branch (new tip still contains the held commit) is silent from this trigger", () => {
    const { workDir, heldSha } = buildHandworkFixture();
    writeFile(workDir, "one-more.txt", "one more commit, held commit still an ancestor\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "advance the held branch"], workDir);
    const newSha = git(["rev-parse", "handwork"], workDir);

    const stdin = `refs/heads/handwork ${newSha} refs/heads/handwork ${heldSha}\n`;
    const { status, stdout, stderr } = runGuardWithStdin(workDir, stdin);
    // handwork itself is real, unmerged, not-content-present work: no
    // disposal candidate, no hold-message refusal, and now no orphan
    // refusal either, since the held commit is still an ancestor of the
    // new tip.
    expect(status).toBe(0);
    expect(stdout).toMatch(/clean/);
    expect(stderr).not.toMatch(/orphan/);
  });

  it("a ref-update naming an unrelated branch, with the held branch untouched, does not orphan anything", () => {
    const { workDir } = buildHandworkFixture();
    git(["checkout", "--quiet", "-b", "unrelated/branch"], workDir);
    writeFile(workDir, "unrelated.txt", "x\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "unrelated work"], workDir);
    const unrelatedSha = git(["rev-parse", "unrelated/branch"], workDir);
    const zero = "0".repeat(40);

    const stdin = `refs/heads/unrelated/branch ${unrelatedSha} refs/heads/unrelated/branch ${zero}\n`;
    const { status, stdout, stderr } = runGuardWithStdin(workDir, stdin);
    expect(status).toBe(0);
    expect(stdout).toMatch(/clean/);
    expect(stderr).not.toMatch(/orphan/);
  });

  it("empty stdin (a real, genuinely empty push spec) proceeds silently: empty and absent must not render alike", () => {
    const { workDir } = buildRepo(root, "runway");
    const { status, stdout } = runGuardWithStdin(workDir, "");
    expect(status).toBe(0);
    expect(stdout).toMatch(/clean/);
  });

  it("no hold list entries at all: the trigger is a no-op regardless of what stdin says", () => {
    const { workDir } = buildRepo(root, "runway"); // ships the default empty .hygiene-hold
    git(["checkout", "--quiet", "-b", "some/branch"], workDir);
    writeFile(workDir, "x.txt", "x\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "x"], workDir);
    const sha = git(["rev-parse", "some/branch"], workDir);
    const zero = "0".repeat(40);
    git(["checkout", "--quiet", "runway"], workDir);

    const stdin = `refs/heads/some/branch ${zero} refs/heads/some/branch ${sha}\n`;
    const { status, stdout } = runGuardWithStdin(workDir, stdin);
    expect(status).toBe(0);
    expect(stdout).toMatch(/clean/);
  });

  it("fault injection: breaking 'cat-file' refuses rather than treating an unresolvable old tip as 'nothing to orphan'", () => {
    const { workDir, heldSha } = buildHandworkFixture();
    const newSha = git(["rev-parse", "handwork"], workDir);
    const stdin = `refs/heads/handwork ${newSha} refs/heads/handwork ${heldSha}\n`;

    // Isolation, same discipline as the status fixture above: this bed's
    // ONLY branch besides trunk is `handwork`, which is not content-present
    // and not a fossil, so absent this trigger the guard would be clean.
    // A refusal here is attributable to this trigger and nothing else.
    const healthy = runGuardWithStdin(workDir, stdin);
    expect(healthy.status).toBe(0);

    const faulted = runGuardFaultInjectedWithStdin(workDir, "cat-file", root, realGit, stdin);
    expect(faulted.status).not.toBe(0);
    expect(faulted.stderr).toMatch(/git cat-file -e failed/);
    expect(faulted.stderr).not.toMatch(/orphan a held object/); // never silently reported "not orphaned"
  });

  it("fault injection: breaking 'merge-base' refuses rather than treating an unresolvable reachability question as 'nothing to orphan'", () => {
    const { workDir, heldSha } = buildHandworkFixture();
    const newSha = git(["rev-parse", "handwork"], workDir);
    const stdin = `refs/heads/handwork ${newSha} refs/heads/handwork ${heldSha}\n`;

    const healthy = runGuardWithStdin(workDir, stdin);
    expect(healthy.status).toBe(0);

    const faulted = runGuardFaultInjectedWithStdin(workDir, "merge-base", root, realGit, stdin);
    expect(faulted.status).not.toBe(0);
    expect(faulted.stderr).toMatch(/git merge-base --is-ancestor failed/);
  });

  it("mutation: removing the call to _check_orphaned_holds lets the force-push through with no refusal at all", () => {
    const { workDir, heldSha } = buildHandworkFixture();
    git(["reset", "--hard", "runway"], workDir);
    writeFile(workDir, "rebased.txt", "the branch after a force-push\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "rewritten history"], workDir);
    const newSha = git(["rev-parse", "handwork"], workDir);
    const stdin = `refs/heads/handwork ${newSha} refs/heads/handwork ${heldSha}\n`;

    // Control: the real, fixed guard refuses, in the same session as the mutant.
    const control = runGuardWithStdin(workDir, stdin);
    expect(control.status).toBe(1);
    expect(control.stderr).toMatch(/orphan a held object/);

    const anchor = "\n_check_orphaned_holds\n";
    const source = readFileSync(SCRIPT_PATH, "utf8");
    const occurrences = source.split(anchor).length - 1;
    expect(occurrences).toBe(1); // mutation targets a unique anchor, not a guess
    const mutated = source.replace(anchor, "\n\n");
    expect(mutated).not.toBe(source);

    const mutantPath = join(root, "mutant-no-orphan-check.sh");
    writeFileSync(mutantPath, mutated);

    const mutantResult = runGuardWithStdin(workDir, stdin, "origin", mutantPath);
    // Without the call, the force-push goes through: handwork is still
    // just an ordinary, non-content-present, unheld-by-the-loop branch.
    expect(mutantResult.status).toBe(0);
    expect(mutantResult.stdout).toMatch(/clean/);
  });
});

describe("hygiene-guard.sh, control 22: the printed disposal command is usable on a space-containing path (QA gap, _R1#167 G1_BOUNCE)", () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "hygiene-space-")));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("a worktree at a path with a space gets a single-quoted, pasteable `git worktree remove --force` command", () => {
    // QA reproduced: the guard's printed command was unquoted, so pasting
    // it verbatim against a path containing a space (ordinary on macOS)
    // exited 129. Detection itself was already correct; this is only the
    // message text, so the control both checks the quoting AND proves the
    // quoted command actually works when run for real.
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "fix/space-in-path"], workDir);
    writeFile(workDir, "space-path.txt", "leftover\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "leftover"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);
    const wtPath = join(root, "space probe", "wt with space");
    mkdirSync(join(root, "space probe"), { recursive: true });
    git(["worktree", "add", "--quiet", wtPath, "fix/space-in-path"], workDir);
    squashMergeToTrunk(workDir, "runway", "fix/space-in-path");
    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    const match = stderr.match(/Disposal: (git worktree remove --force '.*')$/m);
    expect(match).not.toBeNull();
    const disposalCmd = match![1];
    expect(disposalCmd).toContain(`'${wtPath}'`);

    // Prove it is actually pasteable, not just quoted-looking: run the
    // printed command for real and confirm the worktree is gone.
    execFileSync("sh", ["-c", disposalCmd], { cwd: workDir, encoding: "utf8", env: ISOLATED_GIT_ENV });
    const listing = git(["worktree", "list", "--porcelain"], workDir);
    expect(listing).not.toContain(wtPath);
  });
});

describe("hygiene-guard.sh, control 23: an uninitialized submodule with real uncommitted content reports UNKNOWN dirty state, never a false clean (_R1#167 G1_BOUNCE, TP reproduced live against this guard's own newest SHA)", () => {
  let root: string;
  let subOriginDir: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "hygiene-submodule-")));
    subOriginDir = join(root, "sub-origin.git");
    mkdirSync(subOriginDir, { recursive: true });
    git(["init", "--quiet", "--bare", "-b", "main"], subOriginDir);
    const subSeed = join(root, "sub-seed");
    mkdirSync(subSeed, { recursive: true });
    git(["init", "--quiet", "-b", "main"], subSeed);
    writeFile(subSeed, "README.md", "sub\n");
    git(["add", "."], subSeed);
    git(["commit", "--quiet", "-m", "sub root"], subSeed);
    git(["push", "--quiet", subOriginDir, "HEAD:main"], subSeed);
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /**
   * Adds the submodule to trunk directly, BEFORE any branch below forks
   * from it -- so every fixture's branch and worktree already carries the
   * submodule as ordinary shared history, exactly as TP's repro did
   * (guard installed first, so branch-governance scoping is never the
   * reason a case passes or fails here).
   */
  function addSubmoduleToTrunk(workDir: string, trunkName: string, subPath = "sub", origin = subOriginDir) {
    git(["checkout", "--quiet", trunkName], workDir);
    git(["submodule", "add", "--quiet", origin, subPath], workDir);
    git(["commit", "--quiet", "-m", `add submodule ${subPath}`], workDir);
    git(["push", "--quiet", "origin", trunkName], workDir);
  }

  it("uninitialized submodule + non-empty working dir: UNKNOWN dirty state, NO removal command, file survives (TP's control 1)", () => {
    const { workDir } = buildRepo(root, "runway");
    addSubmoduleToTrunk(workDir, "runway");

    git(["checkout", "--quiet", "-b", "bump-sub"], workDir);
    writeFile(workDir, "unrelated.txt", "an ordinary change, unrelated to the submodule\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "bump-sub"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);
    squashMergeToTrunk(workDir, "runway", "bump-sub");

    const wtPath = join(root, "wt-uninit-nonempty");
    git(["worktree", "add", "--quiet", wtPath, "bump-sub"], workDir);
    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    // Confirm the fixture, own-hands, before trusting the guard's verdict:
    // the new worktree's submodule is genuinely uninitialized (a leading
    // '-' on the SHA column, `git worktree add` never runs submodule init),
    // and git status itself is genuinely blind to the file placed under it.
    const subStatus = git(["submodule", "status"], wtPath);
    expect(subStatus).toMatch(/^-/);
    writeFileSync(join(wtPath, "sub", "orphan-notes.txt"), "orphaned uncommitted work\n");
    const porcelain = execFileSync("git", ["-C", wtPath, "status", "--porcelain"], {
      encoding: "utf8",
      env: ISOLATED_GIT_ENV,
    }).trim();
    expect(porcelain).toBe("");

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/worktree UNKNOWN dirty-state: bump-sub/);
    expect(stderr).toMatch(/submodule 'sub' is uninitialized/);
    expect(stderr).not.toMatch(/remove --force/);

    // The point of the fix: the file must still be there afterward.
    expect(existsSync(join(wtPath, "sub", "orphan-notes.txt"))).toBe(true);
  });

  it("uninitialized submodule + genuinely empty working dir: stays a disposal candidate, not over-refused (TP's control 2)", () => {
    const { workDir } = buildRepo(root, "runway");
    addSubmoduleToTrunk(workDir, "runway");

    git(["checkout", "--quiet", "-b", "bump-sub-empty"], workDir);
    writeFile(workDir, "unrelated-2.txt", "an ordinary change\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "bump-sub-empty"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);
    squashMergeToTrunk(workDir, "runway", "bump-sub-empty");

    const wtPath = join(root, "wt-uninit-empty");
    git(["worktree", "add", "--quiet", wtPath, "bump-sub-empty"], workDir);
    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    const subStatus = git(["submodule", "status"], wtPath);
    expect(subStatus).toMatch(/^-/); // uninitialized, but nothing was ever written inside it

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/Disposal: git worktree remove --force/);
    expect(stderr).not.toMatch(/UNKNOWN dirty-state/);
  });

  it("initialized submodule with a dirty file inside: already correct today, stays DISPOSABLE-BUT-DIRTY (TP's control 3, negative control)", () => {
    const { workDir } = buildRepo(root, "runway");
    addSubmoduleToTrunk(workDir, "runway");

    git(["checkout", "--quiet", "-b", "bump-sub-dirty"], workDir);
    writeFile(workDir, "unrelated-3.txt", "an ordinary change\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "bump-sub-dirty"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);
    squashMergeToTrunk(workDir, "runway", "bump-sub-dirty");

    const wtPath = join(root, "wt-init-dirty");
    git(["worktree", "add", "--quiet", wtPath, "bump-sub-dirty"], workDir);
    git(["submodule", "update", "--init", "--quiet"], wtPath);
    writeFileSync(join(wtPath, "sub", "README.md"), "dirtied, tracked file changed in place\n");
    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/worktree DISPOSABLE-BUT-DIRTY: bump-sub-dirty/);
    expect(stderr).not.toMatch(/remove --force/);
    expect(stderr).not.toMatch(/UNKNOWN dirty-state/);
  });

  it("no submodule at all: byte-identical to an ordinary worktree fossil, this fix taxes nothing for ordinary repos (TP's control 4)", () => {
    const { workDir } = buildRepo(root, "runway");
    git(["checkout", "--quiet", "-b", "bump-nosub"], workDir);
    writeFile(workDir, "unrelated-4.txt", "an ordinary change\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "bump-nosub"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);
    squashMergeToTrunk(workDir, "runway", "bump-nosub");

    const wtPath = join(root, "wt-nosub");
    git(["worktree", "add", "--quiet", wtPath, "bump-nosub"], workDir);
    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/Disposal: git worktree remove --force/);
    expect(stderr).not.toMatch(/UNKNOWN dirty-state/);
  });

  it("mutation: removing the submodule check lets the uninitialized-and-nonempty case emit the removal command again (TP's control 5)", () => {
    const { workDir } = buildRepo(root, "runway");
    addSubmoduleToTrunk(workDir, "runway");

    git(["checkout", "--quiet", "-b", "bump-sub-mut"], workDir);
    writeFile(workDir, "unrelated-5.txt", "an ordinary change\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "bump-sub-mut"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);
    squashMergeToTrunk(workDir, "runway", "bump-sub-mut");

    const wtPath = join(root, "wt-uninit-mut");
    git(["worktree", "add", "--quiet", wtPath, "bump-sub-mut"], workDir);
    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);
    writeFileSync(join(wtPath, "sub", "orphan-notes-mut.txt"), "orphaned\n");

    // Control: the real, fixed guard refuses UNKNOWN, no removal command,
    // in the same session as the mutant.
    const control = runGuard(workDir);
    expect(control.status).toBe(1);
    expect(control.stderr).toMatch(/UNKNOWN dirty-state: bump-sub-mut/);
    expect(control.stderr).not.toMatch(/remove --force/);

    const anchor =
      '          if [ -n "$_sub_path" ] && [ -n "$(find "$_wt/$_sub_path" -mindepth 1 -print -quit 2>/dev/null)" ]; then\n' +
      '            rm -f "$_sub_file"\n' +
      '            _DIRTY_STATE="unknown"\n' +
      "            _DIRTY_COUNT=0\n" +
      '            _DIRTY_UNKNOWN_REASON="submodule \'$_sub_path\' is uninitialized and its working directory is non-empty; git status is blind to it"\n' +
      "            return\n" +
      "          fi\n";
    const source = readFileSync(SCRIPT_PATH, "utf8");
    const occurrences = source.split(anchor).length - 1;
    expect(occurrences).toBe(1); // mutation targets a unique anchor, not a guess
    const mutated = source.replace(anchor, "");
    expect(mutated).not.toBe(source);

    const mutantPath = join(root, "mutant-no-submodule-check.sh");
    writeFileSync(mutantPath, mutated);

    const mutantResult = runGuard(workDir, "origin", mutantPath);
    // Without the check, the loop over submodule-status lines never flags
    // anything, _count_dirty falls through to "clean", and the ordinary
    // worktree-fossil path prints the destructive command again -- the
    // exact regression TP's live repro caught.
    expect(mutantResult.status).toBe(1);
    expect(mutantResult.stderr).toMatch(/Disposal: git worktree remove --force/);
  });

  it("submodule path containing a SPACE: still UNKNOWN, NO removal command, file survives (TP reproduced live on 51255e2f)", () => {
    // TP's own repro: awk splits git submodule status's path column on
    // whitespace, so "my sub" became "my", the guard probed a directory
    // that never existed, read it as empty, and fell through to the
    // destructive command. This is the same class of gap as the disposal
    // path's own quoting fix earlier in this file -- a space in a real
    // path is ordinary on macOS, not exotic.
    const { workDir } = buildRepo(root, "runway");
    addSubmoduleToTrunk(workDir, "runway", "my sub");

    git(["checkout", "--quiet", "-b", "bump-sub-space"], workDir);
    writeFile(workDir, "unrelated-space.txt", "an ordinary change\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "bump-sub-space"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);
    squashMergeToTrunk(workDir, "runway", "bump-sub-space");

    const wtPath = join(root, "wt-uninit-space");
    git(["worktree", "add", "--quiet", wtPath, "bump-sub-space"], workDir);
    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    const subStatus = git(["submodule", "status"], wtPath);
    expect(subStatus).toMatch(/^-.{40} my sub$/);
    writeFileSync(join(wtPath, "my sub", "notes.txt"), "at risk\n");
    const porcelain = execFileSync("git", ["-C", wtPath, "status", "--porcelain"], {
      encoding: "utf8",
      env: ISOLATED_GIT_ENV,
    }).trim();
    expect(porcelain).toBe("");

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/worktree UNKNOWN dirty-state: bump-sub-space/);
    expect(stderr).toMatch(/submodule 'my sub' is uninitialized/);
    expect(stderr).not.toMatch(/remove --force/);
    expect(existsSync(join(wtPath, "my sub", "notes.txt"))).toBe(true);
  });

  it("submodule path containing a single quote: still UNKNOWN, NO removal command, file survives", () => {
    const { workDir } = buildRepo(root, "runway");
    addSubmoduleToTrunk(workDir, "runway", "quo'te sub");

    git(["checkout", "--quiet", "-b", "bump-sub-quote"], workDir);
    writeFile(workDir, "unrelated-quote.txt", "an ordinary change\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "bump-sub-quote"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);
    squashMergeToTrunk(workDir, "runway", "bump-sub-quote");

    const wtPath = join(root, "wt-uninit-quote");
    git(["worktree", "add", "--quiet", wtPath, "bump-sub-quote"], workDir);
    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    const subStatus = git(["submodule", "status"], wtPath);
    expect(subStatus).toMatch(/^-.{40} quo'te sub$/);
    writeFileSync(join(wtPath, "quo'te sub", "notes.txt"), "at risk\n");

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/worktree UNKNOWN dirty-state: bump-sub-quote/);
    expect(stderr).toMatch(/submodule 'quo'te sub' is uninitialized/);
    expect(stderr).not.toMatch(/remove --force/);
    expect(existsSync(join(wtPath, "quo'te sub", "notes.txt"))).toBe(true);
  });

  it("two submodules, first initialized and second uninitialized+non-empty: the loop does not return on its first (non-matching) entry", () => {
    const secondOriginDir = join(root, "sub-origin-2.git");
    mkdirSync(secondOriginDir, { recursive: true });
    git(["init", "--quiet", "--bare", "-b", "main"], secondOriginDir);
    const secondSeed = join(root, "sub-seed-2");
    mkdirSync(secondSeed, { recursive: true });
    git(["init", "--quiet", "-b", "main"], secondSeed);
    writeFile(secondSeed, "README.md", "sub2\n");
    git(["add", "."], secondSeed);
    git(["commit", "--quiet", "-m", "sub2 root"], secondSeed);
    git(["push", "--quiet", secondOriginDir, "HEAD:main"], secondSeed);

    const { workDir } = buildRepo(root, "runway");
    addSubmoduleToTrunk(workDir, "runway", "sub-a", subOriginDir);
    addSubmoduleToTrunk(workDir, "runway", "sub-b", secondOriginDir);

    git(["checkout", "--quiet", "-b", "bump-two-subs"], workDir);
    writeFile(workDir, "unrelated-two.txt", "an ordinary change\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "bump-two-subs"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);
    squashMergeToTrunk(workDir, "runway", "bump-two-subs");

    const wtPath = join(root, "wt-two-subs");
    git(["worktree", "add", "--quiet", wtPath, "bump-two-subs"], workDir);
    // Initialize ONLY the first submodule, leaving the second uninitialized.
    git(["submodule", "update", "--init", "--quiet", "--", "sub-a"], wtPath);
    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    // git()'s own helper trims the whole output, which eats sub-a's
    // leading space if it's the first line -- assert on absence of a
    // leading '-' for sub-a rather than presence of a leading space.
    const subStatus = git(["submodule", "status"], wtPath);
    expect(subStatus).not.toMatch(/^-.{40} sub-a/m); // initialized: no leading '-'
    expect(subStatus).toMatch(/^-.{40} sub-b/m); // uninitialized: leading '-'
    writeFileSync(join(wtPath, "sub-b", "orphan.txt"), "orphaned\n");

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/worktree UNKNOWN dirty-state: bump-two-subs/);
    expect(stderr).toMatch(/submodule 'sub-b' is uninitialized/);
    expect(stderr).not.toMatch(/remove --force/);
  });

  it("fault injection: 'git submodule status' itself failing refuses UNKNOWN, never a false clean (TP's instrument_fail control)", () => {
    // Uses the shared git-fail shim (control 16) rather than corrupting a
    // real .git pointer: own-hands testing showed a corrupted submodule
    // gitdir also breaks the earlier plain `git status --porcelain` call,
    // which would exercise the PRE-EXISTING corrupt-.git branch instead of
    // this new one. The shim breaks ONLY the "submodule" subcommand,
    // leaving "status" answering for real, so this test's failure is
    // attributable to the submodule-status read and nothing else.
    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    const { workDir } = buildRepo(root, "runway");
    addSubmoduleToTrunk(workDir, "runway");

    git(["checkout", "--quiet", "-b", "bump-sub-fault"], workDir);
    writeFile(workDir, "unrelated-fault.txt", "an ordinary change\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "bump-sub-fault"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);
    squashMergeToTrunk(workDir, "runway", "bump-sub-fault");

    const wtPath = join(root, "wt-sub-fault");
    git(["worktree", "add", "--quiet", wtPath, "bump-sub-fault"], workDir);
    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    const result = runGuardFaultInjected(workDir, "submodule", root, realGit);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/worktree UNKNOWN dirty-state: bump-sub-fault/);
    expect(result.stderr).toMatch(/git submodule status could not be read/);
    expect(result.stderr).not.toMatch(/remove --force/);
  });

  it("mutation: reverting the positional cut to awk field-splitting loses a spaced submodule path, destructive command returns", () => {
    const { workDir } = buildRepo(root, "runway");
    addSubmoduleToTrunk(workDir, "runway", "my sub");

    git(["checkout", "--quiet", "-b", "bump-sub-space-mut"], workDir);
    writeFile(workDir, "unrelated-space-mut.txt", "an ordinary change\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "bump-sub-space-mut"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);
    squashMergeToTrunk(workDir, "runway", "bump-sub-space-mut");

    const wtPath = join(root, "wt-uninit-space-mut");
    git(["worktree", "add", "--quiet", wtPath, "bump-sub-space-mut"], workDir);
    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);
    writeFileSync(join(wtPath, "my sub", "notes-mut.txt"), "at risk\n");

    // Control: the real, fixed guard refuses UNKNOWN for the spaced path.
    const control = runGuard(workDir);
    expect(control.status).toBe(1);
    expect(control.stderr).toMatch(/UNKNOWN dirty-state: bump-sub-space-mut/);
    expect(control.stderr).not.toMatch(/remove --force/);

    const anchor = '_sub_path=$(printf \'%s\\n\' "$_sub_line" | cut -c43-)';
    const source = readFileSync(SCRIPT_PATH, "utf8");
    const occurrences = source.split(anchor).length - 1;
    expect(occurrences).toBe(1); // mutation targets a unique anchor, not a guess
    const mutated = source.replace(anchor, '_sub_path=$(printf \'%s\\n\' "$_sub_line" | awk \'{print $2}\')');
    expect(mutated).not.toBe(source);

    const mutantPath = join(root, "mutant-awk-split-submodule-path.sh");
    writeFileSync(mutantPath, mutated);

    const mutantResult = runGuard(workDir, "origin", mutantPath);
    // Reverted to word-splitting, "$_sub_path" becomes "my" -- a
    // directory that never existed reads as empty, and the destructive
    // command comes back for a worktree that still holds a real file.
    expect(mutantResult.status).toBe(1);
    expect(mutantResult.stderr).toMatch(/Disposal: git worktree remove --force/);
  });

  /**
   * Builds a superproject -> mid (its own repo) -> mid/inner submodule
   * chain: mid itself has "inner" registered as a submodule. Returns
   * workDir with "mid" added to trunk and squash-merged in via
   * "bump-nested", plus a worktree at wtPath with ONLY "mid" initialized,
   * leaving "mid/inner" uninitialized -- the exact shape TP/QA reproduced
   * live (_R1#167 G1_BOUNCE): a nested submodule uninitialized one level
   * inside an INITIALIZED top-level one.
   */
  function buildNestedSubmoduleFixture(root: string) {
    const innerOriginDir = join(root, "inner-origin.git");
    mkdirSync(innerOriginDir, { recursive: true });
    git(["init", "--quiet", "--bare", "-b", "main"], innerOriginDir);
    const innerSeed = join(root, "inner-seed");
    mkdirSync(innerSeed, { recursive: true });
    git(["init", "--quiet", "-b", "main"], innerSeed);
    writeFile(innerSeed, "README.md", "inner\n");
    git(["add", "."], innerSeed);
    git(["commit", "--quiet", "-m", "inner root"], innerSeed);
    git(["push", "--quiet", innerOriginDir, "HEAD:main"], innerSeed);

    const midOriginDir = join(root, "mid-origin.git");
    mkdirSync(midOriginDir, { recursive: true });
    git(["init", "--quiet", "--bare", "-b", "main"], midOriginDir);
    const midSeed = join(root, "mid-seed");
    mkdirSync(midSeed, { recursive: true });
    git(["init", "--quiet", "-b", "main"], midSeed);
    git(["submodule", "add", "--quiet", innerOriginDir, "inner"], midSeed);
    git(["commit", "--quiet", "-m", "mid root + inner submodule"], midSeed);
    git(["push", "--quiet", midOriginDir, "HEAD:main"], midSeed);

    const { workDir } = buildRepo(root, "runway");
    addSubmoduleToTrunk(workDir, "runway", "mid", midOriginDir);

    git(["checkout", "--quiet", "-b", "bump-nested"], workDir);
    writeFile(workDir, "unrelated-nested.txt", "an ordinary change\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "bump-nested"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);
    squashMergeToTrunk(workDir, "runway", "bump-nested");

    const wtPath = join(root, "wt-nested");
    git(["worktree", "add", "--quiet", wtPath, "bump-nested"], workDir);
    // Initialize ONLY the top-level "mid" submodule, leaving "mid/inner" uninitialized.
    git(["submodule", "update", "--init", "--quiet", "--", "mid"], wtPath);
    git(["fetch", "--quiet", "origin"], workDir);
    git(["checkout", "--quiet", "runway"], workDir);

    return { workDir, wtPath };
  }

  it("a NESTED uninitialized submodule (top-level 'mid' initialized, 'mid/inner' uninitialized) is still UNKNOWN dirty-state, NO removal command, file survives (TP/QA _R1#167 G1_BOUNCE, --recursive)", () => {
    const { workDir, wtPath } = buildNestedSubmoduleFixture(root);

    // Confirm the shape QA/TP measured: the NON-recursive call the guard
    // used to make cannot see the nested entry at all -- it reports no
    // leading '-' anywhere, because the top-level "mid" IS initialized.
    // Only --recursive surfaces "mid/inner"'s own leading '-'.
    const subStatusFlat = git(["submodule", "status"], wtPath);
    expect(subStatusFlat).not.toMatch(/^-/m);
    const subStatusRecursive = git(["submodule", "status", "--recursive"], wtPath);
    expect(subStatusRecursive).toMatch(/^-.{40} mid\/inner$/m);

    writeFileSync(join(wtPath, "mid", "inner", "orphan.txt"), "orphaned nested\n");
    const porcelain = execFileSync("git", ["-C", wtPath, "status", "--porcelain"], {
      encoding: "utf8",
      env: ISOLATED_GIT_ENV,
    }).trim();
    expect(porcelain).toBe("");

    const { status, stderr } = runGuard(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/worktree UNKNOWN dirty-state: bump-nested/);
    expect(stderr).toMatch(/submodule 'mid\/inner' is uninitialized/);
    expect(stderr).not.toMatch(/remove --force/);
    expect(existsSync(join(wtPath, "mid", "inner", "orphan.txt"))).toBe(true);
  });

  it("mutation: dropping --recursive from the submodule status call loses a NESTED uninitialized submodule, destructive command returns", () => {
    const { workDir, wtPath } = buildNestedSubmoduleFixture(root);
    writeFileSync(join(wtPath, "mid", "inner", "orphan-mut.txt"), "orphaned nested\n");

    // Control: the real, fixed guard refuses UNKNOWN for the nested case.
    const control = runGuard(workDir);
    expect(control.status).toBe(1);
    expect(control.stderr).toMatch(/UNKNOWN dirty-state: bump-nested/);
    expect(control.stderr).not.toMatch(/remove --force/);

    const anchor = 'git -C "$_wt" submodule status --recursive';
    const source = readFileSync(SCRIPT_PATH, "utf8");
    const occurrences = source.split(anchor).length - 1;
    expect(occurrences).toBe(1); // mutation targets a unique anchor, not a guess
    const mutated = source.replace(anchor, 'git -C "$_wt" submodule status');
    expect(mutated).not.toBe(source);

    const mutantPath = join(root, "mutant-non-recursive-submodule-status.sh");
    writeFileSync(mutantPath, mutated);

    const mutantResult = runGuard(workDir, "origin", mutantPath);
    // Reverted to non-recursive, "mid/inner"'s own leading '-' is never
    // seen because "mid" itself IS initialized -- the destructive command
    // comes back for a worktree that still holds real, nested content.
    expect(mutantResult.status).toBe(1);
    expect(mutantResult.stderr).toMatch(/Disposal: git worktree remove --force/);
  });
});
