"use server";

import { cache } from "react";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "../db";
import {
  workspaces,
  workspaceMembers,
  columns,
  labels,
  users,
  issues,
} from "../db/schema";
import { eq, and, asc, inArray } from "drizzle-orm";
import type {
  Workspace,
  WorkspaceMember,
  WorkspaceMemberWithUser,
  WorkspaceRole,
  User,
} from "../types";
import { getCurrentUser } from "../auth";
import { syncUserFromWorkOS } from "./users";
import {
  PURPOSE_CONFIG,
  type WorkspacePurpose,
  type TemplateWorkspacePurpose,
  type Status,
} from "../design-tokens";

/**
 * Get the current authenticated user or redirect to auth
 */
export async function requireAuth(): Promise<User> {
  const authUser = await getCurrentUser();

  if (!authUser) {
    redirect("/login");
  }

  // Sync user to database if needed
  const dbUser = await syncUserFromWorkOS({
    id: authUser.id,
    email: authUser.email,
    firstName: authUser.firstName ?? null,
    lastName: authUser.lastName ?? null,
    avatarUrl: authUser.profilePictureUrl ?? null,
  });

  return dbUser;
}

/**
 * Check if user has access to workspace with optional minimum role.
 * Wrapped with React.cache() to deduplicate within a single request.
 */
export const requireWorkspaceAccess = cache(
  async (
    workspaceId: string,
    minimumRole?: WorkspaceRole
  ): Promise<{ user: User; member: WorkspaceMember; workspace: Workspace }> => {
    const user = await requireAuth();

    const member = await db
      .select()
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, user.id)
        )
      )
      .get();

    if (!member) {
      throw new Error("Access denied: You are not a member of this workspace");
    }

    const workspace = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .get();

    if (!workspace) {
      throw new Error("Workspace not found");
    }

    // Check role hierarchy if minimum role specified
    if (minimumRole) {
      const roleHierarchy: Record<WorkspaceRole, number> = {
        viewer: 0,
        member: 1,
        admin: 2,
      };

      if (
        roleHierarchy[member.role as WorkspaceRole] < roleHierarchy[minimumRole]
      ) {
        throw new Error(
          `Access denied: Requires ${minimumRole} role or higher`
        );
      }
    }

    return { user, member, workspace };
  }
);

/**
 * Generate a URL-friendly slug from a name
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

/**
 * Create a new workspace with template-based columns
 */
export async function createWorkspace(
  name: string,
  purpose: TemplateWorkspacePurpose = "software"
): Promise<Workspace> {
  const user = await requireAuth();
  const now = new Date();

  // Generate unique slug
  let slug = generateSlug(name);
  let slugSuffix = 0;
  let existingSlug = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, slug))
    .get();

  while (existingSlug) {
    slugSuffix++;
    slug = `${generateSlug(name)}-${slugSuffix}`;
    existingSlug = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.slug, slug))
      .get();
  }

  const workspaceId = crypto.randomUUID();
  const config = PURPOSE_CONFIG[purpose];

  const newWorkspace: Workspace = {
    id: workspaceId,
    name,
    slug,
    identifier: name
      .toUpperCase()
      .slice(0, 4)
      .replace(/[^A-Z]/g, "A"),
    issueCounter: 0,
    purpose,
    soul: null,
    brandId: null,
    primaryColor: null,
    ownerId: user.id,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(workspaces).values(newWorkspace);

  // Add creator as admin member
  await db.insert(workspaceMembers).values({
    workspaceId,
    userId: user.id,
    role: "admin",
    createdAt: now,
  });

  // Create default columns based on purpose
  for (let i = 0; i < config.defaultColumns.length; i++) {
    const col = config.defaultColumns[i];
    await db.insert(columns).values({
      id: crypto.randomUUID(),
      workspaceId,
      name: col.name,
      position: i,
      status: col.status,
    });
  }

  // Create default labels based on purpose
  for (const label of config.defaultLabels) {
    await db.insert(labels).values({
      id: crypto.randomUUID(),
      workspaceId,
      name: label.name,
      color: label.color,
      createdAt: now,
    });
  }

  revalidatePath("/");

  return newWorkspace;
}

/**
 * Create a custom workspace with user-defined columns, labels, and starter issues
 */
export async function createCustomWorkspace(
  name: string,
  customColumns: Array<{ name: string; status: Status | null }>,
  customLabels: Array<{ name: string; color: string }>,
  suggestedIssues?: Array<{ title: string; description?: string }>
): Promise<Workspace> {
  const user = await requireAuth();
  const now = new Date();

  // Validate columns
  if (customColumns.length < 2 || customColumns.length > 8) {
    throw new Error("Workspace must have between 2 and 8 columns");
  }

  // Generate unique slug
  let slug = generateSlug(name);
  let slugSuffix = 0;
  let existingSlug = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, slug))
    .get();

  while (existingSlug) {
    slugSuffix++;
    slug = `${generateSlug(name)}-${slugSuffix}`;
    existingSlug = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.slug, slug))
      .get();
  }

  const workspaceId = crypto.randomUUID();
  const identifier = name
    .toUpperCase()
    .slice(0, 4)
    .replace(/[^A-Z]/g, "A");

  const newWorkspace: Workspace = {
    id: workspaceId,
    name,
    slug,
    identifier,
    issueCounter: 0,
    purpose: "custom",
    soul: null,
    brandId: null,
    primaryColor: null,
    ownerId: user.id,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(workspaces).values(newWorkspace);

  // Add creator as admin member
  await db.insert(workspaceMembers).values({
    workspaceId,
    userId: user.id,
    role: "admin",
    createdAt: now,
  });

  // Create custom columns and track their IDs
  const columnIds: Array<{ id: string; status: Status | null }> = [];
  for (let i = 0; i < customColumns.length; i++) {
    const col = customColumns[i];
    const columnId = crypto.randomUUID();
    await db.insert(columns).values({
      id: columnId,
      workspaceId,
      name: col.name,
      position: i,
      status: col.status,
    });
    columnIds.push({ id: columnId, status: col.status });
  }

  // Create custom labels
  for (const label of customLabels) {
    await db.insert(labels).values({
      id: crypto.randomUUID(),
      workspaceId,
      name: label.name,
      color: label.color,
      createdAt: now,
    });
  }

  // Create suggested issues if provided
  if (suggestedIssues && suggestedIssues.length > 0) {
    // Find the first column with "backlog" or "todo" status, or use the first column
    const targetColumn =
      columnIds.find((c) => c.status === "backlog") ||
      columnIds.find((c) => c.status === "todo") ||
      columnIds[0];

    let issueCounter = 0;
    for (let i = 0; i < suggestedIssues.length; i++) {
      const issue = suggestedIssues[i];
      issueCounter++;
      await db.insert(issues).values({
        id: crypto.randomUUID(),
        columnId: targetColumn.id,
        identifier: `${identifier}-${issueCounter}`,
        title: issue.title,
        description: issue.description || null,
        status: targetColumn.status || "backlog",
        priority: 4, // none
        position: i,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Update workspace issue counter
    await db
      .update(workspaces)
      .set({ issueCounter })
      .where(eq(workspaces.id, workspaceId));

    newWorkspace.issueCounter = issueCounter;
  }

  revalidatePath("/");

  return newWorkspace;
}

/**
 * Get all workspaces for the current user
 */
export async function getUserWorkspaces(): Promise<Workspace[]> {
  const user = await requireAuth();

  const userMemberships = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, user.id));

  if (userMemberships.length === 0) {
    return [];
  }

  const workspaceIds = userMemberships.map((m) => m.workspaceId);

  // Fetch all workspaces in a single query using inArray
  const userWorkspaces = await db
    .select()
    .from(workspaces)
    .where(inArray(workspaces.id, workspaceIds));

  return userWorkspaces.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get workspace by slug
 */
export async function getWorkspaceBySlug(
  slug: string
): Promise<Workspace | null> {
  const workspace = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, slug))
    .get();

  return workspace ?? null;
}

/**
 * Get workspace by ID
 */
export async function getWorkspaceById(
  workspaceId: string
): Promise<Workspace | null> {
  const workspace = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .get();

  return workspace ?? null;
}

/**
 * Get user's default (first) workspace
 */
export async function getUserDefaultWorkspace(): Promise<Workspace | null> {
  const workspaceList = await getUserWorkspaces();
  return workspaceList[0] ?? null;
}

/**
 * Get workspace members with user info
 */
export async function getWorkspaceMembers(
  workspaceId: string
): Promise<WorkspaceMemberWithUser[]> {
  await requireWorkspaceAccess(workspaceId);

  const members = await db
    .select()
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(workspaceMembers.createdAt));

  if (members.length === 0) {
    return [];
  }

  // Fetch all users in a single query using inArray
  const userIds = members.map((m) => m.userId);
  const userList = await db
    .select()
    .from(users)
    .where(inArray(users.id, userIds));

  // Build a map for O(1) lookup
  const userMap = new Map(userList.map((u) => [u.id, u]));

  // Combine members with their users
  return members
    .map((member) => {
      const user = userMap.get(member.userId);
      if (!user) return null;
      return { ...member, user };
    })
    .filter((m): m is WorkspaceMemberWithUser => m !== null);
}

/**
 * Invite a member to workspace by email
 */
export async function inviteMember(
  workspaceId: string,
  email: string,
  role: WorkspaceRole = "member"
): Promise<{ success: boolean; message: string }> {
  await requireWorkspaceAccess(workspaceId, "admin");

  // Find user by email
  const user = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .get();

  if (!user) {
    return {
      success: false,
      message: "User not found. They must sign up first.",
    };
  }

  // Check if already a member
  const existingMember = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, user.id)
      )
    )
    .get();

  if (existingMember) {
    return {
      success: false,
      message: "User is already a member of this workspace.",
    };
  }

  // Add as member
  await db.insert(workspaceMembers).values({
    workspaceId,
    userId: user.id,
    role,
    createdAt: new Date(),
  });

  revalidatePath(`/w/${workspaceId}`);

  return {
    success: true,
    message: `${user.firstName || user.email} has been added to the workspace.`,
  };
}

/**
 * Remove a member from workspace
 */
export async function removeMember(
  workspaceId: string,
  userId: string
): Promise<void> {
  const { workspace } = await requireWorkspaceAccess(workspaceId, "admin");

  // Cannot remove the owner
  if (workspace.ownerId === userId) {
    throw new Error("Cannot remove the workspace owner");
  }

  await db
    .delete(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId)
      )
    );

  revalidatePath(`/w/${workspaceId}`);
}

/**
 * Update a member's role
 */
export async function updateMemberRole(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole
): Promise<void> {
  const { workspace } = await requireWorkspaceAccess(workspaceId, "admin");

  // Cannot change owner's role
  if (workspace.ownerId === userId) {
    throw new Error("Cannot change the workspace owner's role");
  }

  await db
    .update(workspaceMembers)
    .set({ role })
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId)
      )
    );

  revalidatePath(`/w/${workspaceId}`);
}

/**
 * Update workspace details
 */
export async function updateWorkspace(
  workspaceId: string,
  data: { name?: string; identifier?: string }
): Promise<void> {
  await requireWorkspaceAccess(workspaceId, "admin");

  const updates: Partial<Workspace> = {
    updatedAt: new Date(),
  };

  if (data.name !== undefined) {
    updates.name = data.name;
  }

  if (data.identifier !== undefined) {
    updates.identifier = data.identifier.toUpperCase();
  }

  await db
    .update(workspaces)
    .set(updates)
    .where(eq(workspaces.id, workspaceId));

  revalidatePath(`/w/${workspaceId}`);
}

/**
 * Update workspace settings (name, slug, and/or purpose)
 */
export async function updateWorkspaceSettings(
  workspaceId: string,
  data: { name?: string; slug?: string; purpose?: WorkspacePurpose }
): Promise<{ success: boolean; message: string; newSlug?: string }> {
  await requireWorkspaceAccess(workspaceId, "admin");

  const updates: Partial<Workspace> = {
    updatedAt: new Date(),
  };

  if (data.name !== undefined && data.name.trim()) {
    updates.name = data.name.trim();
  }

  if (data.slug !== undefined) {
    // Normalize slug: lowercase, alphanumeric + hyphens only
    const normalizedSlug = data.slug
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50);

    if (!normalizedSlug) {
      return { success: false, message: "URL slug cannot be empty" };
    }

    // Check if slug is already taken by another workspace
    const existingWorkspace = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.slug, normalizedSlug))
      .get();

    if (existingWorkspace && existingWorkspace.id !== workspaceId) {
      return { success: false, message: "This URL is already taken" };
    }

    updates.slug = normalizedSlug;
  }

  if (data.purpose !== undefined) {
    updates.purpose = data.purpose;
  }

  await db
    .update(workspaces)
    .set(updates)
    .where(eq(workspaces.id, workspaceId));

  revalidatePath("/");

  return {
    success: true,
    message: "Workspace settings updated",
    newSlug: updates.slug,
  };
}

/**
 * Delete a workspace (owner only)
 */
export async function deleteWorkspace(workspaceId: string): Promise<void> {
  const { user, workspace } = await requireWorkspaceAccess(
    workspaceId,
    "admin"
  );

  if (workspace.ownerId !== user.id) {
    throw new Error("Only the workspace owner can delete the workspace");
  }

  // Cascade delete will handle columns, labels, issues, etc.
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));

  revalidatePath("/");
}
