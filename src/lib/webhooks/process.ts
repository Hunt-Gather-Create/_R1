import { anthropic } from "@ai-sdk/anthropic";
import { generateText, tool } from "ai";
import { z } from "zod";
import { recordTokenUsage } from "@/lib/token-usage";

const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You are a webhook data processor. Your job is to extract structured issue data from incoming webhook payloads.

You will receive:
1. User instructions describing how to interpret the data
2. The raw webhook payload as JSON

Your task:
- Read the instructions and data carefully
- Extract the best title, description, status, priority, and labels for creating a project issue
- You MUST call the create_issue tool with your extracted fields
- Be concise — the title should be a short summary, the description can have more detail

Field guidelines:
- title: Short, actionable summary (required)
- description: Longer explanation with relevant details from the payload (optional)
- status: One of "backlog", "todo", "in_progress", "done", "canceled" (optional)
- priority: 0=urgent, 1=high, 2=medium, 3=low, 4=none (optional)
- labels: Array of label names that match the workspace's existing labels (optional)

CRITICAL: You MUST call the create_issue tool with your findings.`;

const createIssueSchema = z.object({
  title: z.string().describe("Short, actionable issue title"),
  description: z
    .string()
    .optional()
    .describe("Longer description with relevant context"),
  status: z
    .enum(["backlog", "todo", "in_progress", "done", "canceled"])
    .optional()
    .describe("Issue status"),
  priority: z
    .number()
    .int()
    .min(0)
    .max(4)
    .optional()
    .describe("Priority: 0=urgent, 1=high, 2=medium, 3=low, 4=none"),
  labels: z
    .array(z.string())
    .optional()
    .describe("Label names to apply"),
});

export interface ProcessedIssueData {
  title: string;
  description?: string;
  status?: string;
  priority?: number;
  labels?: string[];
}

/**
 * Use AI to process incoming webhook data into structured issue fields.
 */
export async function processWebhookData(params: {
  prompt: string;
  data: unknown;
  workspaceId: string;
}): Promise<ProcessedIssueData> {
  const { prompt, data, workspaceId } = params;

  const createIssueTool = tool({
    description:
      "Create an issue from the extracted webhook data. You MUST call this tool with the extracted fields.",
    inputSchema: createIssueSchema,
    execute: async (input) => input,
  });

  const result = await generateText({
    model: anthropic(MODEL),
    system: SYSTEM_PROMPT,
    prompt: `## Instructions\n\n${prompt}\n\n## Incoming Data\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n\nProcess this data and call the create_issue tool with the extracted fields.`,
    tools: {
      create_issue: createIssueTool,
    },
  });

  // Record token usage (non-blocking)
  const usage = result.usage;
  if (usage) {
    recordTokenUsage({
      workspaceId,
      model: MODEL,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      source: "webhook",
    }).catch(() => {
      // Don't fail the webhook if usage tracking fails
    });
  }

  // Extract the tool result from steps
  for (const step of result.steps) {
    for (const toolResult of step.toolResults) {
      if (toolResult.toolName === "create_issue" && "output" in toolResult) {
        return (toolResult as { output: unknown }).output as ProcessedIssueData;
      }
    }
  }

  // Fallback: use the raw text as title
  const textContent = result.text?.trim();
  return {
    title: textContent || "Webhook issue",
  };
}
