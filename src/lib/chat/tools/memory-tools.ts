import { tool, type ToolSet } from "ai";
import { z } from "zod";
import {
  storeMemorySchema,
  updateMemorySchema,
  deleteMemorySchema,
} from "./schemas";
import {
  createWorkspaceMemory,
  updateWorkspaceMemory,
  deleteWorkspaceMemory,
  listWorkspaceMemories,
} from "@/lib/actions/memories";

export interface MemoryToolsContext {
  workspaceId: string;
}

/**
 * Create tools for managing workspace memories.
 * These tools allow AI to store, update, and delete memories that persist across chat sessions.
 */
export function createMemoryTools(context: MemoryToolsContext): ToolSet {
  const { workspaceId } = context;

  return {
    store_memory: tool({
      description: `Store a new memory for this workspace. Use this to remember important information the user shares, such as:
- User preferences (e.g., "User prefers dark mode", "User's timezone is PST")
- Workflow patterns (e.g., "User reviews PRs on Mondays")
- Key contacts or team info (e.g., "John is the frontend lead")
- Project context (e.g., "Main product is a B2B SaaS")

IMPORTANT: Before storing a memory, check existing memories with list_memories to avoid duplicates.
If similar content exists, use update_memory instead of creating a duplicate.`,
      inputSchema: storeMemorySchema,
      execute: async (input) => {
        try {
          await createWorkspaceMemory(workspaceId, {
            content: input.content,
            tags: input.tags,
          });
          return `Stored memory with tags: ${input.tags.join(", ")}`;
        } catch (error) {
          console.error("[store_memory] Error:", error);
          return `Failed to store memory: ${error instanceof Error ? error.message : "Unknown error"}`;
        }
      },
    }),

    update_memory: tool({
      description:
        "Update an existing workspace memory. Use this when you need to modify or expand on previously stored information.",
      inputSchema: updateMemorySchema,
      execute: async (input) => {
        try {
          await updateWorkspaceMemory(input.memoryId, {
            content: input.content,
            tags: input.tags,
          });
          return "Memory updated";
        } catch (error) {
          console.error("[update_memory] Error:", error);
          return `Failed to update memory: ${error instanceof Error ? error.message : "Unknown error"}`;
        }
      },
    }),

    delete_memory: tool({
      description:
        "Delete a workspace memory. Use this when information is outdated or no longer relevant.",
      inputSchema: deleteMemorySchema,
      execute: async (input) => {
        try {
          await deleteWorkspaceMemory(input.memoryId);
          return "Memory deleted";
        } catch (error) {
          console.error("[delete_memory] Error:", error);
          return `Failed to delete memory: ${error instanceof Error ? error.message : "Unknown error"}`;
        }
      },
    }),

    list_memories: tool({
      description:
        "List all existing memories for this workspace. Use this to check for duplicates before storing new memories, or to find a memory ID for updating/deleting.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const memories = await listWorkspaceMemories(workspaceId);
          if (memories.length === 0) {
            return "No memories stored yet.";
          }
          return memories
            .map((m) => `[${m.id}] (${m.tags.join(", ")}): ${m.content}`)
            .join("\n");
        } catch (error) {
          console.error("[list_memories] Error:", error);
          return `Failed to list memories: ${error instanceof Error ? error.message : "Unknown error"}`;
        }
      },
    }),
  };
}
