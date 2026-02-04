"use server";

import { revalidatePath } from "next/cache";
import { db } from "../db";
import { audiences, audienceMembers, workspaces, brands } from "../db/schema";
import { eq } from "drizzle-orm";
import type { Audience, AudienceMember, AudienceWithMembers } from "../types";
import type { CreateAudienceInput, AudienceMemberProfile } from "../schemas/audience-member";
import { requireWorkspaceAccess } from "./workspace";
import { deleteObject, getContent } from "../storage/r2-client";
import { inngest } from "../inngest/client";

/**
 * Get all audiences for a workspace
 */
export async function getWorkspaceAudiences(
  workspaceId: string
): Promise<Audience[]> {
  await requireWorkspaceAccess(workspaceId);

  const workspaceAudiences = await db
    .select()
    .from(audiences)
    .where(eq(audiences.workspaceId, workspaceId));

  return workspaceAudiences;
}

/**
 * Get an audience with its members
 */
export async function getAudienceWithMembers(
  audienceId: string
): Promise<AudienceWithMembers | null> {
  // First get the audience
  const audience = await db
    .select()
    .from(audiences)
    .where(eq(audiences.id, audienceId))
    .get();

  if (!audience) {
    return null;
  }

  // Verify workspace access
  await requireWorkspaceAccess(audience.workspaceId);

  // Get members
  const members = await db
    .select()
    .from(audienceMembers)
    .where(eq(audienceMembers.audienceId, audienceId));

  return {
    ...audience,
    members,
  };
}

/**
 * Get an audience by ID
 */
export async function getAudienceById(
  audienceId: string
): Promise<Audience | null> {
  const audience = await db
    .select()
    .from(audiences)
    .where(eq(audiences.id, audienceId))
    .get();

  if (!audience) {
    return null;
  }

  // Verify workspace access
  await requireWorkspaceAccess(audience.workspaceId);

  return audience;
}

/**
 * Create a new audience and trigger member generation
 */
export async function createAudience(
  input: CreateAudienceInput
): Promise<Audience> {
  await requireWorkspaceAccess(input.workspaceId, "admin");

  // Verify workspace has a brand configured
  const workspace = await db
    .select({ brandId: workspaces.brandId })
    .from(workspaces)
    .where(eq(workspaces.id, input.workspaceId))
    .get();

  if (!workspace?.brandId) {
    throw new Error("Workspace must have a brand configured to create audiences");
  }

  // Get brand details for generation
  const brand = await db
    .select()
    .from(brands)
    .where(eq(brands.id, workspace.brandId))
    .get();

  if (!brand) {
    throw new Error("Brand not found");
  }

  const now = new Date();
  const audienceId = crypto.randomUUID();

  const newAudience = {
    id: audienceId,
    workspaceId: input.workspaceId,
    name: input.name,
    description: input.description ?? null,
    generationStatus: "pending" as const,
    generationPrompt: input.generationPrompt,
    memberCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  const result = await db.insert(audiences).values(newAudience).returning();
  const audience = result[0];

  // Trigger background generation
  await inngest.send({
    name: "audience/members.generate",
    data: {
      audienceId: audience.id,
      workspaceId: input.workspaceId,
      brandId: brand.id,
      brandName: brand.name,
      brandIndustry: brand.industry ?? undefined,
      brandGuidelines: brand.guidelines ?? undefined,
      generationPrompt: input.generationPrompt,
      metadata: { description: `Generating audience: ${input.name}` },
    },
  });

  revalidatePath("/w");

  return audience;
}

/**
 * Delete an audience and all its members (including R2 profiles)
 */
export async function deleteAudience(audienceId: string): Promise<void> {
  const audience = await db
    .select()
    .from(audiences)
    .where(eq(audiences.id, audienceId))
    .get();

  if (!audience) {
    throw new Error("Audience not found");
  }

  await requireWorkspaceAccess(audience.workspaceId, "admin");

  // Get all members to delete their R2 profiles
  const members = await db
    .select()
    .from(audienceMembers)
    .where(eq(audienceMembers.audienceId, audienceId));

  // Delete R2 profiles (best effort)
  for (const member of members) {
    if (member.profileStorageKey) {
      try {
        await deleteObject(member.profileStorageKey);
      } catch (error) {
        console.error(`Failed to delete profile for member ${member.id}:`, error);
      }
    }
  }

  // Delete audience (members will cascade delete)
  await db.delete(audiences).where(eq(audiences.id, audienceId));

  revalidatePath("/w");
}

/**
 * Get full audience member profile from R2
 */
export async function getAudienceMemberProfile(
  memberId: string
): Promise<AudienceMemberProfile | null> {
  const member = await db
    .select()
    .from(audienceMembers)
    .where(eq(audienceMembers.id, memberId))
    .get();

  if (!member) {
    return null;
  }

  // Verify workspace access through audience
  const audience = await db
    .select()
    .from(audiences)
    .where(eq(audiences.id, member.audienceId))
    .get();

  if (!audience) {
    return null;
  }

  await requireWorkspaceAccess(audience.workspaceId);

  // Fetch from R2
  const content = await getContent(member.profileStorageKey);
  if (!content) {
    return null;
  }

  return JSON.parse(content) as AudienceMemberProfile;
}

/**
 * Get an audience member by ID (lightweight metadata only)
 */
export async function getAudienceMember(
  memberId: string
): Promise<AudienceMember | null> {
  const member = await db
    .select()
    .from(audienceMembers)
    .where(eq(audienceMembers.id, memberId))
    .get();

  if (!member) {
    return null;
  }

  // Verify workspace access through audience
  const audience = await db
    .select()
    .from(audiences)
    .where(eq(audiences.id, member.audienceId))
    .get();

  if (!audience) {
    return null;
  }

  await requireWorkspaceAccess(audience.workspaceId);

  return member;
}

/**
 * Get an audience member by ID, verifying it belongs to the specified workspace.
 * This is the secure version that prevents cross-workspace access via URL manipulation.
 */
export async function getAudienceMemberForWorkspace(
  memberId: string,
  workspaceId: string
): Promise<AudienceMember | null> {
  await requireWorkspaceAccess(workspaceId);

  const member = await db
    .select()
    .from(audienceMembers)
    .where(eq(audienceMembers.id, memberId))
    .get();

  if (!member) {
    return null;
  }

  // Verify member belongs to this workspace through audience
  const audience = await db
    .select()
    .from(audiences)
    .where(eq(audiences.id, member.audienceId))
    .get();

  if (!audience || audience.workspaceId !== workspaceId) {
    // Member exists but doesn't belong to this workspace
    return null;
  }

  return member;
}

/**
 * Get full audience member profile from R2, verifying it belongs to the specified workspace.
 * This is the secure version that prevents cross-workspace access via URL manipulation.
 */
export async function getAudienceMemberProfileForWorkspace(
  memberId: string,
  workspaceId: string
): Promise<AudienceMemberProfile | null> {
  await requireWorkspaceAccess(workspaceId);

  const member = await db
    .select()
    .from(audienceMembers)
    .where(eq(audienceMembers.id, memberId))
    .get();

  if (!member) {
    return null;
  }

  // Verify member belongs to this workspace through audience
  const audience = await db
    .select()
    .from(audiences)
    .where(eq(audiences.id, member.audienceId))
    .get();

  if (!audience || audience.workspaceId !== workspaceId) {
    // Member exists but doesn't belong to this workspace
    return null;
  }

  // Fetch from R2
  const content = await getContent(member.profileStorageKey);
  if (!content) {
    return null;
  }

  return JSON.parse(content) as AudienceMemberProfile;
}
