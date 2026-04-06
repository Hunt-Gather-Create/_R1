/**
 * Slack Web API client — singleton for Runway bot
 *
 * Used by the bot to post messages (confirmations + updates channel).
 * Requires SLACK_BOT_TOKEN env var.
 */

import { WebClient } from "@slack/web-api";

let _client: WebClient | null = null;

export function getSlackClient(): WebClient {
  if (!_client) {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) {
      throw new Error("SLACK_BOT_TOKEN is not configured");
    }
    _client = new WebClient(token);
  }
  return _client;
}

/**
 * Get the updates channel ID from env.
 * This is where formatted update logs are posted.
 */
export function getUpdatesChannelId(): string {
  const channelId = process.env.SLACK_UPDATES_CHANNEL_ID;
  if (!channelId) {
    throw new Error("SLACK_UPDATES_CHANNEL_ID is not configured");
  }
  return channelId;
}
