import type { UIMessage } from "@ai-sdk/react";
import type { WorkspaceChatMessage, WorkspaceChatAttachment } from "@/lib/types";

// Attachment placeholder pattern: [attachment:uuid]
const ATTACHMENT_PLACEHOLDER_PATTERN = /\[attachment:([a-f0-9-]+)\]/g;

/**
 * Creates a file attachment text part for rendering in the UI.
 *
 * IMPORTANT: We use type "text" (not a custom type) to ensure the SDK
 * properly handles these messages when sending to the API. Using custom
 * types like "file-attachment" caused issues where the API received
 * malformed tool_use/tool_result structures.
 *
 * The UI component (ChatMessage) checks for the __attachment metadata
 * to render these as file cards instead of plain text.
 */
export function createAttachmentPart(attachment: WorkspaceChatAttachment) {
  return {
    type: "text",
    text: `📎 ${attachment.filename}`,
    // Metadata for UI rendering - the ChatMessage component uses this
    // to render a file card instead of plain text
    __attachment: {
      id: attachment.id,
      filename: attachment.filename,
      size: attachment.size,
    },
  } as unknown as UIMessage["parts"][number];
}

/**
 * Converts persisted messages (from database) to UI message format.
 * Supports two formats:
 * 1. JSON array of parts (new format) - preserves tool calls and all part types
 * 2. Plain text with attachment placeholders (legacy format) - backward compatible
 */
export function persistedToUIMessages(
  persisted: (WorkspaceChatMessage & { attachments: WorkspaceChatAttachment[] })[]
): UIMessage[] {
  return persisted.map((msg) => {
    // Create a map of attachments by ID for quick lookup
    const attachmentMap = new Map(msg.attachments.map((a) => [a.id, a]));

    // Try to parse content as JSON parts array (new format)
    if (msg.content.startsWith("[")) {
      try {
        const parsedParts = JSON.parse(msg.content) as UIMessage["parts"];
        if (Array.isArray(parsedParts) && parsedParts.length > 0) {
          // Process parts to restore attachment metadata from database
          const parts = parsedParts.map((part) => {
            // Handle tool-createFile parts - restore attachment info from database
            if (
              part.type?.startsWith("tool-createFile") &&
              (part as unknown as { state: string }).state === "output-available"
            ) {
              const output = (part as unknown as { output?: { attachmentId?: string } }).output;
              if (output?.attachmentId) {
                const attachment = attachmentMap.get(output.attachmentId);
                if (attachment) {
                  return createAttachmentPart(attachment);
                }
              }
            }
            return part;
          });

          return {
            id: msg.id,
            role: msg.role as "user" | "assistant",
            parts,
          };
        }
      } catch {
        // Not valid JSON, fall through to legacy parsing
      }
    }

    // Legacy format: plain text with optional [attachment:id] placeholders
    const parts: UIMessage["parts"] = [];

    // Check if content has attachment placeholders (use fresh regex each time)
    const hasPlaceholders =
      msg.role === "assistant" && /\[attachment:[a-f0-9-]+\]/.test(msg.content);

    if (hasPlaceholders) {
      // Split content by placeholders and reconstruct parts in order
      let lastIndex = 0;
      // Create fresh regex for each message to avoid lastIndex issues
      const regex = new RegExp(ATTACHMENT_PLACEHOLDER_PATTERN.source, "g");
      let match;

      while ((match = regex.exec(msg.content)) !== null) {
        // Add text before this placeholder
        const textBefore = msg.content.slice(lastIndex, match.index).trim();
        if (textBefore) {
          parts.push({ type: "text" as const, text: textBefore });
        }

        // Add the attachment part
        const attachmentId = match[1];
        const attachment = attachmentMap.get(attachmentId);
        if (attachment) {
          parts.push(createAttachmentPart(attachment));
          attachmentMap.delete(attachmentId);
        }

        lastIndex = match.index + match[0].length;
      }

      // Add any remaining text after the last placeholder
      const textAfter = msg.content.slice(lastIndex).trim();
      if (textAfter) {
        parts.push({ type: "text" as const, text: textAfter });
      }

      // Add any attachments that weren't in placeholders (fallback)
      for (const attachment of attachmentMap.values()) {
        parts.push(createAttachmentPart(attachment));
      }
    } else {
      // No placeholders - just add text and attachments at end
      if (msg.content) {
        parts.push({ type: "text" as const, text: msg.content });
      }

      for (const attachment of msg.attachments) {
        parts.push(createAttachmentPart(attachment));
      }
    }

    // Ensure at least one part exists
    if (parts.length === 0) {
      parts.push({ type: "text" as const, text: "" });
    }

    return {
      id: msg.id,
      role: msg.role as "user" | "assistant",
      parts,
    };
  });
}

/**
 * Groups chats by date categories: Today, Yesterday, Last 7 days, Older
 */
export function groupChatsByDate<T extends { updatedAt?: Date | null; createdAt?: Date | null }>(
  chats: T[]
): { label: string; chats: T[] }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

  const groups: { label: string; chats: T[] }[] = [
    { label: "Today", chats: [] },
    { label: "Yesterday", chats: [] },
    { label: "Last 7 days", chats: [] },
    { label: "Older", chats: [] },
  ];

  for (const chat of chats) {
    const chatDate = chat.updatedAt
      ? new Date(chat.updatedAt)
      : new Date(chat.createdAt ?? 0);
    if (chatDate >= today) {
      groups[0].chats.push(chat);
    } else if (chatDate >= yesterday) {
      groups[1].chats.push(chat);
    } else if (chatDate >= lastWeek) {
      groups[2].chats.push(chat);
    } else {
      groups[3].chats.push(chat);
    }
  }

  return groups.filter((group) => group.chats.length > 0);
}

/**
 * Formats file size in human-readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
