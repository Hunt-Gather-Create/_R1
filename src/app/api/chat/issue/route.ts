import { type UIMessage } from "ai";
import {
  createChatResponse,
  createIssueTools,
  loadSkillsForPurpose,
  loadSkillsForWorkspace,
  getPriorityLabel,
} from "@/lib/chat";
import type { WorkspacePurpose } from "@/lib/design-tokens";

export const maxDuration = 30;

interface IssueContext {
  id: string;
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

Focus on marketing best practices: audience targeting, messaging, channels, and measurable outcomes.

**Available tools:**
- Web search: Research competitors, trends, best practices
- Code execution: Run calculations, analyze data
- Web fetch: Read documentation from URLs`
      : `Your job is to help the user:
1. Refine acceptance criteria and requirements
2. Clarify ambiguous parts of the issue
3. Improve the description with better structure
4. Suggest technical approaches when asked

Focus on software best practices: user stories, edge cases, testing criteria, and technical specifications.

**Available tools:**
- Web search: Research related technologies, APIs, or best practices
- Code execution: Generate example code or analyze technical approaches
- Web fetch: Read documentation from URLs`;

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

export async function POST(req: Request) {
  const { messages, issueContext, workspacePurpose, workspaceId } =
    (await req.json()) as {
      messages: UIMessage[];
      issueContext: IssueContext;
      workspacePurpose?: WorkspacePurpose;
      workspaceId?: string;
    };

  const purpose = workspacePurpose ?? "software";

  // Load skills - use workspace skills if workspaceId provided, otherwise just purpose-based
  const skills = workspaceId
    ? await loadSkillsForWorkspace(workspaceId, purpose)
    : await loadSkillsForPurpose(purpose);

  // Create tools with issue context
  const tools = createIssueTools({ issueId: issueContext.id });

  return createChatResponse(messages, {
    system: buildSystemPrompt(issueContext, purpose),
    tools,
    builtInTools: {
      webSearch: true,
      codeExecution: true,
      webFetch: true,
    },
    skills,
    workspaceId,
  });
}
