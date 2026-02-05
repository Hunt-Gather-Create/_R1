import { type UIMessage } from "ai";
import {
  createChatResponse,
  createChatTools,
  createMemoryTools,
  loadSkillsForPurpose,
  loadSkillsForWorkspace,
  buildContextualSystemPrompt,
  SUBTASK_INDEPENDENCE_GUIDELINES,
} from "@/lib/chat";
import type { WorkspacePurpose } from "@/lib/design-tokens";
import type { WorkspaceSoul, Brand, WorkspaceMemory } from "@/lib/types";
import { loadWorkspaceContext } from "@/lib/brand-utils";
import { createSkillTools } from "@/lib/chat/tools/skill-creator-tool";
import { getLastUserMessageText } from "@/lib/memory-utils";

export const maxDuration = 30;

const SOFTWARE_SYSTEM_PROMPT = `You are a helpful assistant that helps users craft better user stories and issues for their software development kanban board.

Your job is to:
1. Ask clarifying questions to understand what the user wants to build
2. Help them write clear, actionable user stories with acceptance criteria
3. Suggest appropriate priority levels based on the context
4. When you have enough information, use the suggestIssue tool to populate the form
5. For complex features, use suggestSubtasks to break down the work into smaller pieces

When writing user stories, follow the format: "As a [user type], I want [goal], so that [benefit]"

Focus on:
- Technical specifications and requirements
- Edge cases and error handling
- Testing criteria and acceptance criteria
- Breaking down complex features into smaller tasks

**Form tools:**
- suggestIssue: Populate the main issue form with title, description, priority
- suggestSubtasks: Manage subtasks (add, update, or remove)
  - By default, replaceExisting=true replaces ALL existing subtasks with the ones you provide
  - To remove subtasks: only include the ones that should remain
  - To update subtasks: include the updated versions
  - Set replaceExisting=false to append new subtasks to the existing list

**Research tools:**
- Web search: Research related technologies, APIs, or best practices
- Code execution: Generate example code or analyze technical approaches
- Web fetch: Read documentation from URLs
- Create skill: Save a repeatable workflow or instruction set as a reusable skill for this workspace
- Update skill: Modify an existing skill (MUST warn user it affects all users and get confirmation first)

Be conversational and helpful. Ask one or two questions at a time to gather context before suggesting an issue.

When a feature is complex, proactively suggest subtasks to help break down the work.

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
5. For complex campaigns, use suggestSubtasks to break down the work into phases or deliverables

Focus on:
- Campaign objectives and KPIs
- Target audience and messaging
- Deliverables and creative assets needed
- Timeline and key milestones
- Success metrics and how to measure results

**Form tools:**
- suggestIssue: Populate the main issue form with title, description, priority
- suggestSubtasks: Manage subtasks (add, update, or remove)
  - By default, replaceExisting=true replaces ALL existing subtasks with the ones you provide
  - To remove subtasks: only include the ones that should remain
  - To update subtasks: include the updated versions
  - Set replaceExisting=false to append new subtasks to the existing list

**Research tools:**
- Web search: Research competitors, trends, best practices, audience insights
- Code execution: Run calculations, analyze data
- Web fetch: Read content from URLs
- Create skill: Save a repeatable workflow or instruction set as a reusable skill for this workspace
- Update skill: Modify an existing skill (MUST warn user it affects all users and get confirmation first)

Be conversational and helpful. Ask one or two questions at a time to gather context before suggesting an issue.

When a campaign is complex, proactively suggest subtasks to break down the work.

Priority levels:
- 0 = Urgent (time-sensitive campaigns, launch deadlines)
- 1 = High (key campaigns, major content pieces)
- 2 = Medium (regular content, ongoing campaigns)
- 3 = Low (nice-to-haves, experimental ideas)
- 4 = No priority (backlog ideas)`;

function getSystemPrompt(
  purpose: WorkspacePurpose,
  soul: WorkspaceSoul | null,
  brand: Brand | null,
  memories: WorkspaceMemory[] = [],
  subtasks?: SuggestedSubtaskContext[]
): string {
  const basePrompt = purpose === "marketing"
    ? MARKETING_SYSTEM_PROMPT
    : SOFTWARE_SYSTEM_PROMPT;

  // Build prompt with subtask independence guidelines
  let prompt = `${basePrompt}

${SUBTASK_INDEPENDENCE_GUIDELINES}`;

  // Add current subtasks context if any exist
  if (subtasks && subtasks.length > 0) {
    const subtasksList = subtasks
      .map((s, i) => `${i + 1}. "${s.title}" (Priority: ${s.priority})${s.description ? ` - ${s.description}` : ""}`)
      .join("\n");

    prompt += `

## Current Suggested Subtasks

The user has ${subtasks.length} subtask${subtasks.length !== 1 ? "s" : ""} in their form:

${subtasksList}

**To modify subtasks, use suggestSubtasks with ONLY the subtasks you want to keep.**
- To remove subtasks: Call suggestSubtasks with replaceExisting=true (default) and include ONLY the subtasks that should remain
- To update a subtask: Call suggestSubtasks with the updated version of that subtask
- To add subtasks: Call suggestSubtasks with replaceExisting=false to append, or include all existing + new ones with replaceExisting=true

Example - if user says "remove the first subtask", call suggestSubtasks with subtasks 2 and 3 only (omitting subtask 1).
Example - if user says "keep only subtask 2", call suggestSubtasks with just that one subtask.`;
  }

  return buildContextualSystemPrompt(prompt, soul, brand, memories);
}

interface SuggestedSubtaskContext {
  id: string;
  title: string;
  description?: string;
  priority: number;
}

export async function POST(req: Request) {
  const { messages, workspacePurpose, workspaceId, suggestedSubtasks } = (await req.json()) as {
    messages: UIMessage[];
    workspacePurpose?: WorkspacePurpose;
    workspaceId?: string;
    suggestedSubtasks?: SuggestedSubtaskContext[];
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

  // Create tools for issue suggestion, memory management, and skill management
  const chatTools = createChatTools();
  const memoryTools = workspaceId ? createMemoryTools({ workspaceId }) : {};
  const skillTools = createSkillTools(workspaceId);
  const tools = { ...chatTools, ...memoryTools, ...skillTools };

  return createChatResponse(messages, {
    system: getSystemPrompt(purpose, soul, brand, memories, suggestedSubtasks),
    tools,
    builtInTools: {
      webSearch: true,
      codeExecution: true,
      webFetch: true,
    },
    skills,
    workspaceId,
    usageSource: "chat",
  });
}
