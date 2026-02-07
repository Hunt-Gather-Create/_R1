"use server";

import { revalidatePath } from "next/cache";
import { db } from "../db";
import { workspaces, brands } from "../db/schema";
import { eq } from "drizzle-orm";
import type { WorkspaceSoul, R2ChatMessage } from "../types";
import { requireWorkspaceAccess } from "./workspace";
import { getMessages, appendMessage, deleteConversation } from "../storage/r2-chat";
import { inngest } from "../inngest/client";

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
  const { user } = await requireWorkspaceAccess(workspaceId);

  // Use "config" as entityId since soul chat is per-workspace config
  const messages = await getMessages(workspaceId, "soul", user.id, "config");

  return messages.map((m: R2ChatMessage) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    createdAt: new Date(m.createdAt),
  }));
}

/**
 * Save a soul chat message
 */
export async function saveSoulChatMessage(
  workspaceId: string,
  message: { id: string; role: "user" | "assistant"; content: string }
): Promise<void> {
  const { user } = await requireWorkspaceAccess(workspaceId);

  // Use "config" as entityId since soul chat is per-workspace config
  await appendMessage(workspaceId, "soul", user.id, "config", {
    id: message.id,
    role: message.role,
    content: message.content,
  });
}

/**
 * Delete all soul chat messages for a workspace
 */
export async function deleteSoulChatMessages(
  workspaceId: string
): Promise<void> {
  const { user } = await requireWorkspaceAccess(workspaceId, "admin");

  // Use "config" as entityId since soul chat is per-workspace config
  await deleteConversation(workspaceId, "soul", user.id, "config");
}

/**
 * Trigger background soul generation from brand data and project type.
 * Fire-and-forget: sends an Inngest event and returns immediately.
 */
export async function generateSoulFromBrand(
  workspaceId: string,
  projectType: string
): Promise<void> {
  const { workspace } = await requireWorkspaceAccess(workspaceId, "admin");

  if (!workspace.brandId) {
    throw new Error("Workspace must have a brand to generate a soul");
  }

  const brand = await db
    .select()
    .from(brands)
    .where(eq(brands.id, workspace.brandId))
    .get();

  if (!brand) {
    throw new Error("Brand not found");
  }

  await inngest.send({
    name: "soul/generate",
    data: {
      workspaceId,
      brandId: brand.id,
      brandName: brand.name,
      brandSummary: brand.summary ?? undefined,
      projectType,
      workspaceName: workspace.name,
    },
  });
}
