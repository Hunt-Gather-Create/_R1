/**
 * Shared test utilities for Slack signature verification tests.
 * Used by verify.test.ts and events/route.test.ts.
 */

import { createHmac } from "crypto";

export function makeSlackSignature(
  secret: string,
  timestamp: string,
  body: string
): string {
  const baseString = `v0:${timestamp}:${body}`;
  return "v0=" + createHmac("sha256", secret).update(baseString).digest("hex");
}

export function nowTimestamp(): string {
  return Math.floor(Date.now() / 1000).toString();
}
