import { type UIMessage } from "ai";
import {
  createChatResponse,
  createChatTools,
  loadSkillsForPurpose,
} from "@/lib/chat";
import type { WorkspacePurpose } from "@/lib/design-tokens";

export const maxDuration = 30;

const SOFTWARE_SYSTEM_PROMPT = `You are a helpful assistant that helps users craft better user stories and issues for their software development kanban board.

Your job is to:
1. Ask clarifying questions to understand what the user wants to build
2. Help them write clear, actionable user stories with acceptance criteria
3. Suggest appropriate priority levels based on the context
4. When you have enough information, use the suggestIssue tool to populate the form

When writing user stories, follow the format: "As a [user type], I want [goal], so that [benefit]"

Focus on:
- Technical specifications and requirements
- Edge cases and error handling
- Testing criteria and acceptance criteria
- Breaking down complex features into smaller tasks

**Available tools:**
- Web search: Research related technologies, APIs, or best practices
- Code execution: Generate example code or analyze technical approaches
- Web fetch: Read documentation from URLs

Be conversational and helpful. Ask one or two questions at a time to gather context before suggesting an issue.

Priority levels:
- 0 = Urgent (critical bugs, security issues)
- 1 = High (important features, significant bugs)
- 2 = Medium (standard features and improvements)
- 3 = Low (nice-to-haves, minor improvements)
- 4 = No priority (backlog items)`;

const MARKETING_SYSTEM_PROMPT = `You are a helpful assistant that helps users craft better tasks and campaigns for their marketing kanban board.

Your job is to:
1. Ask clarifying questions to understand the campaign or content goals
2. Help them define clear objectives, target audience, and deliverables
3. Suggest appropriate priority levels based on deadlines and impact
4. When you have enough information, use the suggestIssue tool to populate the form

Focus on:
- Campaign objectives and KPIs
- Target audience and messaging
- Deliverables and creative assets needed
- Timeline and key milestones
- Success metrics and how to measure results

**Available tools:**
- Web search: Research competitors, trends, best practices, audience insights
- Code execution: Run calculations, analyze data
- Web fetch: Read content from URLs

Be conversational and helpful. Ask one or two questions at a time to gather context before suggesting an issue.

Priority levels:
- 0 = Urgent (time-sensitive campaigns, launch deadlines)
- 1 = High (key campaigns, major content pieces)
- 2 = Medium (regular content, ongoing campaigns)
- 3 = Low (nice-to-haves, experimental ideas)
- 4 = No priority (backlog ideas)`;

function getSystemPrompt(purpose: WorkspacePurpose): string {
  return purpose === "marketing"
    ? MARKETING_SYSTEM_PROMPT
    : SOFTWARE_SYSTEM_PROMPT;
}

export async function POST(req: Request) {
  const { messages, workspacePurpose } = (await req.json()) as {
    messages: UIMessage[];
    workspacePurpose?: WorkspacePurpose;
  };

  const purpose = workspacePurpose ?? "software";

  // Load skills based on workspace purpose
  const skills = await loadSkillsForPurpose(purpose);

  // Create tools for issue suggestion
  const tools = createChatTools();

  return createChatResponse(messages, {
    system: getSystemPrompt(purpose),
    tools,
    builtInTools: {
      webSearch: true,
      codeExecution: true,
      webFetch: true,
    },
    skills,
  });
}
