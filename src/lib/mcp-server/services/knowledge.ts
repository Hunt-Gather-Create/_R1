import { db } from "@/lib/db";
import {
  knowledgeDocuments,
  knowledgeDocumentTags,
} from "@/lib/db/schema";
import { eq, and, desc, like, inArray } from "drizzle-orm";
import { McpToolError } from "@/lib/mcp-server/errors";
import type { MCPAuthContext } from "./auth-context";

/**
 * Search knowledge base documents by query, tag, or folder.
 * Uses the connected workspace from ctx.
 */
export async function searchKnowledge(
  ctx: MCPAuthContext,
  filters: {
    query?: string;
    tag?: string;
    folderId?: string;
    limit?: number;
  }
) {
  if (!ctx.workspaceId) {
    throw new McpToolError("FORBIDDEN", "No workspace connected");
  }

  const limit = filters.limit ?? 20;

  const conditions = [eq(knowledgeDocuments.workspaceId, ctx.workspaceId)];

  if (filters.folderId) {
    conditions.push(eq(knowledgeDocuments.folderId, filters.folderId));
  }
  if (filters.query?.trim()) {
    conditions.push(
      like(knowledgeDocuments.title, `%${filters.query.trim()}%`)
    );
  }

  const docs = await db
    .select()
    .from(knowledgeDocuments)
    .where(and(...conditions))
    .orderBy(desc(knowledgeDocuments.updatedAt))
    .limit(limit);

  if (docs.length === 0) {
    return { documents: [], total: 0 };
  }

  // Batch fetch tags
  const docIds = docs.map((d) => d.id);
  const tags = await db
    .select()
    .from(knowledgeDocumentTags)
    .where(inArray(knowledgeDocumentTags.documentId, docIds));

  const tagMap = new Map<string, string[]>();
  for (const tag of tags) {
    const existing = tagMap.get(tag.documentId) ?? [];
    existing.push(tag.tag);
    tagMap.set(tag.documentId, existing);
  }

  let results = docs.map((doc) => ({
    id: doc.id,
    title: doc.title,
    summary: doc.summary ?? null,
    tags: tagMap.get(doc.id) ?? [],
    folderId: doc.folderId,
    updatedAt: doc.updatedAt,
  }));

  // Filter by tag in-memory
  if (filters.tag?.trim()) {
    const normalizedTag = filters.tag.trim().toLowerCase();
    results = results.filter((doc) => doc.tags.includes(normalizedTag));
  }

  return {
    documents: results,
    total: results.length,
  };
}
