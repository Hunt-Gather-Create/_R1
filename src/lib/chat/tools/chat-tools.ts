import { createTool } from "../index";
import { suggestIssueSchema, suggestSubtasksSchema } from "./schemas";
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
    suggestSubtasks: createTool({
      description:
        "Manage subtasks for the issue. By default replaceExisting=true, which replaces ALL existing subtasks with the ones you provide. To remove subtasks, only include the ones that should remain. To update a subtask, include the updated version. To add without removing, set replaceExisting=false.",
      schema: suggestSubtasksSchema,
      resultMessage: (input) =>
        `${input.replaceExisting === false ? "Added" : "Set"} ${input.subtasks.length} subtask${input.subtasks.length !== 1 ? "s" : ""}`,
    }),
  };
}
