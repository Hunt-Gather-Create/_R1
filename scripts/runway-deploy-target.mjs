/**
 * Single source of truth for "is this deploy serving the prod Runway DB?"
 *
 * Shared by scripts/runway-schema-push.mjs (build-time schema push gate) and
 * src/lib/db/runway-prod-write-guard.ts (runtime write guard, #100). Keeping
 * ONE predicate prevents drift between the two — a drift would either 500 the
 * live app or leave the prod-write hole open.
 *
 * Prod-serving = VERCEL_ENV==='production' OR a runway-branch cloud deploy
 * (ref 'runway' + a VERCEL_DEPLOYMENT_ID marker + no PR link). This mirrors the
 * schema-push env matrix exactly; a PR-linked runway preview and a runway ref
 * without the deploy marker are NOT prod-serving.
 *
 * @param {{VERCEL_ENV?: string, VERCEL_GIT_COMMIT_REF?: string, VERCEL_DEPLOYMENT_ID?: string, VERCEL_GIT_PULL_REQUEST_ID?: string}} env
 * @returns {boolean}
 */
export function isProdServingDeploy(env) {
  if (env.VERCEL_ENV === "production") return true;
  if (env.VERCEL_GIT_COMMIT_REF === "runway") {
    const pullRequestId = env.VERCEL_GIT_PULL_REQUEST_ID?.trim() ?? "";
    const deploymentId = env.VERCEL_DEPLOYMENT_ID?.trim() ?? "";
    return pullRequestId.length === 0 && deploymentId.length > 0;
  }
  return false;
}
