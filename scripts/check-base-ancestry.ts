/**
 * Standalone gate for _R1#115. It refuses to let a caller trust a
 * candidate "mainline" ref, such as origin/runway, once that ref has
 * fallen behind or diverged from the real upstream integration branch,
 * Hunt-Gather-Create/_R1 runway.
 *
 * The incident this exists for: QA-Scout clones from the fork, origin,
 * not upstream. When origin/runway drifted 12 commits behind
 * Hunt-Gather-Create/_R1 runway, every merge-base QA computed against it
 * landed on a stale common ancestor instead of the real integration tip,
 * turning a 3-file ticket into a 72-file phantom diff. The merge-base
 * QA computed was not wrong in the sense of unreachable. It was a real
 * commit, on the real history. It was just not the commit any caller
 * actually wanted, because the ref it was computed against no longer
 * reflects upstream truth.
 *
 * The check: fetch Hunt-Gather-Create/_R1's runway branch fresh, never
 * trusting a locally configured remote, since that remote can be exactly
 * as stale as origin/runway was. Then confirm the fetched tip is an
 * ancestor of the candidate ref. If the true tip is not present in the
 * candidate's history, the candidate is stale or has diverged, and any
 * merge-base or diff computed against it cannot be trusted. That is the
 * literal, mechanical form of "is d1c65ff an ancestor of origin/runway"
 * that this ticket's own incident report already used by hand.
 *
 * Three distinguishable outcomes, on purpose, per _R1#107 and #115's
 * done-when. A wrong base, a good base, and an unreachable remote must
 * never render the same, because a caller that cannot tell them apart
 * will treat "I don't know" as "it's fine."
 */
import { execFileSync } from "node:child_process";

export const TRUTH_REMOTE_URL = "https://github.com/Hunt-Gather-Create/_R1.git";
export const TRUTH_BRANCH = "runway";

export type AncestryResult =
  | { status: "pass"; truthTip: string; candidateSha: string; candidate: string }
  | { status: "wrong-base"; truthTip: string; candidateSha: string; candidate: string }
  | { status: "unreachable-remote"; remoteUrl: string; branch: string; detail: string };

// A caller that invokes this gate from inside a git hook, such as a future
// pre-push or CI wiring, runs with GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE,
// or GIT_COMMON_DIR already set in its process environment, since that is
// how git itself invokes hooks. Left in place, git honors those inherited
// variables over the cwd this file passes, so every rev-parse, fetch, and
// merge-base below would silently resolve against whatever repository the
// caller's hook happens to be running in rather than the cwd this gate was
// actually asked to check. Stripping them here makes cwd the only thing
// that decides which repository every git call in this file talks to,
// regardless of what invoked it.
const ISOLATED_GIT_ENV = { ...process.env };
delete ISOLATED_GIT_ENV.GIT_DIR;
delete ISOLATED_GIT_ENV.GIT_WORK_TREE;
delete ISOLATED_GIT_ENV.GIT_INDEX_FILE;
delete ISOLATED_GIT_ENV.GIT_COMMON_DIR;

function run(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: ISOLATED_GIT_ENV }).trim();
}

/**
 * Fetches truthUrl/truthBranch fresh into FETCH_HEAD and returns its
 * commit SHA. Never assumes a locally configured remote, such as
 * "upstream", is present or current. That is exactly the assumption
 * that let origin/runway serve stale data undetected.
 */
function resolveTruthTip(cwd: string, truthUrl: string, truthBranch: string): string {
  execFileSync("git", ["fetch", "--quiet", truthUrl, truthBranch], {
    cwd,
    stdio: ["ignore", "ignore", "pipe"],
    env: ISOLATED_GIT_ENV,
  });
  return run(["rev-parse", "FETCH_HEAD"], cwd);
}

/**
 * Runs the gate: is truthUrl's truthBranch tip an ancestor of candidateRef?
 * Every git call here is a read: fetch, rev-parse, merge-base --is-ancestor.
 * Nothing is pushed, deleted, or renamed on any remote.
 */
export function checkBaseAncestry(
  candidateRef: string,
  cwd: string = process.cwd(),
  truthUrl: string = TRUTH_REMOTE_URL,
  truthBranch: string = TRUTH_BRANCH,
): AncestryResult {
  let truthTip: string;
  try {
    truthTip = resolveTruthTip(cwd, truthUrl, truthBranch);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { status: "unreachable-remote", remoteUrl: truthUrl, branch: truthBranch, detail };
  }

  const candidateSha = run(["rev-parse", `${candidateRef}^{commit}`], cwd);

  try {
    execFileSync("git", ["merge-base", "--is-ancestor", truthTip, candidateSha], {
      cwd,
      env: ISOLATED_GIT_ENV,
    });
    return { status: "pass", truthTip, candidateSha, candidate: candidateRef };
  } catch {
    return { status: "wrong-base", truthTip, candidateSha, candidate: candidateRef };
  }
}

export function formatResult(result: AncestryResult, truthBranch: string = TRUTH_BRANCH): {
  message: string;
  exitCode: number;
} {
  switch (result.status) {
    case "pass":
      return {
        exitCode: 0,
        message:
          `PASS: Hunt-Gather-Create/_R1 ${truthBranch} tip ${result.truthTip} is an ancestor ` +
          `of ${result.candidate} (${result.candidateSha}). This base reflects upstream truth.`,
      };
    case "wrong-base":
      return {
        exitCode: 1,
        message:
          `REFUSE, WRONG BASE: Hunt-Gather-Create/_R1 ${truthBranch} tip ${result.truthTip} ` +
          `is NOT an ancestor of ${result.candidate} (${result.candidateSha}). ` +
          `${result.candidate} is stale or has diverged from upstream truth. ` +
          `Any merge-base or diff scope computed against it cannot be trusted.`,
      };
    case "unreachable-remote":
      return {
        exitCode: 2,
        message:
          `REFUSE, UNREACHABLE REMOTE: could not fetch ${result.branch} from ${result.remoteUrl}. ` +
          `Cannot determine upstream truth, so no base can be validated. ` +
          `This is distinct from a wrong base: it means "unknown", not "known bad". ` +
          `Detail: ${result.detail.split("\n")[0]}`,
      };
  }
}

function main() {
  const candidateRef = process.argv[2];
  if (!candidateRef) {
    console.error(
      "usage: npx tsx scripts/check-base-ancestry.ts <candidate-ref> [truth-url] [truth-branch]",
    );
    process.exit(64);
  }
  const truthUrl = process.argv[3] ?? TRUTH_REMOTE_URL;
  const truthBranch = process.argv[4] ?? TRUTH_BRANCH;

  const result = checkBaseAncestry(candidateRef, process.cwd(), truthUrl, truthBranch);
  const { message, exitCode } = formatResult(result, truthBranch);
  if (exitCode === 0) {
    console.log(message);
  } else {
    console.error(message);
  }
  process.exit(exitCode);
}

// Direct-execution guard, matching the pattern in scripts/lib/run-script.ts's
// runIfDirect. Checked inline rather than imported, since that helper pulls
// in loadEnvLocal and the Turso DB factory, and this script has no DB
// dependency and every git call here must stay a plain read.
const isDirectExecution =
  typeof process !== "undefined" &&
  Boolean(process.argv[1]) &&
  process.argv[1]!.endsWith("check-base-ancestry.ts");

if (isDirectExecution) {
  main();
}
