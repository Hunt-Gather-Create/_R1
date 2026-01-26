import { createTool } from "../index";
import { planIssueSchema } from "./schemas";
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
  };
}
