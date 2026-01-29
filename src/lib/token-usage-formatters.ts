/**
 * Client-safe token usage formatting utilities.
 * For server-side database functions, import from ./token-usage instead.
 */

/**
 * Anthropic model pricing (per million tokens in USD)
 * Updated: January 2025
 * Source: https://www.anthropic.com/pricing
 */
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Haiku 4.5: $1 input, $5 output
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "claude-4-5-haiku": { input: 1, output: 5 },

  // Sonnet 4.5: $3 input, $15 output
  "claude-sonnet-4-5-20250514": { input: 3, output: 15 },
  "claude-4-5-sonnet": { input: 3, output: 15 },

  // Sonnet 4: $3 input, $15 output
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
  "claude-4-sonnet": { input: 3, output: 15 },

  // Opus 4.5: $5 input, $25 output
  "claude-opus-4-5-20251101": { input: 5, output: 25 },
  "claude-4-5-opus": { input: 5, output: 25 },

  // Opus 4: $15 input, $75 output
  "claude-opus-4-20250514": { input: 15, output: 75 },
  "claude-4-opus": { input: 15, output: 75 },
};

/**
 * Default pricing for unknown models (use Haiku pricing as conservative default)
 */
const DEFAULT_PRICING = { input: 1, output: 5 };

/**
 * Cache pricing multipliers (Anthropic)
 * - Cache write: 1.25x input price
 * - Cache read: 0.1x input price (90% savings)
 */
export const CACHE_PRICING = {
  write: 1.25,
  read: 0.1,
};

/**
 * Calculate cost in cents for a given model and token counts.
 *
 * Note: inputTokens is the TOTAL of all input tokens (including cache).
 * We subtract cache tokens and apply their special rates:
 * - Regular input: 1x base price
 * - Cache write: 1.25x base price
 * - Cache read: 0.1x base price (90% savings!)
 */
export function calculateCostCents(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationInputTokens: number = 0,
  cacheReadInputTokens: number = 0
): number {
  const pricing = MODEL_PRICING[model] || DEFAULT_PRICING;

  // inputTokens includes all input (regular + cache), so we need to separate them
  const regularInputTokens =
    inputTokens - cacheCreationInputTokens - cacheReadInputTokens;

  // Price is per million tokens, we want cents
  // (tokens / 1_000_000) * price_per_million * 100 (to get cents)
  // = tokens * price_per_million / 10_000
  const regularInputCost = (regularInputTokens * pricing.input) / 10_000;
  const outputCost = (outputTokens * pricing.output) / 10_000;

  // Cache costs at their special rates
  const cacheWriteCost =
    (cacheCreationInputTokens * pricing.input * CACHE_PRICING.write) / 10_000;
  const cacheReadCost =
    (cacheReadInputTokens * pricing.input * CACHE_PRICING.read) / 10_000;

  // Round to nearest cent
  return Math.round(
    regularInputCost + outputCost + cacheWriteCost + cacheReadCost
  );
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
