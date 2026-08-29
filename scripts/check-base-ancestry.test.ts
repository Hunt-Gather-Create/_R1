/**
 * _R1#115: proves the base-ancestry gate actually refuses on a stale or
 * diverged base, passes on a correctly-based candidate, and renders an
 * unreachable remote distinctly from both. Those are the three states from
 * the done-when, and no two of them may render the same, which is the
 * #107 defect this ticket names.
 *
 * Fixtures are local, offline git repos built with execFileSync so the suite
 * is deterministic and never depends on GitHub being reachable. The real,
 * live check against the actual stale fork, origin/runway at bc953b0
 * against Hunt-Gather-Create/_R1 runway at d1c65ff, was run by hand outside
 * this suite and is quoted verbatim in the ticket report. A live network
 * call in a committed test would make CI flaky on any outage, which is not
 * what non-vacuous means here.
 *
 * Both the CLI entrypoint, spawned as a real subprocess to exercise the
 * actual call site of arg parsing, exit code, and stderr/stdout routing,
 * and the exported function are covered, per the anti-vacuity note in the
 * ticket. A correct function nobody actually invokes through main proves
 * nothing.
 *
 * Every git call this file makes strips GIT_DIR, GIT_WORK_TREE,
 * GIT_INDEX_FILE, and GIT_COMMON_DIR from the spawned process's
 * environment. git push runs its pre-push hook with those variables set in
 * the hook's own process environment, and a hook that shells out to
 * pnpm test:run passes that environment straight through to vitest and
 * every child process it spawns. Without stripping them, git honors the
 * inherited GIT_DIR over the cwd this file passes, so every init and
 * commit meant for an isolated tmp fixture instead lands on the real
 * worktree branch running the suite. That happened once, here, on this
 * ticket's own worktree, and every fixture repo in this file quietly
 * fought over the same real repository for the rest of that run. It only
 * ever showed up when the suite ran under git push's hook, never when run
 * directly by hand, which is what pointed at the environment rather than
 * this file's own logic.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkBaseAncestry, formatResult, TRUTH_BRANCH } from "./check-base-ancestry";

const SCRIPT_PATH = join(__dirname, "check-base-ancestry.ts");

// See the file header. This is the fix for the real defect this ticket's
// own build hit: a leaked GIT_DIR silently redirecting every git call
// below onto the real worktree repository instead of the isolated tmp
// fixture each test builds.
const ISOLATED_GIT_ENV = { ...process.env };
delete ISOLATED_GIT_ENV.GIT_DIR;
delete ISOLATED_GIT_ENV.GIT_WORK_TREE;
delete ISOLATED_GIT_ENV.GIT_INDEX_FILE;
delete ISOLATED_GIT_ENV.GIT_COMMON_DIR;

// -c flags instead of GIT_AUTHOR_*/GIT_COMMITTER_* env vars: this repo's
// happy-dom test environment does not spread process.env cleanly through
// an object literal, which previously turned every git spawn into ENOENT
// the moment any env override was passed. Config flags avoid touching env
// for identity, and gc.auto=0 keeps a background auto gc from ever firing
// against one of these small, short-lived fixture repos.
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

function initRepo(dir: string, branch: string): void {
  mkdirSync(dir, { recursive: true });
  git(["init", "--quiet", "-b", branch], dir);
  git(["commit", "--quiet", "--allow-empty", "-m", "root"], dir);
}

/**
 * Builds a "truth" repo, the stand-in for Hunt-Gather-Create/_R1, with two
 * commits, and a "candidate" repo that either does or doesn't contain the
 * truth tip, depending on `behind`. The candidate is its own independent
 * git init plus a fetch from truthDir, the same shape checkBaseAncestry
 * itself uses against a real remote, rather than a local clone.
 */
function buildFixture(root: string, behind: boolean) {
  const truthDir = join(root, "truth");
  initRepo(truthDir, TRUTH_BRANCH);
  const truthRootSha = git(["rev-parse", "HEAD"], truthDir);
  git(["commit", "--quiet", "--allow-empty", "-m", "truth tip"], truthDir);
  const truthTipSha = git(["rev-parse", "HEAD"], truthDir);

  const candidateDir = join(root, "candidate");
  mkdirSync(candidateDir, { recursive: true });
  git(["init", "--quiet", "-b", TRUTH_BRANCH], candidateDir);
  if (behind) {
    // Candidate only ever fetches the root commit. Truth's tip never
    // reaches it. This is the real shape of the incident: origin/runway
    // had the shared history but not the 12 commits upstream gained
    // after it.
    git(["fetch", "--quiet", truthDir, truthRootSha], candidateDir);
    git(["checkout", "--quiet", "FETCH_HEAD"], candidateDir);
  } else {
    // Candidate fetches the truth tip, a correctly-based branch built
    // from current upstream, then adds one commit of its own on top.
    git(["fetch", "--quiet", truthDir, TRUTH_BRANCH], candidateDir);
    git(["checkout", "--quiet", "FETCH_HEAD"], candidateDir);
    git(["commit", "--quiet", "--allow-empty", "-m", "ticket work"], candidateDir);
  }

  return { truthDir, truthTipSha, candidateDir };
}

describe("checkBaseAncestry, the exported function", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "base-ancestry-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses when the candidate is behind truth, the real origin/runway shape", () => {
    const { truthDir, candidateDir } = buildFixture(root, true);
    const result = checkBaseAncestry("HEAD", candidateDir, truthDir, TRUTH_BRANCH);
    expect(result.status).toBe("wrong-base");
    const { exitCode, message } = formatResult(result);
    expect(exitCode).toBe(1);
    expect(message).toMatch(/REFUSE, WRONG BASE/);
  });

  it("passes when the candidate contains the truth tip", () => {
    const { truthDir, candidateDir } = buildFixture(root, false);
    const result = checkBaseAncestry("HEAD", candidateDir, truthDir, TRUTH_BRANCH);
    expect(result.status).toBe("pass");
    const { exitCode, message } = formatResult(result);
    expect(exitCode).toBe(0);
    expect(message).toMatch(/^PASS:/);
  });

  it("reports unreachable-remote distinctly, not as a wrong base", () => {
    const { candidateDir } = buildFixture(root, false);
    const nonexistentTruthPath = join(root, "no-such-repo");
    const result = checkBaseAncestry("HEAD", candidateDir, nonexistentTruthPath, TRUTH_BRANCH);
    expect(result.status).toBe("unreachable-remote");
    const { exitCode, message } = formatResult(result);
    expect(exitCode).toBe(2);
    expect(message).toMatch(/REFUSE, UNREACHABLE REMOTE/);
  });

  it("the three outcomes render three distinct exit codes and three distinct message prefixes", () => {
    const wrongBase = buildFixture(join(root, "a"), true);
    const goodBase = buildFixture(join(root, "b"), false);
    const results = [
      formatResult(checkBaseAncestry("HEAD", wrongBase.candidateDir, wrongBase.truthDir, TRUTH_BRANCH)),
      formatResult(checkBaseAncestry("HEAD", goodBase.candidateDir, goodBase.truthDir, TRUTH_BRANCH)),
      formatResult(
        checkBaseAncestry("HEAD", goodBase.candidateDir, join(root, "missing"), TRUTH_BRANCH),
      ),
    ];
    const exitCodes = results.map((r) => r.exitCode);
    const prefixes = results.map((r) => r.message.split(":")[0]);
    expect(new Set(exitCodes).size).toBe(3);
    expect(new Set(prefixes).size).toBe(3);
  });
});

describe("check-base-ancestry.ts, the actual CLI call site", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "base-ancestry-cli-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function runCli(
    candidateDir: string,
    args: string[],
    extraEnv: Record<string, string> = {},
  ): { stdout: string; stderr: string; status: number } {
    try {
      // node --experimental-strip-types instead of npx tsx: tsx is not a
      // project dependency, so npx resolves it through its own on demand
      // install cache on every call, adding a few seconds of npm overhead
      // per spawn for no benefit here. Node's built in stripping runs the
      // identical script file with identical argv parsing and exit code
      // handling, without that cost.
      const stdout = execFileSync(
        process.execPath,
        ["--experimental-strip-types", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", SCRIPT_PATH, ...args],
        { cwd: candidateDir, encoding: "utf8", env: { ...ISOLATED_GIT_ENV, ...extraEnv } },
      );
      return { stdout, stderr: "", status: 0 };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; status?: number };
      return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", status: e.status ?? -1 };
    }
  }

  it("exits non-zero and prints REFUSE on the subprocess call site for a stale candidate", () => {
    const { truthDir, candidateDir } = buildFixture(root, true);
    const { status, stderr } = runCli(candidateDir, ["HEAD", truthDir, TRUTH_BRANCH]);
    expect(status).toBe(1);
    expect(stderr).toMatch(/REFUSE, WRONG BASE/);
  });

  it("exits zero and prints PASS on the subprocess call site for a correctly-based candidate", () => {
    const { truthDir, candidateDir } = buildFixture(root, false);
    const { status, stdout } = runCli(candidateDir, ["HEAD", truthDir, TRUTH_BRANCH]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/^PASS:/);
  });

  it("exits with a third, distinct code when the remote itself is unreachable, and a usage error is its own fourth thing", () => {
    const { candidateDir } = buildFixture(root, false);
    const unreachable = runCli(candidateDir, ["HEAD", join(root, "does-not-exist"), TRUTH_BRANCH]);
    expect(unreachable.status).toBe(2);
    expect(unreachable.stderr).toMatch(/REFUSE, UNREACHABLE REMOTE/);

    const usage = runCli(candidateDir, []);
    expect(usage.status).toBe(64);
    expect(usage.stderr).toMatch(/usage:/);
  });

  it("cwd decides the verdict even when a decoy GIT_DIR that would pass is already set in the environment", () => {
    // This is the real incident this ticket's own build hit today. A caller
    // running from inside a git hook, such as pre push, has GIT_DIR already
    // set in its process environment. If this gate does not strip it, git
    // honors that inherited GIT_DIR over the cwd argument this gate was
    // actually handed, so it can silently check a completely different
    // repository and report success on one nobody asked about.
    //
    // The decoy must descend from the SAME truthDir the gate is actually
    // asked about, not a separately built fixture with its own unrelated
    // truth. Two independent buildFixture calls would produce two
    // unrelated commit graphs, and merge-base would correctly refuse no
    // matter which repository GIT_DIR pointed at, proving nothing about
    // whether cwd or GIT_DIR decided the answer. So the decoy is built by
    // hand here, as its own repo fetching from the real, behind
    // candidate's own truthDir, which does make it a genuine descendant
    // of the exact truth tip this invocation checks against.
    const { truthDir, candidateDir } = buildFixture(root, true);

    const decoyDir = join(root, "decoy");
    mkdirSync(decoyDir, { recursive: true });
    git(["init", "--quiet", "-b", TRUTH_BRANCH], decoyDir);
    git(["fetch", "--quiet", truthDir, TRUTH_BRANCH], decoyDir);
    git(["checkout", "--quiet", "FETCH_HEAD"], decoyDir);
    const decoyGitDir = git(["rev-parse", "--absolute-git-dir"], decoyDir);

    // Sanity check on the decoy itself: it must actually pass on its own
    // terms, or this proves nothing about a decoy that would pass.
    const decoyOwnResult = checkBaseAncestry("HEAD", decoyDir, truthDir, TRUTH_BRANCH);
    expect(decoyOwnResult.status).toBe("pass");

    const { status, stderr } = runCli(candidateDir, ["HEAD", truthDir, TRUTH_BRANCH], {
      GIT_DIR: decoyGitDir,
    });

    expect(status).toBe(1);
    expect(stderr).toMatch(/REFUSE, WRONG BASE/);
  });
});
