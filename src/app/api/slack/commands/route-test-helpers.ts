/**
 * Shared test helpers for Slack slash-commands route tests.
 *
 * Mirrors the pattern in `events/route-test-helpers.ts` (HMAC-signed Request
 * factory) but produces an `application/x-www-form-urlencoded` body suited for
 * Slack slash commands. The body payload is built from a fixture-style
 * key/value object (matches the parsed shape stored in
 * `tests/fixtures/slack/slash-command-*.json`).
 */

import { makeSlackSignature, nowTimestamp } from "@/lib/slack/test-helpers";

export function encodeFormBody(payload: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(payload)) {
    // Drop fixture-only meta keys that start with `_`.
    if (k.startsWith("_")) continue;
    params.set(k, v);
  }
  return params.toString();
}

export function makeSlashRequest(
  payload: Record<string, string>,
  options?: {
    signature?: string | null;
    timestamp?: string | null;
    signingSecret?: string;
    bodyOverride?: string;
  },
): Request {
  const secret = options?.signingSecret ?? "test_secret";
  const ts = options?.timestamp ?? nowTimestamp();
  const body = options?.bodyOverride ?? encodeFormBody(payload);
  const sig =
    options?.signature !== undefined
      ? options.signature
      : makeSlackSignature(secret, ts, body);

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (sig !== null) headers["x-slack-signature"] = sig;
  if (ts !== null) headers["x-slack-request-timestamp"] = ts;

  return new Request("http://localhost/api/slack/commands", {
    method: "POST",
    headers,
    body,
  });
}
