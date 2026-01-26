"use server";

import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { workspaceSkills } from "@/lib/db/schema";
import type {
  WorkspaceSkill,
  CreateWorkspaceSkillInput,
  UpdateWorkspaceSkillInput,
} from "@/lib/types";

/**
 * Get all skills for a workspace
 */
export async function getWorkspaceSkills(
  workspaceId: string
): Promise<WorkspaceSkill[]> {
  return db
    .select()
    .from(workspaceSkills)
    .where(eq(workspaceSkills.workspaceId, workspaceId))
    .orderBy(workspaceSkills.name);
}

/**
 * Get only enabled skills for a workspace (used by chat)
 */
export async function getEnabledWorkspaceSkills(
  workspaceId: string
): Promise<WorkspaceSkill[]> {
  return db
    .select()
    .from(workspaceSkills)
    .where(
      and(
        eq(workspaceSkills.workspaceId, workspaceId),
        eq(workspaceSkills.isEnabled, true)
      )
    )
    .orderBy(workspaceSkills.name);
}

/**
 * Create a new workspace skill
 */
export async function createWorkspaceSkill(
  workspaceId: string,
  input: CreateWorkspaceSkillInput
): Promise<WorkspaceSkill> {
  const now = new Date();
  const id = crypto.randomUUID();

  const [skill] = await db
    .insert(workspaceSkills)
    .values({
      id,
      workspaceId,
      name: input.name,
      description: input.description,
      content: input.content,
      isEnabled: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  revalidatePath(`/w/[slug]/settings/skills`, "page");
  return skill;
}

/**
 * Update a workspace skill
 */
export async function updateWorkspaceSkill(
  skillId: string,
  input: UpdateWorkspaceSkillInput
): Promise<WorkspaceSkill> {
  const [skill] = await db
    .update(workspaceSkills)
    .set({
      ...input,
      updatedAt: new Date(),
    })
    .where(eq(workspaceSkills.id, skillId))
    .returning();

  revalidatePath(`/w/[slug]/settings/skills`, "page");
  return skill;
}

/**
 * Delete a workspace skill
 */
export async function deleteWorkspaceSkill(skillId: string): Promise<void> {
  await db.delete(workspaceSkills).where(eq(workspaceSkills.id, skillId));
  revalidatePath(`/w/[slug]/settings/skills`, "page");
}

/**
 * Toggle a workspace skill on/off
 */
export async function toggleWorkspaceSkill(
  skillId: string
): Promise<WorkspaceSkill> {
  // Get current state
  const [current] = await db
    .select()
    .from(workspaceSkills)
    .where(eq(workspaceSkills.id, skillId));

  if (!current) {
    throw new Error("Skill not found");
  }

  // Toggle the enabled state
  const [skill] = await db
    .update(workspaceSkills)
    .set({
      isEnabled: !current.isEnabled,
      updatedAt: new Date(),
    })
    .where(eq(workspaceSkills.id, skillId))
    .returning();

  revalidatePath(`/w/[slug]/settings/skills`, "page");
  return skill;
}
