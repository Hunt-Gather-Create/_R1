import { tool } from "ai";
import { createTool } from "../index";
import {
  updateDescriptionSchema,
  attachContentSchema,
  suggestAITasksSchema,
  updateSubtaskSchema,
  deleteSubtaskSchema,
} from "./schemas";
import { attachContentToIssue } from "@/lib/actions/attachments";
import { addAISuggestions } from "@/lib/actions/ai-suggestions";
import { updateIssue, deleteIssue } from "@/lib/actions/issues";
import type { ToolSet } from "ai";
import type { Priority } from "@/lib/design-tokens";

/**
 * Context needed for issue-specific tools
 */
export interface IssueToolsContext {
  issueId: string;
}

/**
 * Create tools for the issue chat
 * Tools are created dynamically because they need the issue ID
 */
export function createIssueTools(context: IssueToolsContext): ToolSet {
  return {
    updateDescription: createTool({
      description:
        "Update the issue description with refined content. Use this when you have a clear, improved description ready.",
      schema: updateDescriptionSchema,
      resultMessage: (input) =>
        `Description updated to: "${input.description.substring(0, 50)}..."`,
    }),

    attachContent: tool({
      description:
        "Attach generated content (guides, reports, code, analysis) to the issue as a file. Use this when you've created substantial content that should be saved as an attachment for future reference.",
      inputSchema: attachContentSchema,
      execute: async ({
        content,
        filename,
        mimeType,
      }: {
        content: string;
        filename: string;
        mimeType?: string;
      }) => {
        try {
          const attachment = await attachContentToIssue(
            context.issueId,
            content,
            filename,
            mimeType || "text/markdown"
          );
          return `Attached "${attachment.filename}" (${attachment.size} bytes) to the issue.`;
        } catch (error) {
          console.error("[attachContent] Error:", error);
          return `Failed to attach content: ${error instanceof Error ? error.message : "Unknown error"}`;
        }
      },
    }),

    suggestAITasks: tool({
      description:
        "Suggest AI tasks that can be performed for this issue. These appear as 'ghost' subtasks that users can add. Use this to proactively suggest helpful tasks based on the issue context and available tools.",
      inputSchema: suggestAITasksSchema,
      execute: async ({
        suggestions,
      }: {
        suggestions: Array<{
          title: string;
          description?: string;
          priority?: number;
          toolsRequired?: string[];
        }>;
      }) => {
        try {
          if (suggestions.length === 0) {
            return "No suggestions provided.";
          }

          const added = await addAISuggestions(context.issueId, suggestions);
          return `Added ${added.length} AI task suggestion${added.length > 1 ? "s" : ""}: ${added.map((s) => s.title).join(", ")}`;
        } catch (error) {
          console.error("[suggestAITasks] Error:", error);
          return `Failed to add suggestions: ${error instanceof Error ? error.message : "Unknown error"}`;
        }
      },
    }),

    updateSubtask: tool({
      description:
        "Update an existing subtask's title, description, or priority. Use this when the user wants to modify existing subtasks, or when you need to fix subtasks that have issues (e.g., making them independent/parallel instead of sequential).",
      inputSchema: updateSubtaskSchema,
      execute: async ({
        subtaskId,
        title,
        description,
        priority,
      }: {
        subtaskId: string;
        title?: string;
        description?: string;
        priority?: number;
      }) => {
        try {
          const updates: { title?: string; description?: string; priority?: Priority } = {};
          if (title !== undefined) updates.title = title;
          if (description !== undefined) updates.description = description;
          if (priority !== undefined) updates.priority = priority as Priority;

          if (Object.keys(updates).length === 0) {
            return "No updates provided.";
          }

          await updateIssue(subtaskId, updates);
          const changedFields = Object.keys(updates).join(", ");
          return `Updated subtask (${changedFields})${title ? `: "${title}"` : ""}`;
        } catch (error) {
          console.error("[updateSubtask] Error:", error);
          return `Failed to update subtask: ${error instanceof Error ? error.message : "Unknown error"}`;
        }
      },
    }),

    deleteSubtask: tool({
      description:
        "Delete an existing subtask. Use this when a subtask is no longer needed, is redundant, or should be replaced with better alternatives.",
      inputSchema: deleteSubtaskSchema,
      execute: async ({
        subtaskId,
        reason,
      }: {
        subtaskId: string;
        reason?: string;
      }) => {
        try {
          await deleteIssue(subtaskId);
          return `Deleted subtask${reason ? ` (${reason})` : ""}`;
        } catch (error) {
          console.error("[deleteSubtask] Error:", error);
          return `Failed to delete subtask: ${error instanceof Error ? error.message : "Unknown error"}`;
        }
      },
    }),
  };
}
