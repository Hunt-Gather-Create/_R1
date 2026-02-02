import { tool } from "ai";
import { createTool } from "../index";
import {
  updateDescriptionSchema,
  attachContentSchema,
  suggestAITasksSchema,
} from "./schemas";
import { attachContentToIssue } from "@/lib/actions/attachments";
import { addAISuggestions } from "@/lib/actions/ai-suggestions";
import type { ToolSet } from "ai";

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
  };
}
