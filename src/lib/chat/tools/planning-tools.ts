import { createTool } from "../index";
import { planIssueSchema, summarizeEpicSchema } from "./schemas";
import type { ToolSet } from "ai";

/**
 * Create tools for the planning chat
 */
export function createPlanningTools(): ToolSet {
  return {
    planIssue: createTool({
      description:
        "Add an issue to the planning list. Use this when you have gathered enough requirements for a specific piece of work.",
      schema: planIssueSchema,
      resultMessage: (input) => `Added "${input.title}" to the plan`,
    }),
    summarizeEpic: createTool({
      description:
        "Summarize the planning session into an epic. Call this ONCE after creating all issues.",
      schema: summarizeEpicSchema,
      resultMessage: (input) => `Epic summary: "${input.title}"`,
    }),
  };
}
