import type { UIMessage } from "@ai-sdk/react";

/**
 * Parses message content that may be stored as JSON parts array or plain text.
 * Used for loading persisted chat messages back into UI format.
 *
 * @param content - The stored message content (JSON parts array or plain text)
 * @returns Array of message parts
 */
export function parseMessageParts(content: string): UIMessage["parts"] {
  // Try to parse as JSON parts array (new format)
  if (content.startsWith("[")) {
    try {
      const parts = JSON.parse(content);
      if (Array.isArray(parts) && parts.length > 0) {
        return parts;
      }
    } catch {
      // Not valid JSON, fall through to text format
    }
  }

  // Legacy format: plain text
  return [{ type: "text" as const, text: content }];
}

/**
 * Serializes message parts for storage.
 * Preserves tool calls and all part types.
 *
 * @param parts - The message parts to serialize
 * @returns JSON string of parts array
 */
export function serializeMessageParts(parts: UIMessage["parts"]): string {
  return JSON.stringify(parts);
}

/**
 * Generic converter for persisted messages to UI format.
 * Works with any message type that has id, role, and content fields.
 */
export function createUIMessage<T extends { id: string; role: string; content: string }>(
  msg: T
): UIMessage {
  return {
    id: msg.id,
    role: msg.role as "user" | "assistant",
    parts: parseMessageParts(msg.content),
  };
}

/**
 * Converts an array of persisted messages to UI messages.
 */
export function persistedToUIMessagesBase<T extends { id: string; role: string; content: string }>(
  messages: T[]
): UIMessage[] {
  return messages.map(createUIMessage);
}
