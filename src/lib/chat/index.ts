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

export const DEFAULT_MODEL = "claude-sonnet-4-20250514";
export const DEFAULT_MAX_DURATION = 30;

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
interface ChatConfig {
  system: string;
  tools: ToolSet;
  model?: string;
  /**
   * Maximum number of steps (tool call rounds) the model can make.
   * Set to a higher number to allow the AI to continue after tool calls.
   * Default is 1 (stops after first tool call).
   */
  maxSteps?: number;
}

/**
 * Creates a streaming chat response
 */
export async function createChatResponse(
  messages: UIMessage[],
  config: ChatConfig
) {
  const modelMessages = await convertToModelMessages(messages);

  const result = streamText({
    model: anthropic(config.model ?? DEFAULT_MODEL),
    system: config.system,
    messages: modelMessages,
    tools: config.tools,
    stopWhen: config.maxSteps ? stepCountIs(config.maxSteps) : undefined,
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
