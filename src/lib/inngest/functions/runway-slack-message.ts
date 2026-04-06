/**
 * Inngest function for durable Slack message processing
 *
 * Webhook receives message -> dispatches to Inngest -> AI processes via tools.
 * This ensures retries on failure and prevents webhook timeouts.
 */

import { inngest } from "../client";
import { handleDirectMessage } from "@/lib/slack/bot";

export const processRunwaySlackMessage = inngest.createFunction(
  {
    id: "runway-slack-message",
    name: "Runway Slack Message",
    retries: 2,
    concurrency: { limit: 3 },
  },
  { event: "runway/slack.message" },
  async ({ event, step }) => {
    const { slackUserId, channelId, messageText, messageTs } = event.data;

    await step.run("process-message", async () => {
      await handleDirectMessage(slackUserId, channelId, messageText, messageTs);
    });

    return { processed: true };
  }
);
