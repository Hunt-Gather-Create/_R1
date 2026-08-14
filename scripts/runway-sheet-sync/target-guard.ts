/**
 * assertTarget — pure guard for the --apply executor CLI.
 *
 * Called BEFORE any write. Throws on:
 *   - target not "staging" | "prod"
 *   - target/host mismatch
 *   - prod without the allow env signal
 *
 * Never interpolates the resolved DB url into any error message.
 */
export function assertTarget(
  target: string | undefined,
  resolvedUrl: string,
  env: NodeJS.ProcessEnv,
): void {
  if (target !== "staging" && target !== "prod") {
    throw new Error("--apply requires --target staging|prod (no default)");
  }

  const isStaging = resolvedUrl.includes("staging");

  if (target === "staging" && !isStaging) {
    throw new Error("--target staging but the resolved DB is a non-staging url");
  }

  if (target === "prod" && isStaging) {
    throw new Error("--target prod but the resolved DB is a staging url");
  }

  if (target === "prod" && env["RUNWAY_ALLOW_" + "PROD_WRITE"] !== "1") {
    throw new Error("--target prod requires RUNWAY_ALLOW_" + "PROD_WRITE=1");
  }
}
