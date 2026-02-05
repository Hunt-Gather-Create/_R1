/**
 * Shared utilities for building contextual system prompts with soul, brand, and memory context.
 * Used by all chat API routes to maintain consistent prompt structure.
 */
import type { WorkspaceSoul, Brand, WorkspaceMemory } from "@/lib/types";
import { buildSoulSystemPrompt } from "@/lib/soul-utils";
import { buildBrandSystemPrompt } from "@/lib/brand-formatters";
import { buildMemorySystemPrompt } from "@/lib/memory-utils";

/**
 * Build a system prompt with optional soul, brand, and memory context prepended.
 * Context is added before the base prompt with a separator when present.
 *
 * @param basePrompt - The main system prompt for the chat endpoint
 * @param soul - Optional workspace soul configuration
 * @param brand - Optional brand configuration (must have summary to be included)
 * @param memories - Optional array of relevant workspace memories
 * @returns Combined system prompt with context prepended if available
 */
export function buildContextualSystemPrompt(
  basePrompt: string,
  soul: WorkspaceSoul | null,
  brand: Brand | null,
  memories: WorkspaceMemory[] = []
): string {
  // Build context parts (soul first, then brand, then memories)
  const contextParts: string[] = [];
  if (soul?.name) contextParts.push(buildSoulSystemPrompt(soul));
  if (brand?.summary) contextParts.push(buildBrandSystemPrompt(brand));
  const memoryPrompt = buildMemorySystemPrompt(memories);
  if (memoryPrompt) contextParts.push(memoryPrompt);

  // Prepend context to base prompt with separator if any context exists
  if (contextParts.length > 0) {
    return `${contextParts.join("\n\n")}\n\n---\n\n${basePrompt}`;
  }

  return basePrompt;
}
