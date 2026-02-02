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

interface SubtaskContext {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number;
  status: string;
  aiAssignable: boolean;
}

interface IssueContext {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  comments: Array<{ body: string }>;
  subtasks?: SubtaskContext[];
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

  const subtasks = issueContext.subtasks || [];
  const subtasksText =
    subtasks.length > 0
      ? `Current subtasks:\n${subtasks.map((s) => `- [${s.identifier}] "${s.title}" (ID: ${s.id}, Priority: ${getPriorityLabel(s.priority)}, Status: ${s.status}${s.aiAssignable ? ", AI Task" : ""})`).join("\n")}`
      : "No subtasks yet.";

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

${subtasksText}

${purposeGuidance}

## Your Role

You help the user by:
1. Understanding what they want to accomplish
2. Breaking down work into actionable AI subtasks
3. Managing existing subtasks (update or delete as needed)
4. Refining the issue description when asked

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

## Managing Existing Subtasks

When there are existing subtasks, you can and SHOULD:
- **Delete subtasks** that are redundant, poorly structured, or need to be replaced
- **Update subtasks** to fix issues (e.g., make them independent instead of sequential)
- **Replace subtasks** by deleting old ones and suggesting better alternatives

If the user asks for new subtasks and the existing ones have issues (e.g., they're sequential/dependent instead of parallel), DELETE the problematic subtasks and suggest new ones that are properly independent.

## Rules for Subtask Suggestions

### CRITICAL: Subtasks Must Be Fully Independent

Each subtask is executed **in complete isolation** by a separate AI agent that has NO access to the results of other subtasks. This means:

- A subtask CANNOT use output from another subtask
- A subtask CANNOT "build on" or "continue" work from another subtask
- A subtask CANNOT reference "the research" or "the analysis" from a sibling task
- Each subtask must be self-contained with all context needed to complete it

If you find yourself thinking "this task needs the results from that task", you MUST either:
1. Combine them into a single subtask, OR
2. Restructure so each task gathers its own data independently

### Other Guidelines

- **Be eager** to suggest subtasks - when you see work that can be done, suggest it
- **Keep it minimal** - suggest 2-5 subtasks MAX. Combine related work into single tasks
- **Set priority** - assign appropriate priority (0=Urgent, 1=High, 2=Medium, 3=Low, 4=None)
- **Never include timelines** - no "Week 1-2", "Day 1", "Phase 1" etc. Just the task itself
- **Keep titles concise** - under 60 characters, action-oriented (e.g., "Research X", "Write Y", "Analyze Z")
- **Consolidate related work** - don't create separate subtasks for things that should be done together
- **Include toolsRequired** when relevant (e.g., ["web_search"], ["code_execution"])
- **Fix existing subtasks** - if existing subtasks are sequential/dependent, delete and replace them

### Examples

**BAD** (dependent - task 2 needs task 1's output):
- "Research keywords for the topic"
- "Write content using the researched keywords" ❌ Depends on task 1!
- "Optimize the written content for SEO" ❌ Depends on task 2!

**GOOD** (independent - each task is self-contained):
- "Research target keywords and create keyword strategy document"
- "Audit existing site content for SEO optimization opportunities"
- "Analyze top 3 competitor articles for content patterns"

Each good task can run in parallel because it gathers its own data and produces its own output.

## Description Updates

${issueContext.description ? `This issue already has a description. **Ask the user before updating it** - say something like "Should I update the description to reflect this?"` : `This issue has no description yet. **Eagerly update the description** once you understand what the user wants to accomplish. Write a clear, concise description that captures the goal and any key requirements discussed.`}

## Available Tools

- **suggestAITasks**: Create new subtasks that appear for user to add
- **updateSubtask**: Update an existing subtask (title, description, priority) - use subtask ID from the list above
- **deleteSubtask**: Delete an existing subtask - use this to remove redundant or poorly-structured subtasks
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
