"use server";

import { db } from "../db";
import {
  workspaceChats,
  workspaceChatAttachments,
  adArtifacts,
} from "../db/schema";
import { eq, desc, asc } from "drizzle-orm";
import type {
  WorkspaceChat,
  WorkspaceChatAttachment,
  R2ChatMessage,
} from "../types";
import { requireWorkspaceAccess } from "./workspace";
import { getMessages, appendMessage, deleteConversation } from "../storage/r2-chat";

/**
 * Get workspace ID from a chat and verify access
 * Returns workspaceId and userId for R2 storage
 */
async function requireChatAccess(chatId: string): Promise<{
  workspaceId: string;
  userId: string;
}> {
  const chat = await db
    .select({ workspaceId: workspaceChats.workspaceId })
    .from(workspaceChats)
    .where(eq(workspaceChats.id, chatId))
    .get();

  if (!chat) {
    throw new Error("Chat not found");
  }

  const { user } = await requireWorkspaceAccess(chat.workspaceId, "member");
  return { workspaceId: chat.workspaceId, userId: user.id };
}

/**
 * Get workspace ID from an attachment via its chat and verify access
 */
async function requireAttachmentAccess(attachmentId: string): Promise<{
  workspaceId: string;
  userId: string;
}> {
  const attachment = await db
    .select({ chatId: workspaceChatAttachments.chatId })
    .from(workspaceChatAttachments)
    .where(eq(workspaceChatAttachments.id, attachmentId))
    .get();

  if (!attachment) {
    throw new Error("Attachment not found");
  }

  return requireChatAccess(attachment.chatId);
}

export async function getWorkspaceChats(
  workspaceId: string
): Promise<WorkspaceChat[]> {
  await requireWorkspaceAccess(workspaceId);

  return db
    .select()
    .from(workspaceChats)
    .where(eq(workspaceChats.workspaceId, workspaceId))
    .orderBy(desc(workspaceChats.updatedAt));
}

export async function getWorkspaceChat(
  chatId: string
): Promise<WorkspaceChat | null> {
  const [chat] = await db
    .select()
    .from(workspaceChats)
    .where(eq(workspaceChats.id, chatId))
    .limit(1);

  if (!chat) return null;

  await requireWorkspaceAccess(chat.workspaceId);

  return chat;
}

export async function createWorkspaceChat(
  workspaceId: string,
  title?: string
): Promise<WorkspaceChat> {
  await requireWorkspaceAccess(workspaceId, "member");

  const now = new Date();
  const chat: WorkspaceChat = {
    id: crypto.randomUUID(),
    workspaceId,
    title: title ?? "New chat",
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(workspaceChats).values(chat);

  return chat;
}

export async function updateChatTitle(
  chatId: string,
  title: string
): Promise<void> {
  await requireChatAccess(chatId);

  await db
    .update(workspaceChats)
    .set({ title, updatedAt: new Date() })
    .where(eq(workspaceChats.id, chatId));
}

export async function deleteWorkspaceChat(chatId: string): Promise<void> {
  const { workspaceId, userId } = await requireChatAccess(chatId);

  // Delete the conversation from R2
  await deleteConversation(workspaceId, "workspace", userId, chatId);

  // Delete the chat metadata from DB (cascade deletes attachments)
  await db.delete(workspaceChats).where(eq(workspaceChats.id, chatId));
}

// Return type that matches what consumers expect
export interface WorkspaceChatMessage {
  id: string;
  chatId: string;
  role: string;
  content: string;
  createdAt: Date;
}

export async function getChatMessages(
  chatId: string
): Promise<WorkspaceChatMessage[]> {
  const { workspaceId, userId } = await requireChatAccess(chatId);

  const messages = await getMessages(workspaceId, "workspace", userId, chatId);

  // Transform R2ChatMessage to WorkspaceChatMessage format for compatibility
  return messages.map((m: R2ChatMessage) => ({
    id: m.id,
    chatId,
    role: m.role,
    content: m.content,
    createdAt: new Date(m.createdAt),
  }));
}

export async function saveChatMessage(
  chatId: string,
  role: string,
  content: string
): Promise<WorkspaceChatMessage> {
  const { workspaceId, userId } = await requireChatAccess(chatId);

  const messageId = crypto.randomUUID();

  await appendMessage(workspaceId, "workspace", userId, chatId, {
    id: messageId,
    role: role as "user" | "assistant",
    content,
  });

  // Update the chat's updatedAt timestamp
  await db
    .update(workspaceChats)
    .set({ updatedAt: new Date() })
    .where(eq(workspaceChats.id, chatId));

  return {
    id: messageId,
    chatId,
    role,
    content,
    createdAt: new Date(),
  };
}

export async function clearChatMessages(chatId: string): Promise<void> {
  const { workspaceId, userId } = await requireChatAccess(chatId);

  await deleteConversation(workspaceId, "workspace", userId, chatId);
}

// Attachment operations (unchanged - still stored in database)

export async function getChatAttachments(
  chatId: string
): Promise<WorkspaceChatAttachment[]> {
  await requireChatAccess(chatId);

  return db
    .select()
    .from(workspaceChatAttachments)
    .where(eq(workspaceChatAttachments.chatId, chatId))
    .orderBy(asc(workspaceChatAttachments.createdAt));
}

export async function getChatAttachment(
  attachmentId: string
): Promise<WorkspaceChatAttachment | null> {
  const [attachment] = await db
    .select()
    .from(workspaceChatAttachments)
    .where(eq(workspaceChatAttachments.id, attachmentId))
    .limit(1);

  if (!attachment) return null;

  await requireChatAccess(attachment.chatId);

  return attachment;
}

/**
 * Save an ad artifact as a workspace chat attachment (JSON export).
 * The attachment appears in the chat's attachment list and can be viewed or downloaded.
 */
export async function saveArtifactAsChatAttachment(
  artifactId: string,
  chatId: string
): Promise<{ success: true; attachmentId: string; filename: string } | { success: false; error: string }> {
  try {
    const { workspaceId } = await requireChatAccess(chatId);

    const artifact = await db
      .select()
      .from(adArtifacts)
      .where(eq(adArtifacts.id, artifactId))
      .get();

    if (!artifact) {
      return { success: false, error: "Artifact not found" };
    }
    if (artifact.workspaceId !== workspaceId) {
      return { success: false, error: "Artifact does not belong to this workspace" };
    }

    const exportPayload = {
      id: artifact.id,
      name: artifact.name,
      platform: artifact.platform,
      templateType: artifact.templateType,
      content: artifact.content,
      brandId: artifact.brandId,
      createdAt: artifact.createdAt,
      updatedAt: artifact.updatedAt,
    };
    const content = JSON.stringify(exportPayload, null, 2);
    const safeName = artifact.name.replace(/[^a-zA-Z0-9-_.\s]/g, "-").replace(/\s+/g, "-").slice(0, 80) || "artifact";
    const filename = `${safeName}.json`;

    const attachment = await createChatAttachment(
      chatId,
      filename,
      content,
      "application/json"
    );

    return { success: true, attachmentId: attachment.id, filename: attachment.filename };
  } catch (err) {
    console.error("[saveArtifactAsChatAttachment]", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to save artifact as attachment",
    };
  }
}

export async function createChatAttachment(
  chatId: string,
  filename: string,
  content: string,
  mimeType: string = "text/markdown"
): Promise<WorkspaceChatAttachment> {
  await requireChatAccess(chatId);

  const attachment: WorkspaceChatAttachment = {
    id: crypto.randomUUID(),
    chatId,
    messageId: null,
    filename,
    content,
    mimeType,
    size: new TextEncoder().encode(content).length,
    createdAt: new Date(),
  };

  await db.insert(workspaceChatAttachments).values(attachment);

  return attachment;
}

export async function deleteChatAttachment(attachmentId: string): Promise<void> {
  await requireAttachmentAccess(attachmentId);

  await db
    .delete(workspaceChatAttachments)
    .where(eq(workspaceChatAttachments.id, attachmentId));
}

export async function linkAttachmentToMessage(
  attachmentId: string,
  messageId: string
): Promise<void> {
  await requireAttachmentAccess(attachmentId);

  await db
    .update(workspaceChatAttachments)
    .set({ messageId })
    .where(eq(workspaceChatAttachments.id, attachmentId));
}

export async function getAttachmentsByMessageId(
  messageId: string
): Promise<WorkspaceChatAttachment[]> {
  return db
    .select()
    .from(workspaceChatAttachments)
    .where(eq(workspaceChatAttachments.messageId, messageId))
    .orderBy(asc(workspaceChatAttachments.createdAt));
}

// Get messages with their attachments for a chat
export async function getChatMessagesWithAttachments(
  chatId: string
): Promise<(WorkspaceChatMessage & { attachments: WorkspaceChatAttachment[] })[]> {
  const { workspaceId, userId } = await requireChatAccess(chatId);

  // Get messages from R2
  const r2Messages = await getMessages(workspaceId, "workspace", userId, chatId);

  // Get attachments from DB
  const attachments = await db
    .select()
    .from(workspaceChatAttachments)
    .where(eq(workspaceChatAttachments.chatId, chatId))
    .orderBy(asc(workspaceChatAttachments.createdAt));

  // Group attachments by messageId
  const attachmentsByMessage = new Map<string, WorkspaceChatAttachment[]>();
  for (const attachment of attachments) {
    if (attachment.messageId) {
      const existing = attachmentsByMessage.get(attachment.messageId) || [];
      existing.push(attachment);
      attachmentsByMessage.set(attachment.messageId, existing);
    }
  }

  // Merge attachments into messages
  return r2Messages.map((m: R2ChatMessage) => ({
    id: m.id,
    chatId,
    role: m.role,
    content: m.content,
    createdAt: new Date(m.createdAt),
    attachments: attachmentsByMessage.get(m.id) || [],
  }));
}
