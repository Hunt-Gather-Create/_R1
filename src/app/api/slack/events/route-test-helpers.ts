/**
 * Shared test helpers for Slack events route tests.
 */

import { makeSlackSignature, nowTimestamp } from "@/lib/slack/test-helpers";

export function makeRequest(
  body: string,
  options?: {
    signature?: string | null;
    timestamp?: string | null;
    signingSecret?: string;
  }
): Request {
  const secret = options?.signingSecret ?? "test_secret";
  const ts = options?.timestamp ?? nowTimestamp();
  const sig =
    options?.signature !== undefined
      ? options.signature
      : makeSlackSignature(secret, ts, body);

  const headers: Record<string, string> = {};
  if (sig !== null) headers["x-slack-signature"] = sig;
  if (ts !== null) headers["x-slack-request-timestamp"] = ts;

  return new Request("http://localhost/api/slack/events", {
    method: "POST",
    headers,
    body,
  });
}
