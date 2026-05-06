/**
 * Feature flags — process.env-driven boolean toggles.
 *
 * Wave 0b (Phase 0) seed: the modal intercept layer is gated behind
 * `MODAL_INTERCEPT_ENABLED` so we can ship the route + Inngest scaffolding
 * before flipping the bot LLM intercept on in production. Add new flags here
 * — keep each as a tiny pure helper that reads `process.env` at call time so
 * Vercel preview / canary deploys can toggle without re-deploy.
 */

/**
 * Returns `true` when `process.env.MODAL_INTERCEPT_ENABLED === "true"`.
 * Any other value (unset, empty, "0", "false", "TRUE", etc.) returns `false`
 * — strict literal match keeps the flag explicit on a per-environment basis.
 */
export function isModalInterceptEnabled(): boolean {
  return process.env.MODAL_INTERCEPT_ENABLED === "true";
}
