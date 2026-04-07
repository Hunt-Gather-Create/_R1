/**
 * Runway Slack Bot — AI orchestration layer
 *
 * Receives DM messages, uses Haiku to understand intent,
 * calls shared Runway operations to read/write data, and posts
 * formatted updates to the updates channel.
 *
 * Flow:
 * 1. Team member DMs the bot: "Convergix CDS went to Daniel today"
 * 2. AI (Haiku) interprets, calls tools backed by shared operations
 * 3. Bot responds with confirmation
 * 4. Update posted to updates channel in agreed format
 *
 * Tools defined in ./bot-tools.ts
 */

import { anthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs, type UserContent } from "ai";
import { getSlackClient } from "./client";
import {
  getTeamMemberBySlackId,
  getTeamMemberRecordBySlackId,
} from "@/lib/runway/operations";
import { createBotTools } from "./bot-tools";
import { buildBotSystemPrompt } from "@/lib/runway/bot-context";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_STEPS = 5;

export interface SlackImage {
  mimetype: string;
  base64: string;
}

/**
 * Handle a DM message from a team member.
 * Posts the bot's response as a threaded reply.
 */
export async function handleDirectMessage(
  slackUserId: string,
  channelId: string,
  messageText: string,
  messageTs: string,
  images?: SlackImage[]
): Promise<void> {
  const slack = getSlackClient();

  // Look up team member (both name for tools and full record for prompt)
  const [userName, teamMemberRecord] = await Promise.all([
    getTeamMemberBySlackId(slackUserId),
    getTeamMemberRecordBySlackId(slackUserId),
  ]);

  const displayName = userName ?? "Unknown team member";
  const tools = createBotTools(displayName);

  // Build message content — use content blocks when images are present
  let userContent: UserContent = messageText;
  if (images?.length) {
    const parts: Array<{ type: "text"; text: string } | { type: "image"; image: string; mediaType: string }> = [];
    if (messageText) {
      parts.push({ type: "text", text: messageText });
    }
    for (const img of images) {
      parts.push({
        type: "image",
        image: img.base64,
        mediaType: img.mimetype,
      });
    }
    userContent = parts;
  }

  try {
    const result = await generateText({
      model: anthropic(MODEL),
      system: buildBotSystemPrompt(teamMemberRecord, new Date()),
      messages: [{ role: "user", content: userContent }],
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
      maxRetries: 1,
    });

    await slack.chat.postMessage({
      channel: channelId,
      text: result.text,
      thread_ts: messageTs,
    });
  } catch (err) {
    console.error("[Runway Bot] AI generation failed:", err);
    await slack.chat.postMessage({
      channel: channelId,
      text: "Something went wrong processing your message. Try again or check with the team.",
      thread_ts: messageTs,
    });
  }
}
