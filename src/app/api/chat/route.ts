import { z } from "zod";
import { type UIMessage } from "ai";
import { createTool, createChatResponse } from "@/lib/chat";

export const maxDuration = 30;

const SYSTEM_PROMPT = `You are a helpful assistant that helps users craft better user stories and issues for their kanban board.

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
- 4 = No priority (backlog items)`;

const suggestIssueSchema = z.object({
  title: z
    .string()
    .describe("A clear, concise title for the issue (max 100 characters)"),
  description: z
    .string()
    .describe(
      "A detailed description, ideally in user story format: As a [user], I want [goal], so that [benefit]"
    ),
  priority: z
    .number()
    .min(0)
    .max(4)
    .describe("Priority level: 0=Urgent, 1=High, 2=Medium, 3=Low, 4=None"),
});

const tools = {
  suggestIssue: createTool({
    description:
      "Suggest issue details to populate the form. Use this when you have gathered enough information from the user.",
    schema: suggestIssueSchema,
    resultMessage: (input) =>
      `Suggested issue: "${input.title}" with priority ${input.priority}`,
  }),
};

export async function POST(req: Request) {
  const { messages } = (await req.json()) as { messages: UIMessage[] };

  return createChatResponse(messages, {
    system: SYSTEM_PROMPT,
    tools,
  });
}
