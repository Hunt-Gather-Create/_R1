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
import { generateText, stepCountIs } from "ai";
import { getSlackClient } from "./client";
import { getTeamMemberBySlackId } from "@/lib/runway/operations";
import { createBotTools } from "./bot-tools";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_STEPS = 5;

/**
 * Build the system prompt for the Runway bot.
 * Clean, factual, no AI voice.
 */
export function buildBotSystemPrompt(userName: string): string {
  return `You are the Civilization Runway bot. You help team members update project statuses and log information about client work.

## Your role
- Understand what the person is telling you about a project or client
- Use the tools to look up the right project and make updates
- Confirm changes clearly and factually
- After confirming an update, you can offer: "I've got a couple things that could use your input. Want me to run through them?"

## Rules
- Be concise. No filler, no fluff.
- Never use em dashes.
- Never say "I've updated" or "I've processed" or anything AI-sounding.
- Speak plainly like a teammate, not an assistant.
- If you're not sure which project they mean, ask. Don't guess.
- If the update doesn't match any known client or project, say so and list what's available.

## Context
- The person messaging you is: ${userName}
- They are a Civilization team member updating project status via DM.
- You have tools to look up clients, projects, and make updates.
- Every status change gets logged and posted to the updates channel automatically.

## Status values
Projects use these statuses: in-production, awaiting-client, not-started, blocked, on-hold, completed

## When making updates
1. First use get_clients and/or get_projects to find the right project
2. Call update_project_status or add_update to make the change
3. Confirm what you did in plain language
4. The updates channel post happens automatically`;
}

/**
 * Handle a DM message from a team member.
 * Posts the bot's response as a threaded reply.
 */
export async function handleDirectMessage(
  slackUserId: string,
  channelId: string,
  messageText: string,
  messageTs: string
): Promise<void> {
  const slack = getSlackClient();

  // Look up team member
  const userName =
    (await getTeamMemberBySlackId(slackUserId)) ?? "Unknown team member";

  const tools = createBotTools(userName);

  try {
    const result = await generateText({
      model: anthropic(MODEL),
      system: buildBotSystemPrompt(userName),
      messages: [{ role: "user", content: messageText }],
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
