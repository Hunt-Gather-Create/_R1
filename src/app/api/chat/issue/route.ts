import { z } from "zod";
import { type UIMessage } from "ai";
import { createTool, createChatResponse, getPriorityLabel } from "@/lib/chat";
import type { WorkspacePurpose } from "@/lib/design-tokens";

export const maxDuration = 30;

interface IssueContext {
  title: string;
  description: string | null;
  status: string;
  priority: number;
  comments: Array<{ body: string }>;
}

function buildSystemPrompt(
  issueContext: IssueContext,
  purpose: WorkspacePurpose
): string {
  const commentsText =
    issueContext.comments.length > 0
      ? `User comments on this issue:\n${issueContext.comments.map((c) => `- ${c.body}`).join("\n")}`
      : "No comments yet.";

  const purposeGuidance =
    purpose === "marketing"
      ? `Your job is to help the user:
1. Define clear campaign objectives and target audience
2. Clarify deliverables and creative requirements
3. Add success metrics and KPIs
4. Structure the description with timeline and milestones

Focus on marketing best practices: audience targeting, messaging, channels, and measurable outcomes.`
      : `Your job is to help the user:
1. Refine acceptance criteria and requirements
2. Clarify ambiguous parts of the issue
3. Improve the description with better structure
4. Suggest technical approaches when asked

Focus on software best practices: user stories, edge cases, testing criteria, and technical specifications.`;

  return `You are helping refine an existing ${purpose === "marketing" ? "marketing task" : "issue"} in a kanban board. Here's the current item:

Title: ${issueContext.title}
Description: ${issueContext.description || "(No description yet)"}
Status: ${issueContext.status}
Priority: ${getPriorityLabel(issueContext.priority)}

${commentsText}

${purposeGuidance}

When the user is happy with the refined description, use the updateDescription tool to update the ${purpose === "marketing" ? "task" : "issue"}.

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
  const { messages, issueContext, workspacePurpose } = (await req.json()) as {
    messages: UIMessage[];
    issueContext: IssueContext;
    workspacePurpose?: WorkspacePurpose;
  };

  return createChatResponse(messages, {
    system: buildSystemPrompt(issueContext, workspacePurpose ?? "software"),
    tools,
  });
}
