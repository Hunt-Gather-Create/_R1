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
    // Issue #35: Slack `messageTs` is unique per user message. Dedupe at the
    // queue layer so a webhook retry, network double-dispatch, or an Inngest
    // retry after partial success does not re-run the AI turn and post a
    // duplicate `chat.postMessage`. Second invocation with the same
    // messageTs becomes a queue-level no-op.
    idempotency: "event.data.messageTs",
  },
  { event: "runway/slack.message" },
  async ({ event, step }) => {
    const { slackUserId, channelId, messageText, messageTs, threadTs, imageFiles } = event.data;

    // Download images from Slack (requires bot token for private URLs)
    const images = await step.run("download-images", async () => {
      if (!imageFiles?.length) return [];
      const token = process.env.SLACK_BOT_TOKEN;
      if (!token) return [];
      const results = await Promise.allSettled(
        imageFiles.map(async (file: { url: string; mimetype: string }) => {
          const response = await fetch(file.url, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!response.ok) {
            throw new Error(`Slack returned ${response.status} for image download`);
          }
          const buffer = await response.arrayBuffer();
          const base64 = Buffer.from(buffer).toString("base64");
          return { mimetype: file.mimetype, base64 };
        })
      );
      return results
        .filter((r): r is PromiseFulfilledResult<{ mimetype: string; base64: string }> =>
          r.status === "fulfilled"
        )
        .map((r) => r.value);
    });

    await step.run("process-message", async () => {
      await handleDirectMessage(slackUserId, channelId, messageText, messageTs, threadTs, images);
    });

    return { processed: true };
  }
);
