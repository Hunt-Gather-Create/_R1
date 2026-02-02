"use server";

import { revalidatePath } from "next/cache";
import { db } from "../db";
import { aiSuggestions, issues, columns } from "../db/schema";
import { eq } from "drizzle-orm";
import type { AISuggestionWithTools } from "../types";
import type { Priority } from "../design-tokens";
import { requireWorkspaceAccess } from "./workspace";
import { getWorkspaceSlug } from "./helpers";
import { createIssue } from "./issues";

// Helper to get workspace ID from issue ID
async function getWorkspaceIdFromIssue(issueId: string): Promise<string | null> {
  const issue = await db
    .select({ columnId: issues.columnId })
    .from(issues)
    .where(eq(issues.id, issueId))
    .get();

  if (!issue) return null;

  const column = await db
    .select({ workspaceId: columns.workspaceId })
    .from(columns)
    .where(eq(columns.id, issue.columnId))
    .get();

  return column?.workspaceId ?? null;
}

// Get all AI suggestions for an issue
export async function getAISuggestions(
  issueId: string
): Promise<AISuggestionWithTools[]> {
  const workspaceId = await getWorkspaceIdFromIssue(issueId);
  if (workspaceId) {
    await requireWorkspaceAccess(workspaceId, "member");
  }

  const suggestions = await db
    .select()
    .from(aiSuggestions)
    .where(eq(aiSuggestions.issueId, issueId))
    .orderBy(aiSuggestions.createdAt);

  return suggestions.map((s) => ({
    ...s,
    toolsRequired: s.toolsRequired ? JSON.parse(s.toolsRequired) : null,
  }));
}

// Add a new AI suggestion (called by chat tool)
export async function addAISuggestion(
  issueId: string,
  suggestion: {
    title: string;
    description?: string;
    priority?: number;
    toolsRequired?: string[];
  }
): Promise<AISuggestionWithTools> {
  const workspaceId = await getWorkspaceIdFromIssue(issueId);
  if (!workspaceId) throw new Error("Issue not found");
  await requireWorkspaceAccess(workspaceId, "member");

  const newSuggestion = {
    id: crypto.randomUUID(),
    issueId,
    title: suggestion.title,
    description: suggestion.description ?? null,
    priority: suggestion.priority ?? 4,
    toolsRequired: suggestion.toolsRequired
      ? JSON.stringify(suggestion.toolsRequired)
      : null,
    createdAt: new Date(),
  };

  await db.insert(aiSuggestions).values(newSuggestion);

  const slug = await getWorkspaceSlug(workspaceId);
  revalidatePath(slug ? `/w/${slug}` : "/");

  return {
    ...newSuggestion,
    toolsRequired: suggestion.toolsRequired ?? null,
  };
}

// Add multiple AI suggestions at once (batch operation)
export async function addAISuggestions(
  issueId: string,
  suggestions: Array<{
    title: string;
    description?: string;
    priority?: number;
    toolsRequired?: string[];
  }>
): Promise<AISuggestionWithTools[]> {
  if (suggestions.length === 0) return [];

  const workspaceId = await getWorkspaceIdFromIssue(issueId);
  if (!workspaceId) throw new Error("Issue not found");
  await requireWorkspaceAccess(workspaceId, "member");

  const now = new Date();
  const newSuggestions = suggestions.map((s) => ({
    id: crypto.randomUUID(),
    issueId,
    title: s.title,
    description: s.description ?? null,
    priority: s.priority ?? 4,
    toolsRequired: s.toolsRequired ? JSON.stringify(s.toolsRequired) : null,
    createdAt: now,
  }));

  await db.insert(aiSuggestions).values(newSuggestions);

  const slug = await getWorkspaceSlug(workspaceId);
  revalidatePath(slug ? `/w/${slug}` : "/");

  return newSuggestions.map((s, i) => ({
    ...s,
    priority: suggestions[i].priority ?? 4,
    toolsRequired: suggestions[i].toolsRequired ?? null,
  }));
}

// Convert a suggestion to an AI subtask
export async function addSuggestionAsSubtask(
  suggestionId: string
): Promise<void> {
  const suggestion = await db
    .select()
    .from(aiSuggestions)
    .where(eq(aiSuggestions.id, suggestionId))
    .get();

  if (!suggestion) throw new Error("Suggestion not found");

  const issue = await db
    .select()
    .from(issues)
    .where(eq(issues.id, suggestion.issueId))
    .get();

  if (!issue) throw new Error("Parent issue not found");

  const workspaceId = await getWorkspaceIdFromIssue(suggestion.issueId);
  if (workspaceId) {
    await requireWorkspaceAccess(workspaceId, "member");
  }

  // Create subtask with AI flag and priority from suggestion
  const subtask = await createIssue(issue.columnId, {
    title: suggestion.title,
    description: suggestion.description ?? undefined,
    priority: suggestion.priority as Priority,
    parentIssueId: suggestion.issueId,
  });

  // Mark as AI-assignable and set tools from suggestion
  await db
    .update(issues)
    .set({
      aiAssignable: true,
      aiTools: suggestion.toolsRequired,
      updatedAt: new Date(),
    })
    .where(eq(issues.id, subtask.id));

  // Delete the suggestion
  await db.delete(aiSuggestions).where(eq(aiSuggestions.id, suggestionId));

  if (workspaceId) {
    const slug = await getWorkspaceSlug(workspaceId);
    revalidatePath(slug ? `/w/${slug}` : "/");
  }
}

// Add all suggestions as AI subtasks
export async function addAllSuggestionsAsSubtasks(
  issueId: string
): Promise<void> {
  const suggestions = await db
    .select()
    .from(aiSuggestions)
    .where(eq(aiSuggestions.issueId, issueId))
    .orderBy(aiSuggestions.createdAt);

  if (suggestions.length === 0) return;

  const issue = await db
    .select()
    .from(issues)
    .where(eq(issues.id, issueId))
    .get();

  if (!issue) throw new Error("Issue not found");

  const workspaceId = await getWorkspaceIdFromIssue(issueId);
  if (workspaceId) {
    await requireWorkspaceAccess(workspaceId, "member");
  }

  // Create each subtask
  for (const suggestion of suggestions) {
    const subtask = await createIssue(issue.columnId, {
      title: suggestion.title,
      description: suggestion.description ?? undefined,
      priority: suggestion.priority as Priority,
      parentIssueId: issueId,
    });

    // Mark as AI-assignable
    await db
      .update(issues)
      .set({
        aiAssignable: true,
        aiTools: suggestion.toolsRequired,
        updatedAt: new Date(),
      })
      .where(eq(issues.id, subtask.id));
  }

  // Delete all suggestions
  await db.delete(aiSuggestions).where(eq(aiSuggestions.issueId, issueId));

  if (workspaceId) {
    const slug = await getWorkspaceSlug(workspaceId);
    revalidatePath(slug ? `/w/${slug}` : "/");
  }
}

// Dismiss (delete) a suggestion
export async function dismissAISuggestion(suggestionId: string): Promise<void> {
  const suggestion = await db
    .select()
    .from(aiSuggestions)
    .where(eq(aiSuggestions.id, suggestionId))
    .get();

  if (!suggestion) return;

  const workspaceId = await getWorkspaceIdFromIssue(suggestion.issueId);
  if (workspaceId) {
    await requireWorkspaceAccess(workspaceId, "member");
  }

  await db.delete(aiSuggestions).where(eq(aiSuggestions.id, suggestionId));

  if (workspaceId) {
    const slug = await getWorkspaceSlug(workspaceId);
    revalidatePath(slug ? `/w/${slug}` : "/");
  }
}

// Dismiss all suggestions for an issue
export async function dismissAllAISuggestions(issueId: string): Promise<void> {
  const workspaceId = await getWorkspaceIdFromIssue(issueId);
  if (workspaceId) {
    await requireWorkspaceAccess(workspaceId, "member");
  }

  await db.delete(aiSuggestions).where(eq(aiSuggestions.issueId, issueId));

  if (workspaceId) {
    const slug = await getWorkspaceSlug(workspaceId);
    revalidatePath(slug ? `/w/${slug}` : "/");
  }
}
