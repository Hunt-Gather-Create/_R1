/**
 * Utilities for workspace memories - loading, searching, and formatting for prompts.
 */
import type { UIMessage } from "ai";
import type { WorkspaceMemory } from "./types";
import { parseMemoryTags } from "./utils";
import { searchWorkspaceMemories } from "./actions/memories";

/**
 * Load relevant memories for a user message.
 * Extracts keywords from the message and searches for matching memories.
 *
 * @param workspaceId - The workspace to search in
 * @param userMessage - The user's message to extract keywords from
 * @param limit - Maximum number of memories to return (default 5)
 * @returns Array of relevant memories
 */
export async function loadRelevantMemories(
  workspaceId: string | undefined,
  userMessage: string | undefined,
  limit: number = 5
): Promise<WorkspaceMemory[]> {
  if (!workspaceId || !userMessage) {
    return [];
  }

  try {
    const memories = await searchWorkspaceMemories(workspaceId, userMessage, limit);
    return memories;
  } catch {
    // Log but don't fail the chat if memory search fails
    console.error("Failed to load relevant memories");
    return [];
  }
}

/**
 * Build a system prompt section for memories.
 * Formats memories for inclusion in the system prompt.
 *
 * @param memories - Array of workspace memories
 * @returns Formatted string for system prompt, or empty string if no memories
 */
export function buildMemorySystemPrompt(memories: WorkspaceMemory[]): string {
  if (memories.length === 0) {
    return "";
  }

  const memoryLines = memories.map((m) => {
    const tags = parseMemoryTags(m.tags);
    const tagStr = tags.length > 0 ? ` [${tags.join(", ")}]` : "";
    return `- ${m.content}${tagStr}`;
  });

  return `## Workspace Memories
The following are relevant memories from previous conversations in this workspace:

${memoryLines.join("\n")}

Use these memories to provide more personalized and contextual assistance.`;
}

/**
 * Extract the last user message text from a conversation.
 * Used to search for relevant memories.
 *
 * @param messages - Array of chat messages
 * @returns The text content of the last user message, or undefined if none
 */
export function getLastUserMessageText(messages: UIMessage[]): string | undefined {
  // Find the last user message
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user") {
      // Extract text from message parts
      const textParts = msg.parts
        .filter((part): part is { type: "text"; text: string } =>
          part.type === "text" && "text" in part
        )
        .map((part) => part.text);
      if (textParts.length > 0) {
        return textParts.join(" ");
      }
    }
  }
  return undefined;
}
