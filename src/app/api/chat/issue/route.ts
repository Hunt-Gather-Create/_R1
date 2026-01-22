import { z } from "zod";
import { type UIMessage } from "ai";
import { createTool, createChatResponse, getPriorityLabel } from "@/lib/chat";

export const maxDuration = 30;

interface IssueContext {
  title: string;
  description: string | null;
  status: string;
  priority: number;
  comments: Array<{ body: string }>;
}

function buildSystemPrompt(issueContext: IssueContext): string {
  const commentsText =
    issueContext.comments.length > 0
      ? `User comments on this issue:\n${issueContext.comments.map((c) => `- ${c.body}`).join("\n")}`
      : "No comments yet.";

  return `You are helping refine an existing issue in a kanban board. Here's the current issue:

Title: ${issueContext.title}
Description: ${issueContext.description || "(No description yet)"}
Status: ${issueContext.status}
Priority: ${getPriorityLabel(issueContext.priority)}

${commentsText}

Your job is to help the user:
1. Refine acceptance criteria and requirements
2. Clarify ambiguous parts of the issue
3. Improve the description with better structure
4. Suggest technical approaches when asked

When the user is happy with the refined description, use the updateDescription tool to update the issue.

Be conversational and helpful. Ask clarifying questions when needed. When suggesting a description update, explain what changes you're making and why.`;
}

const updateDescriptionSchema = z.object({
  description: z
    .string()
    .describe(
      "The updated description with acceptance criteria, user stories, or improved requirements"
    ),
});

const tools = {
  updateDescription: createTool({
    description:
      "Update the issue description with refined content. Use this when you have a clear, improved description ready.",
    schema: updateDescriptionSchema,
    resultMessage: (input) =>
      `Description updated to: "${input.description.substring(0, 50)}..."`,
  }),
};

export async function POST(req: Request) {
  const { messages, issueContext } = (await req.json()) as {
    messages: UIMessage[];
    issueContext: IssueContext;
  };

  return createChatResponse(messages, {
    system: buildSystemPrompt(issueContext),
    tools,
  });
}
