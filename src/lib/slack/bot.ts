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
  getStaleItemsForAccounts,
} from "@/lib/runway/operations";
import { createBotTools } from "./bot-tools";
import { buildBotSystemPrompt } from "@/lib/runway/bot-context";
import { formatProactiveFollowUp } from "./bot-proactive";

const MODEL = "claude-sonnet-4-6";
const MAX_STEPS = 12;

/** Tool names that mutate project/week-item data — used to exclude just-updated items from proactive nudge. */
const MUTATION_TOOLS = [
  "update_project_status",
  "add_update",
  "update_project_field",
  "create_project",
  "create_week_item",
  "update_week_item",
] as const;
const MAX_THREAD_MESSAGES = 20;

export interface SlackImage {
  mimetype: string;
  base64: string;
}

/**
 * Fetch thread history from Slack and convert to AI message format.
 * Caps at the most recent messages to control token usage.
 */
async function fetchThreadHistory(
  channelId: string,
  threadTs: string,
  currentMessageTs: string
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const slack = getSlackClient();
  const result = await slack.conversations.replies({
    channel: channelId,
    ts: threadTs,
    inclusive: true,
  });

  if (!result.messages) return [];

  // Exclude the current message (added separately with full content blocks)
  // Take the most recent for token budget
  const threadMessages = result.messages
    .filter((m: { ts?: string }) => m.ts !== currentMessageTs)
    .slice(-MAX_THREAD_MESSAGES);

  return threadMessages
    .map((m: { bot_id?: string; text?: string }) => ({
      role: (m.bot_id ? "assistant" : "user") as "user" | "assistant",
      content: m.text ?? "",
    }))
    .filter((m) => m.content.length > 0);
}

/**
 * Collect project names the bot just updated, then nudge about stale items
 * on the user's accounts (excluding the ones just touched).
 */
async function handleProactiveFollowUp(
  result: { steps: Array<{ toolCalls: Array<{ toolName: string; input: unknown }> }> },
  teamMemberRecord: { accountsLed?: string[] } | null,
  channelId: string,
  replyTs: string,
  displayName: string
): Promise<void> {
  if (!teamMemberRecord?.accountsLed?.length) return;

  const updatedProjects: string[] = [];
  for (const step of result.steps) {
    for (const call of step.toolCalls) {
      if (
        MUTATION_TOOLS.includes(call.toolName as typeof MUTATION_TOOLS[number]) &&
        call.input &&
        typeof call.input === "object" &&
        "projectName" in call.input &&
        typeof call.input.projectName === "string"
      ) {
        updatedProjects.push(call.input.projectName);
      }
    }
  }

  const staleItems = await getStaleItemsForAccounts(teamMemberRecord.accountsLed, displayName);
  if (staleItems.length > 0) {
    const followUp = formatProactiveFollowUp(staleItems, updatedProjects);
    if (followUp) {
      const slack = getSlackClient();
      await slack.chat.postMessage({
        channel: channelId,
        text: followUp,
        thread_ts: replyTs,
      });
    }
  }
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
  threadTs?: string,
  images?: SlackImage[]
): Promise<void> {
  const slack = getSlackClient();

  // Look up team member (both name for tools and full record for prompt)
  const [userName, teamMemberRecord] = await Promise.all([
    getTeamMemberBySlackId(slackUserId),
    getTeamMemberRecordBySlackId(slackUserId),
  ]);

  const displayName = userName ?? "Unknown team member";
  const now = new Date();
  const tools = createBotTools(displayName, now);

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
    const systemPrompt = buildBotSystemPrompt(teamMemberRecord, now);

    // Build messages array — include thread history when in a thread
    const threadHistory = threadTs
      ? await fetchThreadHistory(channelId, threadTs, messageTs)
      : [];

    // Prompt caching: system prompt is placed as a cached message so repeated
    // calls with the same prompt (team roster, query recipes, etc.) hit cache.
    // Cache control must be on the message itself, not at the call level.
    const cacheControl = { cacheControl: { type: "ephemeral" as const } };
    const messages = [
      {
        role: "system" as const,
        content: systemPrompt,
        providerOptions: { anthropic: cacheControl },
      },
      ...threadHistory,
      { role: "user" as const, content: userContent },
    ];

    const result = await generateText({
      model: anthropic(MODEL),
      messages,
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
      maxRetries: 1,
    });

    // Structured logging for observability
    console.log(JSON.stringify({
      event: "runway_bot_request",
      user: displayName,
      slackUserId,
      isThread: !!threadTs,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      stepCount: result.steps.length,
    }));

    for (const step of result.steps) {
      for (const call of step.toolCalls) {
        console.log(JSON.stringify({
          event: "runway_bot_tool_call",
          tool: call.toolName,
          input: call.input,
        }));
      }
      if (step.toolResults) {
        for (const res of step.toolResults) {
          console.log(JSON.stringify({
            event: "runway_bot_tool_result",
            tool: res.toolName,
            output: typeof res.output === "string" ? res.output : JSON.stringify(res.output),
          }));
        }
      }
    }

    const replyTs = threadTs ?? messageTs;

    await slack.chat.postMessage({
      channel: channelId,
      text: result.text,
      thread_ts: replyTs,
    });

    // Proactive follow-up: only on first message (not thread replies), for account leads
    if (!threadTs) {
      try {
        await handleProactiveFollowUp(result, teamMemberRecord, channelId, replyTs, displayName);
      } catch (err) {
        console.error(JSON.stringify({
          event: "runway_bot_proactive_error",
          user: displayName,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    }
  } catch (err) {
    console.error(JSON.stringify({
      event: "runway_bot_error",
      user: displayName,
      error: err instanceof Error ? err.message : String(err),
    }));
    await slack.chat.postMessage({
      channel: channelId,
      text: "Something went wrong processing your message. Try again or check with the team.",
      thread_ts: threadTs ?? messageTs,
    });
  }
}
