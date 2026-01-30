"use server";

import { db } from "../db";
import { chatMessages, issues, columns } from "../db/schema";
import { eq, asc } from "drizzle-orm";
import type { ChatMessage } from "../types";
import { requireWorkspaceAccess } from "./workspace";

/**
 * Get workspace ID from an issue and verify access
 */
async function requireIssueAccess(issueId: string): Promise<void> {
  const issue = await db
    .select({ columnId: issues.columnId })
    .from(issues)
    .where(eq(issues.id, issueId))
    .get();

  if (!issue) {
    throw new Error("Issue not found");
  }

  const column = await db
    .select({ workspaceId: columns.workspaceId })
    .from(columns)
    .where(eq(columns.id, issue.columnId))
    .get();

  if (!column) {
    throw new Error("Column not found");
  }

  await requireWorkspaceAccess(column.workspaceId, "member");
}

export async function getIssueChatMessages(
  issueId: string
): Promise<ChatMessage[]> {
  await requireIssueAccess(issueId);

  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.issueId, issueId))
    .orderBy(asc(chatMessages.createdAt));
}

export async function saveChatMessage(
  issueId: string,
  role: string,
  content: string
): Promise<ChatMessage> {
  await requireIssueAccess(issueId);

  const message: ChatMessage = {
    id: crypto.randomUUID(),
    issueId,
    role,
    content,
    createdAt: new Date(),
  };

  await db.insert(chatMessages).values(message);

  return message;
}

export async function clearIssueChatMessages(issueId: string): Promise<void> {
  await requireIssueAccess(issueId);

  await db.delete(chatMessages).where(eq(chatMessages.issueId, issueId));
}
