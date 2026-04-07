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
    const { slackUserId, channelId, messageText, messageTs, imageFiles } = event.data;

    // Download images from Slack (requires bot token for private URLs)
    const images = await step.run("download-images", async () => {
      if (!imageFiles?.length) return [];
      const token = process.env.SLACK_BOT_TOKEN;
      if (!token) return [];
      return Promise.all(
        imageFiles.map(async (file: { url: string; mimetype: string }) => {
          const response = await fetch(file.url, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const buffer = await response.arrayBuffer();
          const base64 = Buffer.from(buffer).toString("base64");
          return { mimetype: file.mimetype, base64 };
        })
      );
    });

    await step.run("process-message", async () => {
      await handleDirectMessage(slackUserId, channelId, messageText, messageTs, images);
    });

    return { processed: true };
  }
);
