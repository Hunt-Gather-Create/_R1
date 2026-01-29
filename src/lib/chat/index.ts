import { anthropic, type AnthropicProviderOptions } from "@ai-sdk/anthropic";
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
import { recordTokenUsage } from "@/lib/token-usage";

// export const DEFAULT_MODEL = "claude-sonnet-4-5";
export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
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
  createSkillLoaderTool,
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
  /**
   * Source identifier for token usage tracking.
   * Examples: "chat", "planning", "issue", "soul"
   */
  usageSource?: string;
}

/**
 * Build system prompt with skill summaries (lazy loading).
 * Only includes skill name and description - full instructions are
 * loaded on demand via the load_skill tool to reduce token costs.
 */
function buildSystemPrompt(basePrompt: string, skills?: ParsedSkill[]): string {
  if (!skills || skills.length === 0) {
    return basePrompt;
  }

  // Only include name + description (not full content)
  const skillSummaries = skills
    .map((skill) => `- **${skill.name}**: ${skill.description}`)
    .join("\n");

  return `${basePrompt}

# Available Skills

When a user's request matches one of these skills, use the \`load_skill\` tool to get the full instructions, then follow them.

${skillSummaries}`;
}

type ModelMessage = Awaited<ReturnType<typeof convertToModelMessages>>[number];
type ContentPart = { type: string; text?: string; providerOptions?: Record<string, unknown> };

/**
 * Add cache breakpoints to messages for Anthropic prompt caching.
 * Places breakpoints on:
 * 1. System prompt - at message level (supported for system messages)
 * 2. Second-to-last message - on last content part (required for user/assistant)
 *
 * This gives ~90% cost reduction on cached tokens in multi-turn conversations.
 */
function addCacheBreakpoints(
  modelMessages: ModelMessage[],
  systemPrompt: string
): ModelMessage[] {
  const cacheControl = { cacheControl: { type: "ephemeral" as const } };

  // Start with cached system message (cache control at message level works for system)
  const result: ModelMessage[] = [
    {
      role: "system" as const,
      content: systemPrompt,
      providerOptions: { anthropic: cacheControl },
    },
  ];

  // Add conversation messages, with cache breakpoint on second-to-last
  // (the last message is the new user input, so we cache up to the previous turn)
  for (let i = 0; i < modelMessages.length; i++) {
    const msg = modelMessages[i];
    const isSecondToLast = i === modelMessages.length - 2;

    if (isSecondToLast && modelMessages.length >= 2) {
      // For user/assistant messages, cache control must be on a content PART
      // not on the message itself
      result.push(addCacheControlToMessage(msg, cacheControl));
    } else {
      result.push(msg);
    }
  }

  return result;
}

/**
 * Add cache control to the last content part of a message.
 * For user/assistant messages, Anthropic requires cache control on content parts.
 */
function addCacheControlToMessage(
  msg: ModelMessage,
  cacheControl: { cacheControl: { type: "ephemeral" } }
): ModelMessage {
  // If content is a string, convert to array with text part
  if (typeof msg.content === "string") {
    return {
      ...msg,
      content: [
        {
          type: "text" as const,
          text: msg.content,
          providerOptions: { anthropic: cacheControl },
        },
      ],
    };
  }

  // If content is an array, add cache control to the last part
  if (Array.isArray(msg.content) && msg.content.length > 0) {
    const contentParts = [...msg.content] as ContentPart[];
    const lastIndex = contentParts.length - 1;
    const lastPart = contentParts[lastIndex];

    contentParts[lastIndex] = {
      ...lastPart,
      providerOptions: {
        ...lastPart.providerOptions,
        anthropic: cacheControl,
      },
    };

    return {
      ...msg,
      content: contentParts,
    } as ModelMessage;
  }

  // Fallback: return message as-is
  return msg;
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

  // Add skill loader tool if skills are provided (lazy loading)
  if (config.skills && config.skills.length > 0) {
    const { createSkillLoaderTool } = await import("./tools/skill-tools");
    allTools.load_skill = createSkillLoaderTool(config.skills);
  }

  // Build system prompt with skill summaries (full content loaded on demand)
  const systemPrompt = buildSystemPrompt(config.system, config.skills);

  const modelId = config.model ?? DEFAULT_MODEL;

  // Add cache breakpoints to enable prompt caching:
  // 1. System prompt - cached so it's not re-processed each turn
  // 2. Last message before current turn - caches conversation history
  // This way, on turn N, everything up to turn N-1 is cached (90% savings)
  const messagesWithCache = addCacheBreakpoints(modelMessages, systemPrompt);

  const result = streamText({
    model: anthropic(modelId),
    messages: messagesWithCache,
    tools: allTools,
    stopWhen: stepCountIs(config.maxSteps ?? 5),
    // Auto-clear old tool results (including loaded skills) to manage context size
    providerOptions: {
      anthropic: {
        contextManagement: {
          edits: [
            {
              type: "clear_tool_uses_20250919",
              trigger: { type: "input_tokens", value: 8000 },
              keep: { type: "tool_uses", value: 3 },
              clearAtLeast: { type: "input_tokens", value: 2000 },
              clearToolInputs: true,
            },
          ],
        },
      } satisfies AnthropicProviderOptions,
    },
  });

  // Track token usage asynchronously (don't block the response)
  if (config.workspaceId) {
    result.totalUsage
      .then((usage) => {
        // Cache info is in inputTokenDetails
        const details = (usage as typeof usage & {
          inputTokenDetails?: {
            cacheReadTokens?: number;
            cacheWriteTokens?: number;
          };
        }).inputTokenDetails;

        recordTokenUsage({
          workspaceId: config.workspaceId!,
          model: modelId,
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          cacheCreationInputTokens: details?.cacheWriteTokens ?? 0,
          cacheReadInputTokens: details?.cacheReadTokens ?? 0,
          source: config.usageSource ?? "chat",
        }).catch((error) => {
          console.error("Failed to record token usage:", error);
        });
      })
      .catch((error) => {
        console.error("Failed to get token usage:", error);
      });
  }

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
