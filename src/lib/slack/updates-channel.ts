/**
 * Updates channel — formatted log posts for Runway changes
 *
 * Format (from brain spec):
 * **Convergix**
 * _Project:_ CDS Messaging & Pillars
 * _Update:_ In Production -> Sent to Client (R1 delivered to Daniel)
 * _Updated by:_ 🟢 Kathy Horn, Apr. 5 2026 at 10:14 AM
 *
 * 🟢 = Civilization employee
 * 🔵 = Client contact (when mentioned)
 * No AI voice. No em dashes. Clean, factual, scannable.
 */

import { getSlackClient, getUpdatesChannelId } from "./client";
import { MONTH_NAMES_SHORT } from "@/lib/runway/date-constants";

interface UpdatePost {
  clientName: string;
  projectName?: string;
  updateText: string;
  updatedBy: string;
}

/**
 * Format a timestamp for the updates channel.
 * Example: "Apr. 5 2026 at 10:14 AM"
 */
export function formatTimestamp(date: Date): string {
  const month = MONTH_NAMES_SHORT[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();
  const hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 || 12;

  return `${month} ${day} ${year} at ${hour12}:${minutes} ${ampm}`;
}

/**
 * Post a formatted update to the updates channel.
 * One message per update, not grouped.
 */
export async function postUpdate(update: UpdatePost): Promise<string | undefined> {
  const slack = getSlackClient();
  const channelId = getUpdatesChannelId();

  const lines: string[] = [];
  lines.push(`*${update.clientName}*`);

  if (update.projectName) {
    lines.push(`_Project:_ ${update.projectName}`);
  }

  lines.push(`_Update:_ ${update.updateText}`);
  lines.push(`_Updated by:_ 🟢 ${update.updatedBy}, ${formatTimestamp(new Date())}`);

  const result = await slack.chat.postMessage({
    channel: channelId,
    text: lines.join("\n"),
    unfurl_links: false,
    unfurl_media: false,
  });

  return result.ts;
}
