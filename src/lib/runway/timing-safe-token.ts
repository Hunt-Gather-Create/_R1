import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison of a candidate token against the configured key.
 *
 * `crypto.timingSafeEqual` throws on unequal-length buffers, so we length-check
 * first and return false early. That early return leaks only the LENGTH of the
 * key, which is the standard, accepted trade-off; the byte-by-byte compare below
 * does not short-circuit, so equal-length wrong tokens cannot be recovered by
 * timing. Bytes are compared as UTF-8 (Buffer.from default).
 */
export function timingSafeTokenMatch(token: string, apiKey: string): boolean {
  const a = Buffer.from(token);
  const b = Buffer.from(apiKey);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
