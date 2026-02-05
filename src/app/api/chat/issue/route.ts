import { type UIMessage } from "ai";
import {
  createChatResponse,
  createIssueTools,
  createMemoryTools,
  loadSkillsForPurpose,
  loadSkillsForWorkspace,
  getPriorityLabel,
  buildContextualSystemPrompt,
  SUBTASK_INDEPENDENCE_GUIDELINES,
} from "@/lib/chat";
import type { WorkspacePurpose } from "@/lib/design-tokens";
import type { WorkspaceSoul, Brand, WorkspaceMemory } from "@/lib/types";
import { loadWorkspaceContext } from "@/lib/brand-utils";
import { getLastUserMessageText } from "@/lib/memory-utils";

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
  soul: WorkspaceSoul | null,
  brand: Brand | null,
  memories: WorkspaceMemory[] = []
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

${SUBTASK_INDEPENDENCE_GUIDELINES}

### Additional Guidelines for Issue Refinement

- **Be eager** to suggest subtasks - when you see work that can be done, suggest it
- **Set priority** - assign appropriate priority (0=Urgent, 1=High, 2=Medium, 3=Low, 4=None)
- **Include toolsRequired** when relevant (e.g., ["web_search"], ["code_execution"])
- **Fix existing subtasks** - if existing subtasks are sequential/dependent, delete and replace them

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

  return buildContextualSystemPrompt(basePrompt, soul, brand, memories);
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

  // Extract last user message for memory search
  const lastUserMessage = getLastUserMessageText(messages);

  // Load workspace context (soul, brand, and memories) in parallel
  const { soul, brand, memories } = await loadWorkspaceContext(workspaceId, lastUserMessage);

  // Load skills - use workspace skills if workspaceId provided, otherwise just purpose-based
  const skills = workspaceId
    ? await loadSkillsForWorkspace(workspaceId, purpose)
    : await loadSkillsForPurpose(purpose);

  // Create tools with issue context and memory tools
  const issueTools = createIssueTools({ issueId: issueContext.id });
  const memoryTools = workspaceId ? createMemoryTools({ workspaceId }) : {};
  const tools = { ...issueTools, ...memoryTools };

  return createChatResponse(messages, {
    system: buildSystemPrompt(issueContext, purpose, soul, brand, memories),
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
