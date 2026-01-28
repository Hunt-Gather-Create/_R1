"use server";

import { revalidatePath } from "next/cache";
import { db } from "../db";
import { workspaces, soulChatMessages } from "../db/schema";
import { eq, asc } from "drizzle-orm";
import type { WorkspaceSoul } from "../types";
import { requireWorkspaceAccess } from "./workspace";

/**
 * Get the soul configuration for a workspace
 */
export async function getSoul(workspaceId: string): Promise<WorkspaceSoul | null> {
  await requireWorkspaceAccess(workspaceId);

  const workspace = await db
    .select({ soul: workspaces.soul })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .get();

  if (!workspace?.soul) {
    return null;
  }

  try {
    return JSON.parse(workspace.soul) as WorkspaceSoul;
  } catch {
    return null;
  }
}

/**
 * Update the soul configuration for a workspace
 */
export async function updateSoul(
  workspaceId: string,
  soul: WorkspaceSoul
): Promise<WorkspaceSoul> {
  await requireWorkspaceAccess(workspaceId, "admin");

  const now = new Date().toISOString();
  const updatedSoul: WorkspaceSoul = {
    ...soul,
    updatedAt: now,
  };

  await db
    .update(workspaces)
    .set({
      soul: JSON.stringify(updatedSoul),
      updatedAt: new Date(),
    })
    .where(eq(workspaces.id, workspaceId));

  revalidatePath(`/w`);

  return updatedSoul;
}

/**
 * Delete the soul configuration for a workspace
 */
export async function deleteSoul(workspaceId: string): Promise<void> {
  await requireWorkspaceAccess(workspaceId, "admin");

  await db
    .update(workspaces)
    .set({
      soul: null,
      updatedAt: new Date(),
    })
    .where(eq(workspaces.id, workspaceId));

  revalidatePath(`/w`);
}

// Soul Chat Message types
export interface SoulChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string; // JSON-serialized message parts
  createdAt: Date;
}

/**
 * Get all soul chat messages for a workspace
 */
export async function getSoulChatMessages(
  workspaceId: string
): Promise<SoulChatMessage[]> {
  await requireWorkspaceAccess(workspaceId);

  const messages = await db
    .select()
    .from(soulChatMessages)
    .where(eq(soulChatMessages.workspaceId, workspaceId))
    .orderBy(asc(soulChatMessages.createdAt));

  return messages.map((m) => ({
    id: m.id,
    role: m.role as "user" | "assistant",
    content: m.content,
    createdAt: m.createdAt!,
  }));
}

/**
 * Save a soul chat message
 */
export async function saveSoulChatMessage(
  workspaceId: string,
  message: { id: string; role: "user" | "assistant"; content: string }
): Promise<void> {
  await requireWorkspaceAccess(workspaceId);

  await db.insert(soulChatMessages).values({
    id: message.id,
    workspaceId,
    role: message.role,
    content: message.content,
    createdAt: new Date(),
  });
}

/**
 * Delete all soul chat messages for a workspace
 */
export async function deleteSoulChatMessages(
  workspaceId: string
): Promise<void> {
  await requireWorkspaceAccess(workspaceId, "admin");

  await db
    .delete(soulChatMessages)
    .where(eq(soulChatMessages.workspaceId, workspaceId));
}

