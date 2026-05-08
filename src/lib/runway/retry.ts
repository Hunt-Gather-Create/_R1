/**
 * Retry helper for transient libsql/Turso network errors on the Runway hot path.
 *
 * Why this exists:
 *   `runway.startround1.com` intermittently 500s on `/runway` page renders. The
 *   stack trace consistently shows a Drizzle/libsql query failing with a
 *   `cause: FetchError ... code: 'ECONNRESET'` — a socket hang-up to Jason's
 *   free-tier Turso instance (`runway-jasonburks.aws-us-east-1.turso.io`). The
 *   same query succeeds on retry. This is transient network jitter, not a
 *   data-state bug.
 *
 * Scope (deliberately narrow):
 *   - Wraps READ paths only. Writes go through the audit + idempotency layer
 *     in `src/lib/runway/operations-writes-*.ts`; if a write hits ECONNRESET,
 *     the operator re-runs the script and idempotency keys protect against
 *     duplicates.
 *   - Catches ONLY transient network errors. Anything that smells like a real
 *     data/SQL/validation problem propagates immediately. Retrying a SQL
 *     syntax error or a constraint violation just delays the failure.
 *   - 2 retries (3 total attempts) max, with exponential backoff + jitter.
 *
 * Not configurable. No env flags, no telemetry, no feature toggles. If the
 * defaults stop being right, change the defaults.
 */

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 50;

/**
 * Strings/codes seen on transient libsql/Turso socket failures. We match
 * loosely (substring on message, exact on `.code`) because the error chain
 * from libsql → drizzle wraps the underlying FetchError differently across
 * versions: sometimes `.code` is set on the top-level error, sometimes only
 * on `.cause`, sometimes the message is the only signal.
 */
const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ENETUNREACH",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
]);

const TRANSIENT_MESSAGE_FRAGMENTS = [
  "socket hang up",
  "ECONNRESET",
  "ETIMEDOUT",
  "fetch failed",
  "network error",
  "other side closed",
];

/**
 * Walk an error and its `.cause` chain looking for a transient-network signal.
 * Drizzle wraps libsql errors, libsql wraps node-fetch errors — the original
 * ECONNRESET can be 2-3 levels deep.
 */
function isTransientNetworkError(err: unknown): boolean {
  let current: unknown = err;
  // Cap depth defensively — `.cause` cycles are unlikely but cheap to guard.
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current !== "object" || current === null) return false;

    const e = current as { code?: unknown; type?: unknown; message?: unknown; name?: unknown; cause?: unknown };

    if (typeof e.code === "string" && TRANSIENT_CODES.has(e.code)) return true;
    // node-fetch / undici FetchError: `.type === 'system'` plus `.code` set above
    if (e.type === "system" && typeof e.code === "string" && TRANSIENT_CODES.has(e.code)) return true;

    if (typeof e.message === "string") {
      const msg = e.message;
      for (const frag of TRANSIENT_MESSAGE_FRAGMENTS) {
        if (msg.includes(frag)) return true;
      }
    }

    current = e.cause;
  }
  return false;
}

/**
 * Run `fn` and retry on transient libsql/Turso network errors.
 *
 * - Up to 3 attempts (1 initial + 2 retries)
 * - Backoff: ~50ms, ~150ms, with ±50% jitter so concurrent renders don't
 *   thunder-herd on a flapping socket
 * - Non-transient errors propagate immediately (no retry)
 * - On exhaustion, re-throws the most recent error untouched (caller sees
 *   the same stack they'd have seen with no wrapper)
 *
 * `label` shows up in the stderr log line so you can tell which read path
 * is flapping when the logs scroll by.
 */
export async function withRunwayRetry<T>(
  fn: () => Promise<T>,
  label: string,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientNetworkError(err)) throw err;
      if (attempt === MAX_ATTEMPTS) break;

      const errName =
        err instanceof Error ? err.name || err.constructor.name : typeof err;
      const delay = computeBackoffMs(attempt);
      // stderr log so it shows up in Vercel runtime logs alongside the
      // error trace it precedes when the retry ultimately fails.
      console.warn(
        `[runway-retry] ${label} attempt ${attempt}/${MAX_ATTEMPTS} failed (${errName}); retrying in ${delay}ms`,
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

function computeBackoffMs(attempt: number): number {
  // attempt 1 → ~50ms, attempt 2 → ~150ms (before jitter)
  const base = BASE_DELAY_MS * Math.pow(3, attempt - 1);
  const jitter = base * (Math.random() - 0.5); // ±50%
  return Math.max(0, Math.round(base + jitter));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Exported only for tests — keeps the helper's public surface to a single
// function while letting the predicate stay covered.
export const __test = { isTransientNetworkError };
