/**
 * Pre-push hygiene guard for _R1#167.
 *
 * Refuses the next push when this repo currently holds a local branch or a
 * registered worktree whose content is already fully present in trunk. The
 * seat that must clean up a merged branch is usually not the seat that
 * merged it, and nothing else wakes that seat up. This check fires on the
 * push that happens to come next, from whoever runs it, which is the one
 * property that reliably catches the leftover.
 *
 * Two design choices are load-bearing and are not incidental to how this
 * was written:
 *
 * 1. Trunk is resolved from the repo itself, refs/remotes/origin/HEAD, with
 *    a live-remote fallback, never the literal string "main". A guard that
 *    silently compares against a stale or wrong branch name still exits
 *    zero, which is worse than a guard that refuses to run at all: the
 *    failure to detect goes unnoticed.
 *
 * 2. Disposability is decided by content presence, not history. A branch
 *    merged into trunk via squash has no ancestor relationship to trunk at
 *    all, git merge-base --is-ancestor exits 1 on it, so that check cannot
 *    be used here. Content presence is decided by reverse-applying the
 *    branch's diff onto trunk's tree in a scratch index: if trunk already
 *    contains every change the branch makes, the reverse-apply is clean.
 *    The forward form, apply the diff and compare resulting tree hash to
 *    trunk's, is deliberately not used: a patch that fails to apply at all
 *    leaves the scratch index untouched, so its tree hash still equals
 *    trunk's by construction, and a failed apply and a no-op apply become
 *    indistinguishable. Only the reverse form's own exit code, not a tree
 *    comparison, tells the two apart.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// See check-base-ancestry.ts for why this stripping matters: git hands a
// hook process GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, and GIT_COMMON_DIR
// in its own environment, and git honors those over any cwd this file
// passes. Left in place, every call below would silently run against
// whatever repository invoked the hook rather than the cwd this check was
// actually asked about.
const ISOLATED_GIT_ENV = { ...process.env };
delete ISOLATED_GIT_ENV.GIT_DIR;
delete ISOLATED_GIT_ENV.GIT_WORK_TREE;
delete ISOLATED_GIT_ENV.GIT_INDEX_FILE;
delete ISOLATED_GIT_ENV.GIT_COMMON_DIR;

function run(args: string[], cwd: string, env: NodeJS.ProcessEnv = ISOLATED_GIT_ENV): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env }).trim();
}

export type TrunkResolution =
  | { status: "resolved"; trunkRef: string; branchName: string }
  | { status: "unresolved"; detail: string };

/**
 * Resolves trunk from the repo, never a literal branch name. Reads the
 * cached refs/remotes/origin/HEAD symref first; that is a local pointer
 * git itself writes on clone and on `git remote set-head`, so it costs no
 * network round trip. Falls back to asking the remote directly, via
 * `git remote show origin`, when that symref is missing, which happens on
 * clones and worktrees that never ran `git remote set-head origin -a`.
 */
export function resolveTrunk(cwd: string, remote: string = "origin"): TrunkResolution {
  try {
    const symref = run(["symbolic-ref", `refs/remotes/${remote}/HEAD`], cwd);
    const match = symref.match(new RegExp(`^refs/remotes/${remote}/(.+)$`));
    if (match?.[1]) {
      return { status: "resolved", trunkRef: `${remote}/${match[1]}`, branchName: match[1] };
    }
  } catch {
    // fall through to the live-remote fallback below
  }

  try {
    const shown = run(["remote", "show", remote], cwd);
    const match = shown.match(/HEAD branch:\s*(\S+)/);
    if (match?.[1] && match[1] !== "(unknown)") {
      return { status: "resolved", trunkRef: `${remote}/${match[1]}`, branchName: match[1] };
    }
    return {
      status: "unresolved",
      detail: `remote show ${remote} did not report a HEAD branch: ${shown.split("\n")[0]}`,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { status: "unresolved", detail: `could not resolve trunk for remote ${remote}: ${detail}` };
  }
}

/**
 * The content-presence primitive from the ticket. Returns true when every
 * change ref makes relative to its merge-base with trunk is already present
 * in trunk's current tree. Writes nothing to the working tree; the scratch
 * index passed via GIT_INDEX_FILE is the whole point, so a caller's actual
 * staged changes are never touched.
 *
 * A ref with zero commits ahead of trunk is checked first and short-
 * circuited to false. A brand-new branch created off trunk has an empty
 * diff against its own merge-base for the same reason a fossil branch
 * does, an empty diff alone cannot tell a starting point from a fossil.
 * Commits-ahead can: a fossil had work that is now in trunk, a fresh
 * branch never had work at all.
 */
export function isContentPresentInTrunk(ref: string, trunkRef: string, cwd: string): boolean {
  const ahead = run(["rev-list", "--count", `${trunkRef}..${ref}`], cwd);
  if (Number(ahead) === 0) {
    return false;
  }

  const base = run(["merge-base", ref, trunkRef], cwd);
  const diff = execFileSync("git", ["diff", base, ref], {
    cwd,
    encoding: "utf8",
    env: ISOLATED_GIT_ENV,
  });

  if (diff.trim() === "") {
    return true;
  }

  const scratchDir = mkdtempSync(join(tmpdir(), "hygiene-guard-"));
  try {
    const patchFile = join(scratchDir, "patch.diff");
    const scratchIndex = join(scratchDir, "index");
    writeFileSync(patchFile, diff);
    const scratchEnv = { ...ISOLATED_GIT_ENV, GIT_INDEX_FILE: scratchIndex };

    run(["read-tree", trunkRef], cwd, scratchEnv);
    try {
      run(["apply", "--cached", "--reverse", "--check", patchFile], cwd, scratchEnv);
      return true;
    } catch {
      return false;
    }
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
}

interface WorktreeEntry {
  path: string;
  branch: string | null;
  isMain: boolean;
  prunableReason: string | null;
}

/**
 * Resolves the repo's common git dir, per the addendum: never assume a
 * worktree's parent is the clone that visually contains it. A directory
 * scan can find worktrees the parent doesn't list, and it misses records
 * whose directory is already gone. `git worktree list`, run against the
 * resolved common dir, is the only source of truth for what this repo's
 * worktrees actually are.
 */
export function resolveGitCommonDir(cwd: string): string {
  // --path-format=absolute: bare `--git-common-dir` returns a path
  // relative to cwd, e.g. ".git", which two worktrees at different
  // filesystem depths would render as two different-looking strings for
  // the SAME repository. An absolute path is what actually lets this
  // guard tell "same parent repo" from "different repo" by comparison.
  return run(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd);
}

function listWorktrees(cwd: string): WorktreeEntry[] {
  const porcelain = run(["worktree", "list", "--porcelain"], cwd);
  const entries: WorktreeEntry[] = [];
  let current: Partial<WorktreeEntry> | null = null;

  const flush = () => {
    if (current?.path) {
      entries.push({
        path: current.path,
        branch: current.branch ?? null,
        isMain: false,
        prunableReason: current.prunableReason ?? null,
      });
    }
    current = null;
  };

  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) {
      flush();
      current = { path: line.slice("worktree ".length) };
    } else if (line.startsWith("branch ")) {
      const ref = line.slice("branch ".length);
      if (current) current.branch = ref.replace(/^refs\/heads\//, "");
    } else if (line.startsWith("prunable ")) {
      if (current) current.prunableReason = line.slice("prunable ".length);
    } else if (line === "") {
      flush();
    }
  }
  flush();

  if (entries.length > 0) entries[0]!.isMain = true;
  return entries;
}

function listLocalBranches(cwd: string): string[] {
  const output = run(["for-each-ref", "--format=%(refname:short)", "refs/heads/"], cwd);
  return output.split("\n").filter((line) => line.trim().length > 0);
}

/**
 * Cheap dirty check, run before the expensive content-presence check per
 * the addendum. Counts `git status --porcelain` entries in a worktree's
 * own directory. Any non-zero count means real, uncommitted state a
 * content check can never see, since content-presence only ever compares
 * committed diffs.
 */
function countDirtyEntries(worktreePath: string): number {
  const output = execFileSync("git", ["status", "--porcelain"], {
    cwd: worktreePath,
    encoding: "utf8",
    env: ISOLATED_GIT_ENV,
  });
  return output.split("\n").filter((line) => line.trim().length > 0).length;
}

export type DisposableItem =
  | { kind: "worktree"; branch: string; path: string; disposalCommand: string }
  | { kind: "worktree-dirty"; branch: string; path: string; dirtyCount: number }
  | { kind: "worktree-prunable"; path: string; prunableReason: string; disposalCommand: string }
  | { kind: "branch"; branch: string; disposalCommand: string };

export type HygieneResult =
  | { status: "trunk-unresolved"; detail: string }
  | { status: "clean"; trunkRef: string }
  | { status: "disposable"; trunkRef: string; items: DisposableItem[] };

/**
 * Runs the full guard: resolve trunk, then decide disposability by content
 * presence for every local branch and every registered worktree. Trunk
 * itself, and the branch checked out in a worktree whose branch equals
 * trunk, are never candidates: comparing trunk against itself is not the
 * question this guard asks.
 *
 * Prunable worktree records, directories git itself already knows are
 * gone, are always reported: there is no working tree left to lose, so the
 * dirty check does not apply to them, and `git worktree prune` is always
 * safe.
 *
 * For a worktree whose branch content IS present in trunk, the cheap dirty
 * check runs before deciding what to recommend: a dirty worktree is never
 * given a removal command, even though it is still reported and still
 * causes a refusal, because the repo still needs a human decision about
 * the uncommitted state a content check cannot see.
 */
export function checkHygiene(cwd: string, remote: string = "origin"): HygieneResult {
  const trunk = resolveTrunk(cwd, remote);
  if (trunk.status === "unresolved") {
    return { status: "trunk-unresolved", detail: trunk.detail };
  }

  const commonDir = resolveGitCommonDir(cwd);
  const worktrees = listWorktrees(commonDir);
  const worktreeByBranch = new Map<string, WorktreeEntry>();
  const items: DisposableItem[] = [];

  for (const wt of worktrees) {
    if (wt.prunableReason) {
      items.push({
        kind: "worktree-prunable",
        path: wt.path,
        prunableReason: wt.prunableReason,
        disposalCommand: "git worktree prune",
      });
      continue;
    }
    if (wt.branch) worktreeByBranch.set(wt.branch, wt);
  }

  const branches = listLocalBranches(cwd).filter((b) => b !== trunk.branchName);

  for (const branch of branches) {
    const wt = worktreeByBranch.get(branch);

    // Cheap dirty check first, and only on a real, non-prunable worktree:
    // it decides whether a content-present worktree gets a removal
    // command at all, per the addendum.
    if (wt && !wt.isMain) {
      const dirtyCount = countDirtyEntries(wt.path);
      if (dirtyCount > 0) {
        if (!isContentPresentInTrunk(branch, trunk.trunkRef, cwd)) continue;
        items.push({ kind: "worktree-dirty", branch, path: wt.path, dirtyCount });
        continue;
      }
    }

    if (!isContentPresentInTrunk(branch, trunk.trunkRef, cwd)) continue;

    if (wt && !wt.isMain) {
      items.push({
        kind: "worktree",
        branch,
        path: wt.path,
        disposalCommand: `git worktree remove --force ${wt.path}`,
      });
    } else if (wt && wt.isMain) {
      items.push({
        kind: "branch",
        branch,
        disposalCommand: `git checkout ${trunk.branchName} && git branch -D ${branch}`,
      });
    } else {
      items.push({
        kind: "branch",
        branch,
        disposalCommand: `git branch -D ${branch}`,
      });
    }
  }

  if (items.length === 0) {
    return { status: "clean", trunkRef: trunk.trunkRef };
  }
  return { status: "disposable", trunkRef: trunk.trunkRef, items };
}

function describeItem(item: DisposableItem, trunkRef: string): string {
  switch (item.kind) {
    case "worktree":
      return (
        `  - worktree: ${item.branch} (${item.path})\n` +
        `      already in ${trunkRef}. Disposal: ${item.disposalCommand}`
      );
    case "worktree-dirty":
      return (
        `  - worktree: ${item.branch} (${item.path})\n` +
        `      already in ${trunkRef}, DISPOSABLE-BUT-DIRTY: holds ${item.dirtyCount} uncommitted ` +
        `change(s). No removal command. Its owner decides.`
      );
    case "worktree-prunable":
      return (
        `  - worktree record: ${item.path}\n` +
        `      prunable (${item.prunableReason}). Disposal: ${item.disposalCommand}`
      );
    case "branch":
      return (
        `  - branch: ${item.branch}\n` + `      already in ${trunkRef}. Disposal: ${item.disposalCommand}`
      );
  }
}

export function formatResult(result: HygieneResult): { message: string; exitCode: number } {
  switch (result.status) {
    case "trunk-unresolved":
      return {
        exitCode: 1,
        message:
          `REFUSE, TRUNK UNRESOLVED: ${result.detail}\n` +
          `Cannot decide disposability without a trunk to compare against. Not guessing.`,
      };
    case "clean":
      return {
        exitCode: 0,
        message: `hygiene-guard: clean. No local branch or worktree is fully contained in ${result.trunkRef}.`,
      };
    case "disposable": {
      const lines = result.items.map((item) => describeItem(item, result.trunkRef));
      return {
        exitCode: 1,
        message:
          `REFUSE, FOSSIL STATE: ${result.items.length} item(s) already fully present in ${result.trunkRef}:\n` +
          lines.join("\n") +
          `\n\nClean these up, then push again.`,
      };
    }
  }
}

function main() {
  const cwd = process.argv[2] ?? process.cwd();
  const remote = process.argv[3] ?? "origin";
  const result = checkHygiene(cwd, remote);
  const { message, exitCode } = formatResult(result);
  if (exitCode === 0) {
    console.log(message);
  } else {
    console.error(message);
  }
  process.exit(exitCode);
}

const isDirectExecution =
  typeof process !== "undefined" &&
  Boolean(process.argv[1]) &&
  process.argv[1]!.endsWith("check-hygiene.ts");

if (isDirectExecution) {
  main();
}
