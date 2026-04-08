/**
 * Slack Events API webhook handler
 *
 * POST /api/slack/events
 *
 * Handles:
 * 1. URL verification challenge (required for Event Subscriptions setup)
 * 2. message.im events — dispatched to Inngest for durable processing
 *
 * Security:
 * - HMAC-SHA256 signature verification on every request
 * - Timestamp replay protection (5-minute window)
 * - Bot messages ignored (prevents loops)
 */

import { NextRequest } from "next/server";
import { verifySlackSignature } from "@/lib/slack/verify";
import { inngest } from "@/lib/inngest/client";

export async function POST(request: NextRequest) {
  // Read raw body for signature verification
  const rawBody = await request.text();

  // Verify signature
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    console.error("[Slack Events] SLACK_SIGNING_SECRET not configured");
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const signature = request.headers.get("x-slack-signature");
  const timestamp = request.headers.get("x-slack-request-timestamp");

  if (!verifySlackSignature(signingSecret, signature, timestamp, rawBody)) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Parse the verified body
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Handle URL verification challenge
  if (body.type === "url_verification") {
    return new Response(
      JSON.stringify({ challenge: body.challenge }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // Handle event callbacks
  if (body.type === "event_callback") {
    const event = body.event as Record<string, unknown> | undefined;
    if (!event) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Handle DM messages
    if (event.type === "message" && event.channel_type === "im") {
      // Ignore bot messages (prevents infinite loops)
      if (event.bot_id || event.subtype === "bot_message") {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Ignore message edits, deletions, etc. — only handle new messages
      // Allow file_share subtype (image uploads) through
      if (event.subtype && event.subtype !== "file_share") {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      const slackUserId = event.user as string;
      const channelId = event.channel as string;
      const messageText = (event.text as string) ?? "";
      const messageTs = event.ts as string;

      // Extract image attachments from Slack file uploads
      const files = event.files as Array<{ mimetype?: string; url_private?: string; name?: string }> | undefined;
      const imageFiles = files?.filter(f =>
        f.url_private && f.mimetype?.startsWith("image/")
      ).map(f => ({ url: f.url_private!, mimetype: f.mimetype!, name: f.name })) ?? [];

      if (!slackUserId || !channelId || !messageTs || (!messageText && imageFiles.length === 0)) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Dispatch to Inngest for durable processing
      await inngest.send({
        name: "runway/slack.message",
        data: {
          slackUserId,
          channelId,
          messageText,
          messageTs,
          imageFiles: imageFiles.length > 0 ? imageFiles : undefined,
        },
      });
    }
  }

  // Always respond 200 to Slack (they retry on non-2xx)
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
