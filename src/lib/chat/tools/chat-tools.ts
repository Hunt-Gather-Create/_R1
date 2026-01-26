import { createTool } from "../index";
import { suggestIssueSchema } from "./schemas";
import type { ToolSet } from "ai";

/**
 * Create tools for the main chat (issue creation)
 */
export function createChatTools(): ToolSet {
  return {
    suggestIssue: createTool({
      description:
        "Suggest issue details to populate the form. Use this when you have gathered enough information from the user.",
      schema: suggestIssueSchema,
      resultMessage: (input) =>
        `Suggested issue: "${input.title}" with priority ${input.priority}`,
    }),
  };
}
