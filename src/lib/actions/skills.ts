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
import { requireWorkspaceAccess } from "./workspace";

/**
 * Get workspace ID from a skill and verify access
 */
async function requireSkillAccess(
  skillId: string
): Promise<{ skill: WorkspaceSkill }> {
  const [skill] = await db
    .select()
    .from(workspaceSkills)
    .where(eq(workspaceSkills.id, skillId));

  if (!skill) {
    throw new Error("Skill not found");
  }

  await requireWorkspaceAccess(skill.workspaceId, "member");
  return { skill };
}

/**
 * Get all skills for a workspace
 */
export async function getWorkspaceSkills(
  workspaceId: string
): Promise<WorkspaceSkill[]> {
  await requireWorkspaceAccess(workspaceId);

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
  await requireWorkspaceAccess(workspaceId);

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
  await requireWorkspaceAccess(workspaceId, "admin");

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
      assets: input.assets ? JSON.stringify(input.assets) : null,
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
  const { skill: existing } = await requireSkillAccess(skillId);
  await requireWorkspaceAccess(existing.workspaceId, "admin");

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
  const { skill } = await requireSkillAccess(skillId);
  await requireWorkspaceAccess(skill.workspaceId, "admin");

  await db.delete(workspaceSkills).where(eq(workspaceSkills.id, skillId));
  revalidatePath(`/w/[slug]/settings/skills`, "page");
}

/**
 * Toggle a workspace skill on/off
 */
export async function toggleWorkspaceSkill(
  skillId: string
): Promise<WorkspaceSkill> {
  // Get current state and verify access
  const { skill: current } = await requireSkillAccess(skillId);
  await requireWorkspaceAccess(current.workspaceId, "admin");

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
