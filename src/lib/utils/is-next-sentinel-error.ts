/**
 * Type guard for Next.js internal sentinel errors (NEXT_REDIRECT,
 * NEXT_NOT_FOUND, DYNAMIC_SERVER_USAGE, NEXT_HTTP_ERROR_FALLBACK).
 *
 * Next throws these from inside server code to signal control flow
 * (redirects, not-found, dynamic-bailout). They look like regular
 * errors but carry a non-empty string `digest` field; framework helpers
 * such as `isRedirectError` / `isNotFoundError` rely on this convention.
 *
 * Catch sites that mean to swallow auth/access errors but re-throw
 * sentinels must use this guard so the framework's control flow keeps
 * working. Truthy / non-string / empty-string digests are NOT sentinels
 * and must be swallowed locally.
 */
export function isNextSentinelError(
  err: unknown,
): err is { digest: string } {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest?: unknown }).digest === "string" &&
    (err as { digest: string }).digest.length > 0
  );
}
