/**
 * _R1#171: proves the actual WIRING between scripts/hooks/pre-push and
 * scripts/hygiene-guard.sh, not just the guard's own logic (already covered
 * by scripts/hygiene-guard.test.ts). The ticket's own measured defect was
 * in this wiring, not in the guard: pre-push:38 hardcoded "origin" as the
 * remote it invokes the guard with, and the guard derives the trunk BRANCH
 * from that remote's own default HEAD, which is wrong for any repo with a
 * fork (_R1 itself: origin is jasonburks23/_R1, upstream is
 * Hunt-Gather-Create/_R1, and upstream's default branch is "main" while
 * Runway's real trunk is "runway").
 *
 * This suite drives the REAL pre-push script the way git itself does: via
 * `core.hooksPath` plus a real `git push`, asserting on the push's own exit
 * code and printed output, never by calling hygiene-guard.sh directly or by
 * reading pre-push's source and reasoning about what it should do. A
 * correct hygiene-guard.sh behind an unwired or mis-wired pre-push is
 * exactly the defect class this ticket exists to close, so the call site
 * is what gets exercised here, not the guard's internals a second time.
 *
 * Fixtures are local, offline git repos, same shape and isolation
 * discipline as scripts/hygiene-guard.test.ts: GIT_DIR/GIT_WORK_TREE/
 * GIT_INDEX_FILE/GIT_COMMON_DIR stripped from every git invocation, so a
 * hook process never accidentally resolves against the real repository
 * this suite itself runs inside of.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const HYGIENE_GUARD_PATH = join(__dirname, "..", "hygiene-guard.sh");
const PRE_PUSH_PATH = join(__dirname, "pre-push");

const ISOLATED_GIT_ENV = { ...process.env };
delete ISOLATED_GIT_ENV.GIT_DIR;
delete ISOLATED_GIT_ENV.GIT_WORK_TREE;
delete ISOLATED_GIT_ENV.GIT_INDEX_FILE;
delete ISOLATED_GIT_ENV.GIT_COMMON_DIR;
// The test-suite stage of pre-push (pnpm test:run) has nothing to run
// against inside a bare fixture repo with no package.json. RUNWAY_SKIP_PREPUSH
// is pre-push's own documented, deliberate skip for that stage (see the
// comment block at the top of scripts/hooks/pre-push) -- it does not touch
// the hygiene-guard step this suite is exercising, which has no skip flag
// of its own.
ISOLATED_GIT_ENV.RUNWAY_SKIP_PREPUSH = "1";

const GIT_IDENTITY = [
  "-c",
  "user.name=pre-push-test",
  "-c",
  "user.email=pre-push-test@example.invalid",
  "-c",
  "gc.auto=0",
  "-c",
  "protocol.file.allow=always",
];

function git(args: string[], cwd: string, env: NodeJS.ProcessEnv = ISOLATED_GIT_ENV): string {
  return execFileSync("git", [...GIT_IDENTITY, ...args], { cwd, encoding: "utf8", env }).trim();
}

function writeFile(dir: string, name: string, content: string) {
  writeFileSync(join(dir, name), content);
}

interface PushResult {
  status: number;
  stdout: string;
  stderr: string;
  /** stdout+stderr concatenated. pre-push's own `echo` lines land on stdout
   * (a client-side hook's stdout passes straight through to the terminal,
   * unprefixed); hygiene-guard.sh's `_block` lines and git's own "error:"
   * lines land on stderr. Assert against this combined text, not either
   * stream alone, so a test does not silently pass or fail depending on
   * which of the two scripts happened to print the substring it's
   * checking for. */
  combined: string;
}

/**
 * Pushes localRef(s) to remote/remoteBranch from workDir, through the real
 * installed hook. refspec accepts an array so a single invocation can carry
 * more than one ref update (_R1#148 acceptance 3: one delete plus one real
 * ref, in one `git push`). A 15s timeout on the child process is the hard
 * timeout the fleet's testing rule requires for any test that runs the code
 * under test: pnpm test:run inside a fixture with no package.json fails
 * fast, but a hang here must still not stall the suite.
 */
function push(
  workDir: string,
  remote: string,
  refspec: string | string[],
  env: NodeJS.ProcessEnv = ISOLATED_GIT_ENV,
): PushResult {
  const refspecs = Array.isArray(refspec) ? refspec : [refspec];
  const result = spawnSync("git", [...GIT_IDENTITY, "push", remote, ...refspecs], {
    cwd: workDir,
    encoding: "utf8",
    env,
    timeout: 15000,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return { status: result.status ?? -1, stdout, stderr, combined: stdout + stderr };
}

/**
 * Installs the real, shipped pre-push at scripts/hooks/pre-push inside
 * workDir (core.hooksPath points here) alongside a copy of the real,
 * shipped hygiene-guard.sh at scripts/hygiene-guard.sh, the exact relative
 * layout pre-push's own `$root/scripts/hygiene-guard.sh` call expects.
 * Copies, not symlinks or a shared path, so each fixture is self-contained
 * and mutation tests (none in this file today, but the shape should hold)
 * cannot cross-contaminate.
 */
function installHooks(workDir: string) {
  const hooksDir = join(workDir, "scripts", "hooks");
  mkdirSync(hooksDir, { recursive: true });
  execFileSync("cp", [PRE_PUSH_PATH, join(hooksDir, "pre-push")]);
  execFileSync("chmod", ["+x", join(hooksDir, "pre-push")]);
  mkdirSync(join(workDir, "scripts"), { recursive: true });
  execFileSync("cp", [HYGIENE_GUARD_PATH, join(workDir, "scripts", "hygiene-guard.sh")]);
  git(["config", "core.hooksPath", hooksDir], workDir);
}

/**
 * Builds the exact topology _R1#171 measured: a fork ("origin") whose own
 * HEAD correctly resolves to a branch named "runway" but whose runway
 * never carries the guard/hold files, and a real trunk ("upstream") whose
 * platform default branch is "main" (unrelated content) while the actual
 * trunk work happens on "runway", which DOES carry the guard and an empty
 * (present, valid) hold list.
 */
function buildForkTopologyFixture(root: string) {
  const originDir = join(root, "origin.git");
  mkdirSync(originDir, { recursive: true });
  git(["init", "--quiet", "--bare", "-b", "runway"], originDir);

  const upstreamDir = join(root, "upstream.git");
  mkdirSync(upstreamDir, { recursive: true });
  git(["init", "--quiet", "--bare", "-b", "main"], upstreamDir);

  const workDir = join(root, "work");
  mkdirSync(workDir, { recursive: true });
  git(["init", "--quiet", "-b", "runway"], workDir);
  git(["remote", "add", "origin", originDir], workDir);
  git(["remote", "add", "upstream", upstreamDir], workDir);

  // Fork's runway: root commit only. No guard, no hold file -- the fork
  // was never synced, same as the ticket's own measured origin/runway.
  writeFile(workDir, "README.md", "fork, stale\n");
  git(["add", "."], workDir);
  git(["commit", "--quiet", "-m", "fork root"], workDir);
  git(["push", "--quiet", "origin", "runway"], workDir);
  git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/runway"], workDir);

  // Upstream's main: the platform default branch, unrelated content --
  // this is the wrong-branch trap: resolving trunk from upstream's HEAD
  // symref lands here, not on "runway".
  git(["checkout", "--quiet", "-b", "main"], workDir);
  writeFile(workDir, "MAIN.md", "platform default branch, not the trunk\n");
  git(["add", "."], workDir);
  git(["commit", "--quiet", "-m", "main root"], workDir);
  git(["push", "--quiet", "upstream", "main"], workDir);
  git(["symbolic-ref", "refs/remotes/upstream/HEAD", "refs/remotes/upstream/main"], workDir);

  // Upstream's runway: the real trunk. Guard installed, empty (valid) hold
  // list present.
  git(["checkout", "--quiet", "runway"], workDir);
  mkdirSync(join(workDir, "scripts"), { recursive: true });
  execFileSync("cp", [HYGIENE_GUARD_PATH, join(workDir, "scripts", "hygiene-guard.sh")]);
  writeFile(workDir, ".hygiene-hold", "");
  git(["add", "."], workDir);
  git(["commit", "--quiet", "-m", "install guard + hold on the real trunk"], workDir);
  git(["push", "--quiet", "upstream", "runway"], workDir);

  installHooks(workDir);
  return { originDir, upstreamDir, workDir };
}

describe("scripts/hooks/pre-push, the real wiring into hygiene-guard.sh (_R1#171)", () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "prepush-wiring-")));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("default unset, in a repo where origin IS trunk, behaves byte-identically to today: clean push succeeds through the real hook", () => {
    const originDir = join(root, "origin.git");
    mkdirSync(originDir, { recursive: true });
    git(["init", "--quiet", "--bare", "-b", "runway"], originDir);

    const workDir = join(root, "work");
    mkdirSync(workDir, { recursive: true });
    git(["init", "--quiet", "-b", "runway"], workDir);
    git(["remote", "add", "origin", originDir], workDir);
    mkdirSync(join(workDir, "scripts"), { recursive: true });
    execFileSync("cp", [HYGIENE_GUARD_PATH, join(workDir, "scripts", "hygiene-guard.sh")]);
    writeFile(workDir, ".hygiene-hold", "");
    writeFile(workDir, "README.md", "root\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "root"], workDir);
    git(["push", "--quiet", "origin", "runway"], workDir);
    git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/runway"], workDir);
    installHooks(workDir);

    // No hygiene.remote / hygiene.trunk configured anywhere.
    writeFile(workDir, "new-file.txt", "a genuinely new push\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "add new-file.txt"], workDir);

    const result = push(workDir, "origin", "runway");
    expect(result.status).toBe(0);
    expect(result.combined).toMatch(/pre-push: suite green|test suite skipped/);
    expect(result.combined).not.toMatch(/HYGIENE GUARD REFUSED/);
  });

  it("default unset, on the real fork/upstream topology, refuses through the real hook exactly like the ticket's own baseline (Arm A)", () => {
    const { workDir } = buildForkTopologyFixture(root);
    writeFile(workDir, "unrelated.txt", "would-be push\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "unrelated change"], workDir);

    const result = push(workDir, "origin", "runway");
    expect(result.status).not.toBe(0);
    expect(result.combined).toMatch(/HYGIENE GUARD REFUSED/);
    expect(result.combined).toMatch(/could not resolve an install point: no commit on origin\/runway adds/);
  });

  it("both settings configured, guard names upstream/runway and resolves an install point AND a hold list: push succeeds", () => {
    const { workDir } = buildForkTopologyFixture(root);
    git(["config", "hygiene.remote", "upstream"], workDir);
    git(["config", "hygiene.trunk", "runway"], workDir);

    writeFile(workDir, "governed-change.txt", "a real push under the corrected wiring\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "governed change"], workDir);

    const result = push(workDir, "upstream", "runway");
    expect(result.status).toBe(0);
    expect(result.combined).not.toMatch(/HYGIENE GUARD REFUSED/);
    expect(result.combined).not.toMatch(/could not resolve an install point/);
    expect(result.combined).not.toMatch(/hold list.*could not be read/);
  });

  it("hygiene.trunk set to a branch that does not exist REFUSES, naming it, rather than falling back to origin's stale runway", () => {
    const { workDir } = buildForkTopologyFixture(root);
    git(["config", "hygiene.remote", "upstream"], workDir);
    git(["config", "hygiene.trunk", "does-not-exist"], workDir);

    writeFile(workDir, "attempted.txt", "should never land\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "attempted change"], workDir);

    const result = push(workDir, "upstream", "runway");
    expect(result.status).not.toBe(0);
    expect(result.combined).toMatch(/HYGIENE GUARD REFUSED/);
    expect(result.combined).toMatch(/configured trunk branch 'does-not-exist' does not resolve as 'upstream\/does-not-exist'/);
  });

  it("git config itself failing REFUSES and does not proceed with origin: the exit-status-blind version of this bug renders identically to unset", () => {
    const { workDir } = buildForkTopologyFixture(root);
    git(["config", "hygiene.remote", "upstream"], workDir);
    git(["config", "hygiene.trunk", "runway"], workDir);

    // Fault-inject: a PATH shim that fails every `git config` call (the
    // only subcommand pre-push itself invokes beyond rev-parse) with a
    // nonzero exit OTHER than the documented "not set" exit of 1, while
    // passing every other subcommand straight through to the real git.
    // If pre-push's exit-status check is missing or wrong, the broken
    // read's command substitution yields empty output, "origin" silently
    // wins by default, and this push either succeeds (wrong: origin/runway
    // still lacks the guard) or refuses with origin's own install-point
    // message instead of a config-failure message. Either wrong shape is
    // caught by the assertions below.
    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    const shimDir = join(root, "git-shim");
    mkdirSync(shimDir, { recursive: true });
    const shimPath = join(shimDir, "git");
    writeFileSync(
      shimPath,
      `#!/bin/sh
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
if [ "$_sub" = "config" ]; then
  echo "git-fail-shim: simulated config failure" >&2
  exit 111
fi
exec "$_real" "$@"
`,
    );
    execFileSync("chmod", ["+x", shimPath]);

    writeFile(workDir, "attempted-2.txt", "should never land\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "attempted change 2"], workDir);

    // GIT_EXEC_PATH matters as much as PATH here: git always prepends its
    // own exec-path (where its "git" binary/helpers live, e.g. the Xcode
    // CLT's git-core dir on macOS) to the PATH it hands a hook subprocess,
    // which otherwise wins over anything this test puts earlier on PATH
    // and makes the shim invisible to pre-push's own `git config` calls.
    // Measured own-hands: without this, the fault-injection push below
    // succeeds cleanly (the shim never runs), the exact silent-pass shape
    // this test exists to rule out.
    const env = {
      ...ISOLATED_GIT_ENV,
      PATH: `${shimDir}:${process.env.PATH ?? ""}`,
      GIT_EXEC_PATH: shimDir,
    };
    const result = push(workDir, "upstream", "runway", env);
    expect(result.status).not.toBe(0);
    expect(result.combined).toMatch(/HYGIENE GUARD REFUSED/);
    expect(result.combined).toMatch(/'git config --get hygiene\.remote' failed with exit/);
    expect(result.combined).not.toMatch(/could not resolve an install point: no commit on origin\/runway adds/);
  });

  it("round trip: unsetting both settings again returns the original, default behaviour", () => {
    const { workDir } = buildForkTopologyFixture(root);
    git(["config", "hygiene.remote", "upstream"], workDir);
    git(["config", "hygiene.trunk", "runway"], workDir);

    writeFile(workDir, "first.txt", "under upstream/runway\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "first governed change"], workDir);
    const configured = push(workDir, "upstream", "runway");
    expect(configured.status).toBe(0);

    git(["config", "--unset", "hygiene.remote"], workDir);
    git(["config", "--unset", "hygiene.trunk"], workDir);

    writeFile(workDir, "second.txt", "back to default origin resolution\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "second change, config unset again"], workDir);
    const reverted = push(workDir, "origin", "runway");
    expect(reverted.status).not.toBe(0);
    expect(reverted.combined).toMatch(/HYGIENE GUARD REFUSED/);
    expect(reverted.combined).toMatch(/could not resolve an install point: no commit on origin\/runway adds/);
  });
});

/**
 * _R1#148: a delete-only push runs the full suite for no reason (a delete
 * pushes no code). The condition under test: EVERY ref-update line on
 * pre-push's own stdin has a local sha of all zeros (git's own marker for
 * "this ref is being deleted"). If and only if every line is a delete, the
 * suite step is skipped; the hygiene guard above it always still runs.
 *
 * These tests drive the REAL, installed pre-push through a real `git push`,
 * same discipline as the _R1#171 suite above: assert on the push's own exit
 * code and printed output, never by reading pre-push's source and reasoning
 * about what it should do.
 *
 * RUNWAY_SKIP_PREPUSH=1 is baked into ISOLATED_GIT_ENV above so the _R1#171
 * suite never reaches the suite step at all (its fixtures have no
 * package.json for pnpm test:run to run against). These tests are about
 * that exact step, so SUITE_ENV below unsets it: a fixture with no
 * package.json makes `pnpm test:run` fail fast (no timeout risk), which is
 * fine, since every assertion here is about whether the "running the test
 * suite" line was printed at all, not about the suite's own result.
 */
describe("scripts/hooks/pre-push, delete-only pushes skip the suite step (_R1#148)", () => {
  let root: string;
  const SUITE_ENV = { ...ISOLATED_GIT_ENV };
  delete SUITE_ENV.RUNWAY_SKIP_PREPUSH;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "prepush-delete-")));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** A single-remote repo, guard installed and wired, empty (valid) hold list. Same shape as the first _R1#171 fixture above. */
  function buildSimpleFixture() {
    const originDir = join(root, "origin.git");
    mkdirSync(originDir, { recursive: true });
    git(["init", "--quiet", "--bare", "-b", "runway"], originDir);

    const workDir = join(root, "work");
    mkdirSync(workDir, { recursive: true });
    git(["init", "--quiet", "-b", "runway"], workDir);
    git(["remote", "add", "origin", originDir], workDir);
    mkdirSync(join(workDir, "scripts"), { recursive: true });
    execFileSync("cp", [HYGIENE_GUARD_PATH, join(workDir, "scripts", "hygiene-guard.sh")]);
    writeFile(workDir, ".hygiene-hold", "");
    writeFile(workDir, "README.md", "root\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "root"], workDir);
    git(["push", "--quiet", "origin", "runway"], workDir);
    git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/runway"], workDir);
    installHooks(workDir);
    return { originDir, workDir };
  }

  it("acceptance 1: deleting a throwaway branch does not run the suite, and the delete completes", () => {
    const { workDir } = buildSimpleFixture();
    git(["checkout", "--quiet", "-b", "throwaway"], workDir);
    writeFile(workDir, "throwaway.txt", "x\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "throwaway commit"], workDir);
    git(["push", "--quiet", "origin", "throwaway"], workDir);

    const result = push(workDir, "origin", ":throwaway", SUITE_ENV);
    expect(result.status).toBe(0);
    expect(result.combined).toMatch(/pre-push: delete-only push, test suite skipped/);
    expect(result.combined).not.toMatch(/pre-push: running the test suite/);

    const remoteRefs = git(["ls-remote", "origin", "refs/heads/throwaway"], workDir);
    expect(remoteRefs).toBe("");
  }, 20000);

  it("acceptance 2: a real commit push still runs the suite (prints the suite line)", () => {
    const { workDir } = buildSimpleFixture();
    git(["checkout", "--quiet", "-b", "feature"], workDir);
    writeFile(workDir, "feature.txt", "x\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "feature commit"], workDir);

    const result = push(workDir, "origin", "feature", SUITE_ENV);
    expect(result.combined).toMatch(/pre-push: running the test suite/);
    expect(result.combined).not.toMatch(/delete-only push, test suite skipped/);
  }, 20000);

  it("acceptance 3: a mixed push, one delete and one real ref in one invocation, still runs the suite", () => {
    const { workDir } = buildSimpleFixture();
    git(["checkout", "--quiet", "-b", "throwaway2"], workDir);
    writeFile(workDir, "throwaway2.txt", "x\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "throwaway2 commit"], workDir);
    git(["push", "--quiet", "origin", "throwaway2"], workDir);

    git(["checkout", "--quiet", "-b", "feature2"], workDir);
    writeFile(workDir, "feature2.txt", "x\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "feature2 commit"], workDir);

    const result = push(workDir, "origin", ["feature2", ":throwaway2"], SUITE_ENV);
    expect(result.combined).toMatch(/pre-push: running the test suite/);
    expect(result.combined).not.toMatch(/delete-only push, test suite skipped/);
  }, 20000);

  it("acceptance 4 / TP refinement: the guard still refuses a delete-only push that would orphan a held commit", () => {
    const { workDir } = buildSimpleFixture();
    git(["checkout", "--quiet", "-b", "handwork"], workDir);
    writeFile(workDir, "handwork.txt", "hand-authored, cannot be reconstructed\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "handwork v1"], workDir);
    const heldSha = git(["rev-parse", "handwork"], workDir);
    git(["push", "--quiet", "origin", "handwork"], workDir);

    git(["checkout", "--quiet", "runway"], workDir);
    writeFile(workDir, ".hygiene-hold", `handwork ${heldSha} OPERATOR-HOLD\n`);
    git(["add", ".hygiene-hold"], workDir);
    git(["commit", "--quiet", "-m", "hold handwork"], workDir);
    git(["push", "--quiet", "origin", "runway"], workDir);

    git(["checkout", "--quiet", "handwork"], workDir);
    const result = push(workDir, "origin", ":handwork", ISOLATED_GIT_ENV);
    expect(result.status).not.toBe(0);
    expect(result.combined).toMatch(/HYGIENE GUARD REFUSED/);
    expect(result.combined).toMatch(/orphan a held object/);
    expect(result.combined).not.toMatch(/delete-only push, test suite skipped/);

    const remoteRefs = git(["ls-remote", "origin", "refs/heads/handwork"], workDir);
    expect(remoteRefs).not.toBe("");
  }, 20000);
});
