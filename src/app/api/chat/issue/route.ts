import { type UIMessage } from "ai";
import {
  createChatResponse,
  createIssueTools,
  loadSkillsForPurpose,
  loadSkillsForWorkspace,
  getPriorityLabel,
} from "@/lib/chat";
import type { WorkspacePurpose } from "@/lib/design-tokens";
import type { WorkspaceSoul } from "@/lib/types";
import { buildSoulSystemPrompt, getWorkspaceSoul } from "@/lib/soul-utils";

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
  purpose: WorkspacePurpose,
  soul: WorkspaceSoul | null
): string {
  const commentsText =
    issueContext.comments.length > 0
      ? `User comments on this issue:\n${issueContext.comments.map((c) => `- ${c.body}`).join("\n")}`
      : "No comments yet.";

  const purposeGuidance =
    purpose === "marketing"
      ? `Focus on marketing best practices: audience targeting, messaging, channels, and measurable outcomes.`
      : `Focus on software best practices: user stories, edge cases, testing criteria, and technical specifications.`;

  const basePrompt = `You are helping refine an existing ${purpose === "marketing" ? "marketing task" : "issue"} in a kanban board. Here's the current item:

Title: ${issueContext.title}
Description: ${issueContext.description || "(No description yet)"}
Status: ${issueContext.status}
Priority: ${getPriorityLabel(issueContext.priority)}

${commentsText}

${purposeGuidance}

## Your Role

You help the user by:
1. Understanding what they want to accomplish
2. Breaking down work into actionable AI subtasks
3. Refining the issue description when asked

## CRITICAL: Suggest Subtasks, Don't Execute

When the user asks you to do something (research, write content, analyze, create, etc.):

1. **DO NOT perform the work yourself** - don't use web search, code execution, or web fetch to actually do the task
2. **Instead, use suggestAITasks** to create subtasks that can be executed later
3. Each subtask should be a single, focused, actionable piece of work
4. Only perform work yourself if the user EXPLICITLY says "do it now", "execute this", "run it", or similar

Example - User says "Help me with SEO for this blog post":
- WRONG: Immediately searching the web and writing SEO recommendations
- RIGHT: Call suggestAITasks with subtasks like:
  - "Research target keywords for [topic]"
  - "Analyze competitor content ranking for similar topics"
  - "Generate meta description and title tag suggestions"
  - "Create internal linking recommendations"

## Rules for Subtask Suggestions

- **Be eager** to suggest subtasks - when you see work that can be done, suggest it
- **Keep it minimal** - suggest 2-5 subtasks MAX. Combine related work into single tasks
- **Independent & parallel** - each subtask MUST be executable independently, without waiting for other subtasks
- **Set priority** - assign appropriate priority (0=Urgent, 1=High, 2=Medium, 3=Low, 4=None)
- **Never include timelines** - no "Week 1-2", "Day 1", "Phase 1" etc. Just the task itself
- **Keep titles concise** - under 60 characters, action-oriented (e.g., "Research X", "Write Y", "Analyze Z")
- **Consolidate related work** - don't create separate subtasks for things that should be done together
- **Include toolsRequired** when relevant (e.g., ["web_search"], ["code_execution"])

Example of BAD suggestions (dependent, sequential):
- "Research keywords" (priority 2)
- "Write content based on keyword research" (depends on previous!)
- "Optimize content for SEO" (depends on previous!)

Example of GOOD suggestions (independent, parallel):
- "Research and analyze target keywords" (priority 2)
- "Audit existing content for optimization opportunities" (priority 2)
- "Research competitor SEO strategies" (priority 3)

## Description Updates

${issueContext.description ? `This issue already has a description. **Ask the user before updating it** - say something like "Should I update the description to reflect this?"` : `This issue has no description yet. **Eagerly update the description** once you understand what the user wants to accomplish. Write a clear, concise description that captures the goal and any key requirements discussed.`}

## Available Tools

- **suggestAITasks**: Create subtasks that appear for user to add (USE THIS FIRST)
- **updateDescription**: Update the issue description${issueContext.description ? " (ask user first since one exists)" : " (use eagerly since none exists)"}
- **attachContent**: Attach generated content as a file (only when explicitly asked to create something NOW)
- Web search, code execution, web fetch: Only use when user explicitly asks you to execute immediately

Be conversational and helpful. Ask clarifying questions when needed.`;

  // If a soul/persona is configured, prepend it to the system prompt
  if (soul && soul.name) {
    const soulPrompt = buildSoulSystemPrompt(soul);
    return `${soulPrompt}\n\n---\n\n${basePrompt}`;
  }

  return basePrompt;
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

  // Load workspace soul/persona
  const soul = await getWorkspaceSoul(workspaceId);

  // Load skills - use workspace skills if workspaceId provided, otherwise just purpose-based
  const skills = workspaceId
    ? await loadSkillsForWorkspace(workspaceId, purpose)
    : await loadSkillsForPurpose(purpose);

  // Create tools with issue context
  const tools = createIssueTools({ issueId: issueContext.id });

  return createChatResponse(messages, {
    system: buildSystemPrompt(issueContext, purpose, soul),
    tools,
    builtInTools: {
      webSearch: true,
      codeExecution: true,
      webFetch: true,
    },
    skills,
    workspaceId,
    usageSource: "issue",
  });
}
