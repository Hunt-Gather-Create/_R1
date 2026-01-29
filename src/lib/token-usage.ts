/**
 * Server-side token usage utilities that require database access.
 * For client-safe utilities, import from ./token-usage-formatters instead.
 */
import { db } from "./db";
import { tokenUsage } from "./db/schema";

// Re-export client-safe functions for backwards compatibility
export {
  MODEL_PRICING,
  calculateCostCents,
  getModelDisplayName,
  formatCost,
  formatTokens,
} from "./token-usage-formatters";

import { calculateCostCents } from "./token-usage-formatters";

/**
 * Record token usage to the database
 */
export async function recordTokenUsage(params: {
  workspaceId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  source?: string;
}): Promise<void> {
  const {
    workspaceId,
    model,
    inputTokens,
    outputTokens,
    cacheCreationInputTokens = 0,
    cacheReadInputTokens = 0,
    source = "chat",
  } = params;

  const totalTokens = inputTokens + outputTokens;
  const costCents = calculateCostCents(
    model,
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens
  );

  await db.insert(tokenUsage).values({
    workspaceId,
    model,
    inputTokens,
    outputTokens,
    totalTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    costCents,
    source,
  });
}

