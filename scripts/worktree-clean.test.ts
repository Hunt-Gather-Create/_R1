/**
 * _R1#170 item 4: proves scripts/worktree-clean disposes a fossil worktree by
 * CONTENT, not ancestry.
 *
 * The bug this replaces: `git branch --merged upstream/runway | grep -qw
 * "$branch"` walks parent edges. A squash merge creates none for the branch
 * that got squashed -- `git merge-base --is-ancestor` on it exits 1 even
 * though every change it makes already lives in trunk. The old check ran
 * clean, printed a tidy "dry run complete", and removed nothing on that
 * exact shape: working and broken produced the same artifact. This repo
 * squash-merges through GitHub, so that is the common case, not an edge one.
 *
 * Three fixtures, three verdicts, and no two of them may render the same:
 *
 *   1. A squash-merged fossil worktree -- content fully present in trunk,
 *      no ancestor edge -- must print "merged:" (RED on the pre-fix
 *      script, saved verbatim below and run as its own subprocess so this
 *      suite proves the defect against the real old behavior, not a
 *      description of it; GREEN on the fixed script).
 *   2. A worktree whose branch has an --allow-empty commit and nothing
 *      else on top of its own merge-base with trunk. An empty diff is
 *      UNKNOWN, not identical -- there is no unique content to be either
 *      present or absent -- and must never print "merged:".
 *   3. A worktree with genuine unmerged work, run once with the instrument
 *      intact (must not print "merged:") and once with the instrument
 *      broken by deleting the merge-base commit's own loose object out
 *      from under git (must print "UNKNOWN:", never "merged:" and never a
 *      silent, unmarked absence). This is the control the ticket asks
 *      for: it breaks the CHECK ITSELF, not just the input, and proves
 *      the failure mode is a visible refusal to judge, not a false
 *      "already merged".
 *
 * Fixtures are local, offline git repos built with execFileSync, same shape
 * as scripts/hygiene-guard.test.ts and scripts/check-base-ancestry.test.ts:
 * a bare "upstream.git", a "work" clone that tracks it as remote "upstream"
 * on branch "runway", and real `git worktree add` worktrees alongside it so
 * the script's own `git worktree list --porcelain` parsing is exercised,
 * not stubbed.
 *
 * Every git call strips GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, and
 * GIT_COMMON_DIR, for the identical reason documented in
 * check-base-ancestry.test.ts: a hook or test-runner process can inherit
 * those from git itself, and leaving them set lets a fixture's git calls
 * silently resolve against the real repository running the suite instead
 * of the isolated tmp fixture.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT_PATH = join(__dirname, "worktree-clean");

// The pre-fix ancestry check, `git branch --merged upstream/runway | grep
// -qw "$branch"`, quoted verbatim so control 1 below runs the actual old
// defect as a real subprocess rather than describing it in prose. Kept as
// a literal string, not read from git history, so this test stays correct
// regardless of how far trunk moves past this fix.
const PRE_FIX_SCRIPT = `#!/bin/bash
set -euo pipefail
force=false
for arg in "$@"; do
  case "$arg" in
    --force|-f) force=true ;;
    *) ;;
  esac
done
echo "Checking worktrees for merged branches..."
echo ""
git worktree list --porcelain | grep "^branch " | sed 's|branch refs/heads/||' | while read -r branch; do
  [ "$branch" = "runway" ] && continue
  if git branch --merged upstream/runway | grep -qw "$branch"; then
    worktree_path=$(git worktree list --porcelain | awk -v b="refs/heads/$branch" '
      /^worktree / { path = substr($0, 10) }
      /^branch /   { if (substr($0, 8) == b) print path }
    ')
    if [ "$force" = true ]; then
      echo "  Removing: $branch ($worktree_path)"
      git worktree remove "$worktree_path"
      git branch -d "$branch"
    else
      echo "  merged:   $branch ($worktree_path)"
    fi
  fi
done
echo ""
echo "Dry run complete. Use --force to remove merged worktrees."
`;

const ISOLATED_GIT_ENV = { ...process.env };
delete ISOLATED_GIT_ENV.GIT_DIR;
delete ISOLATED_GIT_ENV.GIT_WORK_TREE;
delete ISOLATED_GIT_ENV.GIT_INDEX_FILE;
delete ISOLATED_GIT_ENV.GIT_COMMON_DIR;

const GIT_IDENTITY = [
  "-c",
  "user.name=Test",
  "-c",
  "user.email=test@example.com",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "gc.auto=0",
];

function git(cwd: string, args: string[]): string {
  return execFileSync("git", [...GIT_IDENTITY, ...args], {
    cwd,
    env: ISOLATED_GIT_ENV,
    encoding: "utf8",
  });
}

function runWorktreeClean(cwd: string, scriptPath: string = SCRIPT_PATH): { stdout: string; status: number } {
  try {
    const stdout = execFileSync("bash", [scriptPath], {
      cwd,
      env: ISOLATED_GIT_ENV,
      encoding: "utf8",
    });
    return { stdout, status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; status?: number };
    return { stdout: e.stdout ?? "", status: e.status ?? 1 };
  }
}

describe("scripts/worktree-clean: content presence, not ancestry", () => {
  let root: string;
  let upstreamBare: string;
  let work: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "worktree-clean-"));
    upstreamBare = join(root, "upstream.git");
    work = join(root, "work");

    git(root, ["init", "-q", "--bare", upstreamBare]);
    git(root, ["init", "-q", "-b", "runway", work]);
    git(work, ["remote", "add", "upstream", upstreamBare]);
    writeFileSync(join(work, "file.txt"), "a\n");
    git(work, ["add", "file.txt"]);
    git(work, ["commit", "-q", "-m", "base"]);
    git(work, ["push", "-q", "upstream", "runway"]);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("control 1: squash-merged fossil is content-present with no ancestor edge (proves the old ancestry check missed it, proves the fixed check catches it)", () => {
    git(work, ["checkout", "-q", "-b", "fossil-squash"]);
    writeFileSync(join(work, "file.txt"), "a\nb\n");
    git(work, ["commit", "-q", "-am", "fossil commit 1"]);
    writeFileSync(join(work, "file.txt"), "a\nb\nc\n");
    git(work, ["commit", "-q", "-am", "fossil commit 2"]);

    git(work, ["checkout", "-q", "runway"]);
    git(work, ["merge", "-q", "--squash", "fossil-squash"]);
    git(work, ["commit", "-q", "-m", "squash merge fossil-squash"]);
    git(work, ["push", "-q", "upstream", "runway"]);
    git(work, ["fetch", "-q", "upstream"]);

    const fossilWorktree = join(root, "wt-fossil-squash");
    git(work, ["worktree", "add", "-q", fossilWorktree, "fossil-squash"]);

    // Confirm the ancestor-edge premise that made the old check miss this:
    // git merge-base --is-ancestor on a squash-merged branch genuinely
    // fails. If this assertion ever fails, the fixture no longer
    // reproduces the bug this test exists to catch.
    expect(() =>
      git(work, ["merge-base", "--is-ancestor", "fossil-squash", "upstream/runway"])
    ).toThrow();

    const preFixScriptPath = join(root, "worktree-clean-pre-fix");
    writeFileSync(preFixScriptPath, PRE_FIX_SCRIPT);
    const preFix = runWorktreeClean(work, preFixScriptPath);
    expect(preFix.status).toBe(0);
    expect(preFix.stdout).not.toContain("fossil-squash");
    expect(preFix.stdout).toContain("Dry run complete");

    const fixed = runWorktreeClean(work);
    expect(fixed.status).toBe(0);
    expect(fixed.stdout).toContain("merged:   fossil-squash");
  });

  it("control 2: an --allow-empty branch has no unique diff against its own merge-base and must read UNKNOWN, never merged", () => {
    const emptyWorktree = join(root, "wt-empty");
    git(work, ["worktree", "add", "-q", "-b", "empty-branch", emptyWorktree, "runway"]);
    git(emptyWorktree, ["commit", "-q", "--allow-empty", "-m", "empty commit, no content change"]);

    const result = runWorktreeClean(work);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("UNKNOWN:  empty-branch");
    expect(result.stdout).not.toContain("merged:   empty-branch");
  });

  it("control 3: breaking the instrument (deleting the merge-base commit's own object) must surface UNKNOWN, never a false present and never a silent, unmarked absence", () => {
    const realWorkWorktree = join(root, "wt-real-work");
    git(work, ["worktree", "add", "-q", "-b", "real-work", realWorkWorktree, "runway"]);
    writeFileSync(join(realWorkWorktree, "file.txt"), "a\nunmerged real work\n");
    git(realWorkWorktree, ["commit", "-q", "-am", "genuine unmerged work"]);

    // Instrument intact: genuine unmerged work must never read as merged.
    const intact = runWorktreeClean(work);
    expect(intact.status).toBe(0);
    expect(intact.stdout).not.toContain("merged:   real-work");
    expect(intact.stdout).not.toContain("UNKNOWN:  real-work");

    // Break the instrument: delete the merge-base commit's own loose
    // object so `git diff <base> real-work` cannot read it. This is not
    // "vary the input" -- the branch's real content is untouched. It is
    // the check's own machinery that can no longer answer the question.
    const base = git(work, ["merge-base", "real-work", "upstream/runway"]).trim();
    const objectPath = join(work, ".git", "objects", base.slice(0, 2), base.slice(2));
    const backupPath = `${objectPath}.bak`;
    renameSync(objectPath, backupPath);
    // Fail loudly, not silently, if the fixture's own assumption about
    // where git stores this object ever stops holding.
    readFileSync(backupPath);

    try {
      const broken = runWorktreeClean(work);
      expect(broken.status).toBe(0);
      expect(broken.stdout).toContain("UNKNOWN:  real-work");
      expect(broken.stdout).not.toContain("merged:   real-work");
    } finally {
      renameSync(backupPath, objectPath);
    }

    // Instrument restored: normal verdict returns.
    const restored = runWorktreeClean(work);
    expect(restored.status).toBe(0);
    expect(restored.stdout).not.toContain("merged:   real-work");
    expect(restored.stdout).not.toContain("UNKNOWN:  real-work");
  });
});
