/**
 * _R1#115: proves the base-ancestry gate actually refuses on a stale/diverged
 * base, passes on a correctly-based candidate, and renders an unreachable
 * remote distinctly from both — the three states from the done-when, and no
 * two of them may render the same (the #107 defect this ticket names).
 *
 * Fixtures are local, offline git repos built with execFileSync so the suite
 * is deterministic and never depends on GitHub being reachable. The real,
 * live check against the actual stale fork (origin/runway at bc953b0 vs
 * Hunt-Gather-Create/_R1 runway at d1c65ff) was run by hand outside this
 * suite and is quoted verbatim in the ticket report — a live network call in
 * a committed test would make CI flaky on any outage, which is not what
 * "non-vacuous" means here.
 *
 * Both the CLI entrypoint (spawned as a real subprocess, exercising the
 * actual call site: arg parsing, exit code, stderr/stdout routing) and the
 * exported function are covered, per the anti-vacuity note in the ticket —
 * a correct function nobody actually invokes through main() proves nothing.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkBaseAncestry, formatResult, TRUTH_BRANCH } from "./check-base-ancestry";

const SCRIPT_PATH = join(__dirname, "check-base-ancestry.ts");
// -c flags instead of GIT_AUTHOR_*/GIT_COMMITTER_* env vars: happy-dom's
// process.env does not spread cleanly (PATH drops out), which turned every
// execFileSync("git", ...) into ENOENT the moment an env override was
// passed. Config flags avoid touching env at all.
const GIT_IDENTITY = [
  "-c",
  "user.name=gate-test",
  "-c",
  "user.email=gate-test@example.invalid",
];

function git(args: string[], cwd: string): string {
  return execFileSync("git", [...GIT_IDENTITY, ...args], { cwd, encoding: "utf8" }).trim();
}

function initRepo(dir: string, branch: string): void {
  mkdirSync(dir, { recursive: true });
  git(["init", "--quiet", "-b", branch], dir);
  git(["commit", "--quiet", "--allow-empty", "-m", "root"], dir);
}

/** Builds a "truth" repo (the stand-in for Hunt-Gather-Create/_R1) with two
 * commits, and a "candidate" repo that either does or doesn't contain the
 * truth tip, depending on `behind`. */
function buildFixture(root: string, behind: boolean) {
  const truthDir = join(root, "truth");
  initRepo(truthDir, TRUTH_BRANCH);
  const truthRootSha = git(["rev-parse", "HEAD"], truthDir);
  git(["commit", "--quiet", "--allow-empty", "-m", "truth tip"], truthDir);
  const truthTipSha = git(["rev-parse", "HEAD"], truthDir);

  const candidateDir = join(root, "candidate");
  if (behind) {
    // Candidate only ever saw the root commit — truth's tip never reached it.
    // This is the real shape of the incident: origin/runway had the shared
    // history but not the 12 commits upstream gained after it.
    git(["clone", "--quiet", "--branch", TRUTH_BRANCH, truthDir, candidateDir], root);
    git(["reset", "--quiet", "--hard", truthRootSha], candidateDir);
  } else {
    // Candidate is a clone that has the truth tip (a correctly-based branch
    // built from current upstream), plus one commit of its own on top.
    git(["clone", "--quiet", "--branch", TRUTH_BRANCH, truthDir, candidateDir], root);
    git(["commit", "--quiet", "--allow-empty", "-m", "ticket work"], candidateDir);
  }

  return { truthDir, truthTipSha, candidateDir };
}

describe("checkBaseAncestry — exported function", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "base-ancestry-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses when the candidate is behind truth (the real origin/runway shape)", () => {
    const { truthDir, candidateDir } = buildFixture(root, true);
    const result = checkBaseAncestry("HEAD", candidateDir, truthDir, TRUTH_BRANCH);
    expect(result.status).toBe("wrong-base");
    const { exitCode, message } = formatResult(result);
    expect(exitCode).toBe(1);
    expect(message).toMatch(/REFUSE \(wrong base\)/);
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
    expect(message).toMatch(/REFUSE \(unreachable remote\)/);
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

describe("check-base-ancestry.ts — the actual CLI call site", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "base-ancestry-cli-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function runCli(candidateDir: string, args: string[]): { stdout: string; stderr: string; status: number } {
    try {
      const stdout = execFileSync("npx", ["tsx", SCRIPT_PATH, ...args], {
        cwd: candidateDir,
        encoding: "utf8",
      });
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
    expect(stderr).toMatch(/REFUSE \(wrong base\)/);
  });

  it("exits zero and prints PASS on the subprocess call site for a correctly-based candidate", () => {
    const { truthDir, candidateDir } = buildFixture(root, false);
    const { status, stdout } = runCli(candidateDir, ["HEAD", truthDir, TRUTH_BRANCH]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/^PASS:/);
  });

  it("exits with a third, distinct code when the remote itself is unreachable from the CLI", () => {
    const { candidateDir } = buildFixture(root, false);
    const { status, stderr } = runCli(candidateDir, ["HEAD", join(root, "does-not-exist"), TRUTH_BRANCH]);
    expect(status).toBe(2);
    expect(stderr).toMatch(/REFUSE \(unreachable remote\)/);
  });

  it("usage error (no candidate ref) is its own thing, not confused with any of the three states", () => {
    const { candidateDir } = buildFixture(root, false);
    const { status, stderr } = runCli(candidateDir, []);
    expect(status).toBe(64);
    expect(stderr).toMatch(/usage:/);
  });
});
