import { db } from "./db";
import { tokenUsage } from "./db/schema";

/**
 * Anthropic model pricing (per million tokens in USD)
 * Updated: January 2025
 */
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Haiku 4.5 (default for most chat)
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  // Sonnet 4 / 4.5
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
  "claude-sonnet-4-5-20251104": { input: 3, output: 15 },
  "anthropic/claude-sonnet-4-5": { input: 3, output: 15 },
  // Opus 4 / 4.5
  "claude-opus-4-5-20251101": { input: 5, output: 25 },
  "claude-opus-4-20251205": { input: 15, output: 75 },
};

/**
 * Default pricing for unknown models (use Haiku pricing as conservative default)
 */
const DEFAULT_PRICING = { input: 1, output: 5 };

/**
 * Calculate cost in cents for a given model and token counts
 */
export function calculateCostCents(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = MODEL_PRICING[model] || DEFAULT_PRICING;

  // Price is per million tokens, we want cents
  // (tokens / 1_000_000) * price_per_million * 100 (to get cents)
  // = tokens * price_per_million / 10_000
  const inputCost = (inputTokens * pricing.input) / 10_000;
  const outputCost = (outputTokens * pricing.output) / 10_000;

  // Round to nearest cent
  return Math.round(inputCost + outputCost);
}

/**
 * Record token usage to the database
 */
export async function recordTokenUsage(params: {
  workspaceId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  source?: string;
}): Promise<void> {
  const { workspaceId, model, inputTokens, outputTokens, source = "chat" } = params;

  const totalTokens = inputTokens + outputTokens;
  const costCents = calculateCostCents(model, inputTokens, outputTokens);

  await db.insert(tokenUsage).values({
    workspaceId,
    model,
    inputTokens,
    outputTokens,
    totalTokens,
    costCents,
    source,
  });
}

/**
 * Get a human-readable model name
 */
export function getModelDisplayName(model: string): string {
  if (model.includes("haiku")) return "Haiku";
  if (model.includes("sonnet")) return "Sonnet";
  if (model.includes("opus")) return "Opus";
  return model;
}

/**
 * Format cost from cents to dollars
 */
export function formatCost(cents: number): string {
  if (cents < 100) {
    return `$0.${cents.toString().padStart(2, "0")}`;
  }
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Format token count with commas
 */
export function formatTokens(tokens: number): string {
  return tokens.toLocaleString();
}
