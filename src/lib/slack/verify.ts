/**
 * Slack request signature verification
 *
 * Verifies X-Slack-Signature using HMAC-SHA256 with SLACK_SIGNING_SECRET.
 * Rejects requests with timestamps older than 5 minutes (replay protection).
 */

import { createHmac, timingSafeEqual } from "crypto";

const MAX_TIMESTAMP_AGE_SECONDS = 60 * 5; // 5 minutes

export function verifySlackSignature(
  signingSecret: string,
  signature: string | null,
  timestamp: string | null,
  rawBody: string
): boolean {
  if (!signature || !timestamp) {
    return false;
  }

  // Reject stale requests (replay protection)
  const timestampNum = parseInt(timestamp, 10);
  if (isNaN(timestampNum)) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampNum) > MAX_TIMESTAMP_AGE_SECONDS) {
    return false;
  }

  // Compute expected signature
  const baseString = `v0:${timestamp}:${rawBody}`;
  const expectedSignature =
    "v0=" + createHmac("sha256", signingSecret).update(baseString).digest("hex");

  // Timing-safe comparison
  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (sigBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(sigBuffer, expectedBuffer);
}
