import { tool } from "ai";
import { createTool } from "../index";
import { updateDescriptionSchema, attachContentSchema } from "./schemas";
import { attachContentToIssue } from "@/lib/actions/attachments";
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
  };
}
