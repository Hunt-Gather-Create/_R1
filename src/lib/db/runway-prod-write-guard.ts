/**
 * Runway prod-write guard (#100).
 *
 * Blocks a NON-prod-serving Vercel deploy (preview / canary) pointed at the
 * prod DB from touching it, closing the manual-discipline-only hole behind the
 * 2026-07-27 SEV-2 (RW-INC-2026-07-27-01). Wired at the single DB choke point,
 * getRunwayClient() in ./runway.ts.
 *
 * Prod-serving detection is the SHARED single-source predicate from
 * scripts/runway-deploy-target.mjs (also used by the schema-push gate) so the
 * two can never drift. The error message never interpolates the DB URL.
 */
import { isProdServingDeploy } from "../../../scripts/runway-deploy-target.mjs";

export { isProdServingDeploy };

type GuardEnv = {
  VERCEL_ENV?: string;
  VERCEL_GIT_COMMIT_REF?: string;
  VERCEL_DEPLOYMENT_ID?: string;
  VERCEL_GIT_PULL_REQUEST_ID?: string;
  RUNWAY_DATABASE_URL?: string;
  [key: string]: string | undefined;
};

/** Prod URL heuristic — matches the merged E3 target-guard: prod = not staging. */
export function urlIsProd(url: string | undefined): boolean {
  const u = url?.trim() ?? "";
  return u.length > 0 && !u.includes("staging");
}

/** True when a non-prod-serving Vercel deploy has resolved a prod DB URL. */
export function isBlockedProdWrite(env: GuardEnv): boolean {
  const isVercelDeploy = (env.VERCEL_ENV ?? "").length > 0;
  if (!isVercelDeploy) return false; // local / non-Vercel — not a deploy
  if (isProdServingDeploy(env)) return false; // legitimately serving prod
  return urlIsProd(env.RUNWAY_DATABASE_URL);
}

/** Throw before any DB use when a non-prod deploy would touch prod. */
export function assertRunwayProdWriteAllowed(env: GuardEnv): void {
  if (isBlockedProdWrite(env)) {
    throw new Error(
      "Runway DB access blocked: a non-prod deploy (VERCEL_ENV=" +
        (env.VERCEL_ENV ?? "unset") +
        ") resolved the prod database. Point preview/canary deploys at runway-staging.",
    );
  }
}
