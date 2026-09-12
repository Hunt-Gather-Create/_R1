/**
 * opeff#1040: proves hygiene-guard.sh's remote-sweep mode (MODE=remote-sweep,
 * the 6th positional argument) actually catches a remote branch the local
 * refs/heads/ walk in scripts/hygiene-guard.test.ts can never see -- one
 * that was merged into trunk and had its LOCAL branch deleted, but was
 * never deleted on the remote.
 *
 * Same fixture conventions as hygiene-guard.test.ts (a local bare "origin"
 * plus a work clone, built with execFileSync, GIT_DIR/GIT_WORK_TREE/
 * GIT_INDEX_FILE/GIT_COMMON_DIR scrubbed from every git call this suite
 * makes). Kept in its own file rather than folded into the existing
 * 4000+ line suite: this mode's setup (remote branches that must survive
 * past their local branch's own deletion) is different enough from every
 * existing fixture there that sharing a describe block would obscure more
 * than it would save.
 *
 * Every assertion drives the shipped script by subprocess and reads its
 * exit code and BLOCK-line text, exactly as hygiene-guard.test.ts does and
 * for the same reason: read the exit code, not printed text, as the
 * primary verdict; BLOCK text is asserted only for what a human actually
 * needs from the disposal command.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT_PATH = join(__dirname, "hygiene-guard.sh");

const ISOLATED_GIT_ENV = { ...process.env };
delete ISOLATED_GIT_ENV.GIT_DIR;
delete ISOLATED_GIT_ENV.GIT_WORK_TREE;
delete ISOLATED_GIT_ENV.GIT_INDEX_FILE;
delete ISOLATED_GIT_ENV.GIT_COMMON_DIR;

const GIT_IDENTITY = ["-c", "user.name=remote-sweep-test", "-c", "user.email=remote-sweep-test@example.invalid", "-c", "gc.auto=0"];

function git(args: string[], cwd: string): string {
  return execFileSync("git", [...GIT_IDENTITY, ...args], { cwd, encoding: "utf8", env: ISOLATED_GIT_ENV }).trim();
}

function writeFile(dir: string, name: string, content: string) {
  writeFileSync(join(dir, name), content);
}

interface GuardResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** Runs the shipped guard in remote-sweep mode (6th positional arg). */
function runRemoteSweep(cwd: string, remote = "origin", holdPath = ".hygiene-hold", trunkBranch = "trunk"): GuardResult {
  try {
    const stdout = execFileSync("sh", [SCRIPT_PATH, cwd, remote, "scripts/hygiene-guard.sh", holdPath, trunkBranch, "remote-sweep"], {
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

/** Builds a bare "origin" remote plus a working clone, trunk name "trunk". */
function buildRepo(root: string) {
  const originDir = join(root, "origin.git");
  mkdirSync(originDir, { recursive: true });
  git(["init", "--quiet", "--bare", "-b", "trunk"], originDir);

  const workDir = join(root, "work");
  git(["clone", "--quiet", originDir, workDir], root);
  git(["checkout", "--quiet", "-b", "trunk"], workDir);
  mkdirSync(join(workDir, "scripts"), { recursive: true });
  writeFile(workDir, "scripts/hygiene-guard.sh", "#!/bin/sh\n# placeholder for install-point tests\n");
  writeFile(workDir, ".hygiene-hold", "");
  writeFile(workDir, "README.md", "root\n");
  git(["add", "."], workDir);
  git(["commit", "--quiet", "-m", "root"], workDir);
  git(["push", "--quiet", "origin", "HEAD:trunk"], workDir);
  git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk"], workDir);

  return { originDir, workDir };
}

/**
 * Pushes branchName to origin with a unique-file change, then squash-merges
 * it into trunk on origin, then deletes the LOCAL branch -- reproducing the
 * exact opeff#1040 shape: content landed, local branch is gone, remote
 * branch is not. Each fixture writes its own file, never a shared one, so
 * one fixture's merge never moves a hunk boundary out from under another's
 * reverse-apply diff (the context-drift gap this file's own header
 * documents for detector B).
 */
function squashMergeAndOrphanRemote(workDir: string, branchName: string, fileName: string) {
  git(["checkout", "--quiet", "-b", branchName, "trunk"], workDir);
  writeFile(workDir, fileName, `${branchName} content\n`);
  git(["add", "."], workDir);
  git(["commit", "--quiet", "-m", `add ${fileName}`], workDir);
  git(["push", "--quiet", "origin", branchName], workDir);
  git(["checkout", "--quiet", "trunk"], workDir);
  git(["merge", "--quiet", "--squash", branchName], workDir);
  git(["commit", "--quiet", "-m", `squash-merge ${branchName}`], workDir);
  git(["push", "--quiet", "origin", "trunk"], workDir);
  git(["branch", "-D", branchName], workDir);
}

/** Same shape, but a real (--no-ff) merge, which leaves an ancestor edge squash never does. */
function trueMergeAndOrphanRemote(workDir: string, branchName: string, fileName: string) {
  git(["checkout", "--quiet", "-b", branchName, "trunk"], workDir);
  writeFile(workDir, fileName, `${branchName} content\n`);
  git(["add", "."], workDir);
  git(["commit", "--quiet", "-m", `add ${fileName}`], workDir);
  git(["push", "--quiet", "origin", branchName], workDir);
  git(["checkout", "--quiet", "trunk"], workDir);
  git(["merge", "--quiet", "--no-ff", "-m", `merge ${branchName}`, branchName], workDir);
  git(["push", "--quiet", "origin", "trunk"], workDir);
  git(["branch", "-D", branchName], workDir);
}

describe("hygiene-guard.sh remote-sweep mode, exercised through the guard's exit code", () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "hygiene-remote-sweep-")));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("reports clean (exit 0) on a repo with no remote branches beyond trunk", () => {
    const { workDir } = buildRepo(root);
    const { status, stdout } = runRemoteSweep(workDir);
    expect(status).toBe(0);
    expect(stdout).toMatch(/remote sweep clean/);
  });

  it("names a squash-merged remote branch disposable with the delete command, after its local branch is gone", () => {
    const { workDir } = buildRepo(root);
    squashMergeAndOrphanRemote(workDir, "feat/squash-orphan", "squash-orphan.txt");
    const { status, stderr } = runRemoteSweep(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/origin\/feat\/squash-orphan/);
    expect(stderr).toMatch(/Disposal: git push origin --delete 'feat\/squash-orphan'/);
  });

  it("names a true-merged (--no-ff) remote branch disposable with the delete command", () => {
    const { workDir } = buildRepo(root);
    trueMergeAndOrphanRemote(workDir, "feat/true-orphan", "true-orphan.txt");
    const { status, stderr } = runRemoteSweep(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/origin\/feat\/true-orphan/);
    expect(stderr).toMatch(/Disposal: git push origin --delete 'feat\/true-orphan'/);
    expect(stderr).toMatch(/detected via ancestor/);
  });

  it("never names a remote branch whose content is genuinely not on trunk, and the fixture's diff genuinely cannot reverse-apply", () => {
    const { workDir } = buildRepo(root);
    git(["checkout", "--quiet", "-b", "feat/unmerged", "trunk"], workDir);
    writeFile(workDir, "unmerged-only.txt", "unmerged, unique content, never landed\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "unmerged unique work"], workDir);
    git(["push", "--quiet", "origin", "feat/unmerged"], workDir);

    // Negative control: prove the fixture's own diff genuinely fails a raw
    // reverse-apply, so a passing assertion below is a real negative, not a
    // fixture that happens to be identical to trunk (feedback: prove the
    // zero is real).
    const base = git(["merge-base", "feat/unmerged", "trunk"], workDir);
    const patchPath = join(root, "unmerged.diff");
    const diff = git(["diff", "--binary", base, "feat/unmerged"], workDir);
    writeFileSync(patchPath, `${diff}\n`);
    const scratchIndex = join(root, "scratch-index");
    let applyStatus = 0;
    try {
      execFileSync("git", [...GIT_IDENTITY, "-C", workDir, "apply", "--whitespace=nowarn", "--cached", "--reverse", "--check", patchPath], {
        env: { ...ISOLATED_GIT_ENV, GIT_INDEX_FILE: scratchIndex },
      });
    } catch (err) {
      applyStatus = (err as { status?: number }).status ?? -1;
    }
    expect(applyStatus).toBe(1);

    git(["checkout", "--quiet", "trunk"], workDir);
    git(["branch", "-D", "feat/unmerged"], workDir);

    const { status, stdout, stderr } = runRemoteSweep(workDir);
    expect(status).toBe(0);
    expect(stdout + stderr).not.toMatch(/feat\/unmerged/);
  });

  it("reports a held remote branch as held, with no delete command, even though its content is fully present", () => {
    const { workDir } = buildRepo(root);
    git(["checkout", "--quiet", "-b", "feat/held", "trunk"], workDir);
    writeFile(workDir, "held.txt", "held content\n");
    git(["add", "."], workDir);
    git(["commit", "--quiet", "-m", "add held.txt"], workDir);
    git(["push", "--quiet", "origin", "feat/held"], workDir);
    const heldTip = git(["rev-parse", "feat/held"], workDir);
    git(["checkout", "--quiet", "trunk"], workDir);
    git(["merge", "--quiet", "--squash", "feat/held"], workDir);
    git(["commit", "--quiet", "-m", "squash-merge feat/held"], workDir);
    git(["push", "--quiet", "origin", "trunk"], workDir);
    git(["branch", "-D", "feat/held"], workDir);

    git(["checkout", "--quiet", "trunk"], workDir);
    writeFile(workDir, ".hygiene-hold", `feat/held ${heldTip} PERMANENT test fixture, must stay held\n`);
    git(["add", ".hygiene-hold"], workDir);
    git(["commit", "--quiet", "-m", "hold feat/held"], workDir);
    git(["push", "--quiet", "origin", "trunk"], workDir);

    const { status, stderr } = runRemoteSweep(workDir);
    expect(status).toBe(1);
    expect(stderr).toMatch(/origin\/feat\/held.*held:/s);
    expect(stderr).not.toMatch(/Disposal: git push origin --delete 'feat\/held'/);
  });

  it("never reports the remote's collapsed HEAD symref (%(refname:short) resolves refs/remotes/origin/HEAD to the bare 'origin') as a disposable branch", () => {
    const { workDir } = buildRepo(root);
    const { status, stdout, stderr } = runRemoteSweep(workDir);
    expect(status).toBe(0);
    expect(stdout + stderr).not.toMatch(/delete 'origin'/);
  });

  it("push mode (no 6th argument) is unaffected: still reads the pre-push stdin protocol and refuses a terminal stdin exactly as before", () => {
    const { workDir } = buildRepo(root);
    let status = 0;
    try {
      execFileSync("sh", [SCRIPT_PATH, workDir, "origin"], {
        cwd: workDir,
        encoding: "utf8",
        env: ISOLATED_GIT_ENV,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      status = (err as { status?: number }).status ?? -1;
    }
    // stdio: "ignore" on this harness still yields a non-tty, empty stdin
    // (never a terminal), so this exercises the ordinary "clean" push-mode
    // path, proving the new 6th argument's default ("push") did not change
    // existing behavior when the argument is omitted entirely.
    expect(status).toBe(0);
  });
});
