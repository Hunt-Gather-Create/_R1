import { anthropic } from "@ai-sdk/anthropic";
import { streamText, tool, convertToModelMessages } from "ai";
import { z } from "zod";

export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages } = await req.json();

  // Convert UI messages to model messages format
  const modelMessages = await convertToModelMessages(messages);

  const result = streamText({
    model: anthropic("claude-sonnet-4-20250514"),
    system: `You are a helpful assistant that helps users craft better user stories and issues for their kanban board.

Your job is to:
1. Ask clarifying questions to understand what the user wants to build
2. Help them write clear, actionable user stories
3. Suggest appropriate priority levels based on the context
4. When you have enough information, use the suggestIssue tool to populate the form

When writing user stories, follow the format: "As a [user type], I want [goal], so that [benefit]"

Be conversational and helpful. Ask one or two questions at a time to gather context before suggesting an issue.

Priority levels:
- 0 = Urgent (critical bugs, security issues)
- 1 = High (important features, significant bugs)
- 2 = Medium (standard features and improvements)
- 3 = Low (nice-to-haves, minor improvements)
- 4 = No priority (backlog items)`,
    messages: modelMessages,
    tools: {
      suggestIssue: tool({
        description:
          "Suggest issue details to populate the form. Use this when you have gathered enough information from the user.",
        inputSchema: z.object({
          title: z
            .string()
            .describe(
              "A clear, concise title for the issue (max 100 characters)"
            ),
          description: z
            .string()
            .describe(
              "A detailed description, ideally in user story format: As a [user], I want [goal], so that [benefit]"
            ),
          priority: z
            .number()
            .min(0)
            .max(4)
            .describe(
              "Priority level: 0=Urgent, 1=High, 2=Medium, 3=Low, 4=None"
            ),
        }),
      }),
    },
  });

  return result.toUIMessageStreamResponse();
}
