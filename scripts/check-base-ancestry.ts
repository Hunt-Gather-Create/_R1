/**
 * Standalone gate for _R1#115: refuses to let a caller trust a candidate
 * "mainline" ref (e.g. origin/runway) once it has fallen behind or
 * diverged from the real upstream integration branch,
 * Hunt-Gather-Create/_R1 runway.
 *
 * The incident this exists for: QA-Scout clones from the fork (origin),
 * not upstream. When origin/runway drifted 12 commits behind
 * Hunt-Gather-Create/_R1 runway, every merge-base QA computed against it
 * landed on a stale common ancestor instead of the real integration tip,
 * turning a 3-file ticket into a 72-file phantom diff. The merge-base
 * QA computed was not wrong in the sense of "unreachable" — it was a real
 * commit, on the real history — it was just not the commit any caller
 * actually wanted, because the ref it was computed against no longer
 * reflects upstream truth.
 *
 * The check: fetch Hunt-Gather-Create/_R1's runway branch fresh (never
 * trust a locally configured remote — it can be exactly as stale as
 * origin/runway was) and confirm its tip is an ancestor of the candidate
 * ref. If the true tip is not present in the candidate's history, the
 * candidate is stale or has diverged, and any merge-base or diff computed
 * against it cannot be trusted. That is the literal, mechanical form of
 * "is d1c65ff an ancestor of origin/runway" that this ticket's own
 * incident report already used by hand.
 *
 * Three distinguishable outcomes, on purpose (see _R1#107 and #115's
 * done-when): a wrong base, a good base, and an unreachable remote must
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

function run(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/**
 * Fetches truthUrl/truthBranch fresh into FETCH_HEAD and returns its
 * commit SHA. Never assumes a locally configured remote (e.g. "upstream")
 * is present or current — that is exactly the assumption that let
 * origin/runway serve stale data undetected.
 */
function resolveTruthTip(cwd: string, truthUrl: string, truthBranch: string): string {
  execFileSync("git", ["fetch", "--quiet", truthUrl, truthBranch], {
    cwd,
    stdio: ["ignore", "ignore", "pipe"],
  });
  return run(["rev-parse", "FETCH_HEAD"], cwd);
}

/**
 * Runs the gate: is truthUrl's truthBranch tip an ancestor of candidateRef?
 * Every git call here is a read (fetch, rev-parse, merge-base --is-ancestor).
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
    execFileSync("git", ["merge-base", "--is-ancestor", truthTip, candidateSha], { cwd });
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
          `REFUSE (wrong base): Hunt-Gather-Create/_R1 ${truthBranch} tip ${result.truthTip} ` +
          `is NOT an ancestor of ${result.candidate} (${result.candidateSha}). ` +
          `${result.candidate} is stale or has diverged from upstream truth. ` +
          `Any merge-base or diff scope computed against it cannot be trusted.`,
      };
    case "unreachable-remote":
      return {
        exitCode: 2,
        message:
          `REFUSE (unreachable remote): could not fetch ${result.branch} from ${result.remoteUrl}. ` +
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
// runIfDirect — checked inline rather than imported, since that helper pulls
// in loadEnvLocal and the Turso DB factory, and this script has no DB
// dependency and every git call here must stay a plain read.
const isDirectExecution =
  typeof process !== "undefined" &&
  Boolean(process.argv[1]) &&
  process.argv[1]!.endsWith("check-base-ancestry.ts");

if (isDirectExecution) {
  main();
}
