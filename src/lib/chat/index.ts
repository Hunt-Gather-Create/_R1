import { anthropic } from "@ai-sdk/anthropic";
import {
  streamText,
  tool,
  convertToModelMessages,
  stepCountIs,
  type UIMessage,
  type ToolSet,
} from "ai";
import { z, type ZodObject, type ZodRawShape } from "zod";
import type { ParsedSkill } from "./skills";
import { getMcpToolsForWorkspace } from "@/lib/mcp";

export const DEFAULT_MODEL = "claude-sonnet-4-20250514";
export const DEFAULT_MAX_DURATION = 30;

// Re-export skills module
export {
  loadSkill,
  loadSkillsForPurpose,
  loadSkillsForWorkspace,
  loadAllSkills,
} from "./skills";
export type { ParsedSkill, SkillManifest } from "./skills";

// Re-export tools
export {
  createIssueTools,
  createPlanningTools,
  createChatTools,
  type IssueToolsContext,
} from "./tools";

/**
 * Configuration for Anthropic built-in tools
 */
export interface BuiltInToolsConfig {
  webSearch?: boolean | { maxUses?: number };
  codeExecution?: boolean;
  webFetch?: boolean | { maxUses?: number };
}

/**
 * Configuration for a chat tool
 */
interface ToolConfig<T extends ZodRawShape> {
  description: string;
  schema: ZodObject<T>;
  /**
   * Optional result message returned to the AI after tool execution.
   * If not provided, a default confirmation message is used.
   */
  resultMessage?: (input: z.infer<ZodObject<T>>) => string;
}

/**
 * Creates a tool with an execute function that returns a result.
 * This ensures tool calls in conversation history have corresponding results,
 * preventing AI_MissingToolResultsError.
 */
export function createTool<T extends ZodRawShape>(config: ToolConfig<T>) {
  return tool({
    description: config.description,
    inputSchema: config.schema,
    execute: async (input) => {
      // The actual handling happens client-side via onToolCall
      // This just provides a result so the conversation can continue
      if (config.resultMessage) {
        return config.resultMessage(input as z.infer<typeof config.schema>);
      }
      return "Done";
    },
  });
}

/**
 * Configuration for a chat endpoint
 */
export interface ChatConfig {
  system: string;
  tools: ToolSet;
  model?: string;
  /**
   * Maximum number of steps (tool call rounds) the model can make.
   * Enables multi-step tool calling where the AI continues after tool results
   * until there are no more tool calls or this limit is reached.
   * Default is 5.
   */
  maxSteps?: number;
  /**
   * Anthropic built-in tools to enable (web search, code execution, web fetch)
   */
  builtInTools?: BuiltInToolsConfig;
  /**
   * Skill instructions to include in the system prompt.
   * Use loadSkillsForPurpose() to load skills based on workspace type.
   */
  skills?: ParsedSkill[];
  /**
   * Workspace ID for loading MCP tools from enabled integrations.
   * If provided, MCP tools will be fetched and merged into the tool set.
   */
  workspaceId?: string;
}

/**
 * Build system prompt with skill instructions
 */
function buildSystemPrompt(
  basePrompt: string,
  skills?: ParsedSkill[]
): string {
  if (!skills || skills.length === 0) {
    return basePrompt;
  }

  const skillSections = skills.map((skill) => {
    return `### ${skill.name}

**When to use:** ${skill.description}

**Instructions:**
${skill.content}`;
  });

  return `${basePrompt}

# Specialized Skills

You have access to the following specialized skills. When the user's request matches a skill's triggers, you MUST follow that skill's instructions.

${skillSections.join("\n\n---\n\n")}`;
}

/**
 * Creates a streaming chat response
 */
export async function createChatResponse(
  messages: UIMessage[],
  config: ChatConfig
) {
  const modelMessages = await convertToModelMessages(messages);

  // Merge custom tools with built-in Anthropic tools
  const allTools: ToolSet = { ...config.tools };

  // Add MCP tools from enabled integrations
  if (config.workspaceId) {
    try {
      const mcpTools = await getMcpToolsForWorkspace(config.workspaceId);
      for (const [toolName, tool] of Object.entries(mcpTools)) {
        allTools[toolName] = tool;
      }
    } catch (error) {
      console.error("Failed to load MCP tools:", error);
      // Continue without MCP tools
    }
  }

  if (config.builtInTools?.webSearch) {
    const options =
      typeof config.builtInTools.webSearch === "object"
        ? config.builtInTools.webSearch
        : {};
    allTools.web_search = anthropic.tools.webSearch_20250305({
      maxUses: options.maxUses ?? 3,
    });
  }

  if (config.builtInTools?.codeExecution) {
    allTools.code_execution = anthropic.tools.codeExecution_20250825();
  }

  if (config.builtInTools?.webFetch) {
    const options =
      typeof config.builtInTools.webFetch === "object"
        ? config.builtInTools.webFetch
        : {};
    allTools.web_fetch = anthropic.tools.webFetch_20250910({
      maxUses: options.maxUses ?? 2,
    });
  }

  // Build system prompt with skill instructions
  const systemPrompt = buildSystemPrompt(config.system, config.skills);

  const result = streamText({
    model: anthropic(config.model ?? DEFAULT_MODEL),
    system: systemPrompt,
    messages: modelMessages,
    tools: allTools,
    stopWhen: stepCountIs(config.maxSteps ?? 5),
  });

  return result.toUIMessageStreamResponse();
}

/**
 * Priority labels for display
 */
export const PRIORITY_LABELS: Record<number, string> = {
  0: "Urgent",
  1: "High",
  2: "Medium",
  3: "Low",
  4: "None",
};

/**
 * Get priority label from number
 */
export function getPriorityLabel(priority: number): string {
  return PRIORITY_LABELS[priority] ?? "None";
}
