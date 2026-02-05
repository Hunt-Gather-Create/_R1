"use server";

import { revalidatePath } from "next/cache";
import { eq, like, or, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { workspaceMemories } from "@/lib/db/schema";
import type {
  WorkspaceMemory,
  CreateWorkspaceMemoryInput,
  UpdateWorkspaceMemoryInput,
} from "@/lib/types";
import { parseMemoryTags } from "@/lib/utils";
import { requireWorkspaceAccess } from "./workspace";

/**
 * Get workspace ID from a memory and verify access
 */
async function requireMemoryAccess(
  memoryId: string
): Promise<{ memory: WorkspaceMemory }> {
  const [memory] = await db
    .select()
    .from(workspaceMemories)
    .where(eq(workspaceMemories.id, memoryId));

  if (!memory) {
    throw new Error("Memory not found");
  }

  await requireWorkspaceAccess(memory.workspaceId, "member");
  return { memory };
}

/**
 * Get all memories for a workspace (for settings display)
 */
export async function getWorkspaceMemories(
  workspaceId: string
): Promise<WorkspaceMemory[]> {
  await requireWorkspaceAccess(workspaceId);

  return db
    .select()
    .from(workspaceMemories)
    .where(eq(workspaceMemories.workspaceId, workspaceId))
    .orderBy(desc(workspaceMemories.updatedAt));
}

/**
 * List all memories for a workspace (for AI to check for duplicates)
 * Returns simplified format with id, content snippet, and tags
 */
export async function listWorkspaceMemories(
  workspaceId: string
): Promise<Array<{ id: string; content: string; tags: string[] }>> {
  await requireWorkspaceAccess(workspaceId);

  const memories = await db
    .select()
    .from(workspaceMemories)
    .where(eq(workspaceMemories.workspaceId, workspaceId))
    .orderBy(desc(workspaceMemories.updatedAt));

  return memories.map((m) => ({
    id: m.id,
    content: m.content.length > 200 ? m.content.slice(0, 200) + "..." : m.content,
    tags: parseMemoryTags(m.tags),
  }));
}

/**
 * Search memories by keywords (simple LIKE search for MVP)
 */
export async function searchWorkspaceMemories(
  workspaceId: string,
  query: string,
  limit: number = 5
): Promise<WorkspaceMemory[]> {
  await requireWorkspaceAccess(workspaceId);

  // Extract keywords from query (remove common words)
  const stopWords = new Set([
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could", "should",
    "may", "might", "must", "shall", "can", "need", "dare", "ought", "used",
    "to", "of", "in", "for", "on", "with", "at", "by", "from", "as", "into",
    "through", "during", "before", "after", "above", "below", "between",
    "under", "again", "further", "then", "once", "here", "there", "when",
    "where", "why", "how", "all", "each", "every", "both", "few", "more",
    "most", "other", "some", "such", "no", "nor", "not", "only", "own", "same",
    "so", "than", "too", "very", "just", "and", "but", "or", "because",
    "until", "while", "about", "what", "which", "who", "whom", "this", "that",
    "these", "those", "am", "it", "its", "i", "me", "my", "myself", "we", "our",
    "ours", "ourselves", "you", "your", "yours", "yourself", "yourselves",
    "he", "him", "his", "himself", "she", "her", "hers", "herself", "they",
    "them", "their", "theirs", "themselves",
  ]);

  const keywords = query
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word))
    .slice(0, 5); // Use top 5 keywords

  if (keywords.length === 0) {
    return [];
  }

  // Build OR conditions for each keyword searching content and tags
  const conditions = keywords.flatMap((keyword) => [
    like(workspaceMemories.content, `%${keyword}%`),
    like(workspaceMemories.tags, `%${keyword}%`),
  ]);

  const memories = await db
    .select()
    .from(workspaceMemories)
    .where(or(eq(workspaceMemories.workspaceId, workspaceId), ...conditions))
    .limit(limit * 2); // Fetch more, then filter

  // Filter to only include memories from this workspace
  const filtered = memories.filter((m) => m.workspaceId === workspaceId);

  // Dedupe by id (in case same memory matched multiple keywords)
  const seen = new Set<string>();
  const unique: WorkspaceMemory[] = [];
  for (const memory of filtered) {
    if (!seen.has(memory.id)) {
      seen.add(memory.id);
      unique.push(memory);
    }
  }

  return unique.slice(0, limit);
}

/**
 * Create a new workspace memory (used by AI)
 */
export async function createWorkspaceMemory(
  workspaceId: string,
  input: CreateWorkspaceMemoryInput
): Promise<WorkspaceMemory> {
  await requireWorkspaceAccess(workspaceId, "member");

  const now = new Date();
  const id = crypto.randomUUID();

  const [memory] = await db
    .insert(workspaceMemories)
    .values({
      id,
      workspaceId,
      content: input.content,
      tags: JSON.stringify(input.tags),
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  revalidatePath(`/w/[slug]/settings/memories`, "page");
  return memory;
}

/**
 * Update a workspace memory (used by AI)
 */
export async function updateWorkspaceMemory(
  memoryId: string,
  input: UpdateWorkspaceMemoryInput
): Promise<WorkspaceMemory> {
  const { memory: existing } = await requireMemoryAccess(memoryId);
  await requireWorkspaceAccess(existing.workspaceId, "member");

  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (input.content !== undefined) {
    updateData.content = input.content;
  }
  if (input.tags !== undefined) {
    updateData.tags = JSON.stringify(input.tags);
  }

  const [memory] = await db
    .update(workspaceMemories)
    .set(updateData)
    .where(eq(workspaceMemories.id, memoryId))
    .returning();

  revalidatePath(`/w/[slug]/settings/memories`, "page");
  return memory;
}

/**
 * Delete a workspace memory (settings page - admin only)
 */
export async function deleteWorkspaceMemory(memoryId: string): Promise<void> {
  const { memory } = await requireMemoryAccess(memoryId);
  await requireWorkspaceAccess(memory.workspaceId, "admin");

  await db.delete(workspaceMemories).where(eq(workspaceMemories.id, memoryId));
  revalidatePath(`/w/[slug]/settings/memories`, "page");
}
