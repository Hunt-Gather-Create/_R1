"use server";

import { db } from "../db";
import { users, workspaceMembers, workspaces } from "../db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "../auth";
import type { User, UpdateUserProfileInput, UserProfileWithWorkspaces } from "../types";

export interface WorkOSUserData {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
}

const AUTO_ACTIVE_DOMAINS = ["civilization.agency", "stabilization.hsc"];

function isAutoActiveDomain(email: string): boolean {
  const lastAt = email.lastIndexOf("@");
  if (lastAt === -1) return false;
  const domain = email.substring(lastAt + 1).toLowerCase();
  return AUTO_ACTIVE_DOMAINS.includes(domain);
}

/**
 * Sync a user from WorkOS to the database.
 * Creates new user or updates existing one.
 */
export async function syncUserFromWorkOS(
  userData: WorkOSUserData
): Promise<User> {
  const now = new Date();

  const existingUser = await db
    .select()
    .from(users)
    .where(eq(users.id, userData.id))
    .get();

  if (existingUser) {
    // Auto-upgrade waitlisted users with allowlisted email domains
    const status =
      existingUser.status === "waitlisted" && isAutoActiveDomain(userData.email)
        ? "active"
        : existingUser.status;

    await db
      .update(users)
      .set({
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
        avatarUrl: userData.avatarUrl,
        status,
        updatedAt: now,
      })
      .where(eq(users.id, userData.id));

    return {
      ...existingUser,
      email: userData.email,
      firstName: userData.firstName,
      lastName: userData.lastName,
      avatarUrl: userData.avatarUrl,
      status,
      updatedAt: now,
    };
  }

  // Auto-activate new users with allowlisted email domains
  const status = isAutoActiveDomain(userData.email) ? "active" : "waitlisted";

  const newUser: User = {
    id: userData.id,
    email: userData.email,
    firstName: userData.firstName,
    lastName: userData.lastName,
    avatarUrl: userData.avatarUrl,
    status,
    role: null,
    bio: null,
    aiCommunicationStyle: null,
    aiCustomInstructions: null,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(users).values(newUser);

  return newUser;
}

/**
 * Get a user by ID.
 */
export async function getUserById(userId: string): Promise<User | null> {
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  return user ?? null;
}

/**
 * Get a user by email.
 */
export async function getUserByEmail(email: string): Promise<User | null> {
  const user = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .get();
  return user ?? null;
}

/**
 * Get the current user's profile with workspace memberships.
 */
export async function getUserProfile(): Promise<UserProfileWithWorkspaces | null> {
  const authUser = await getCurrentUser();
  if (!authUser) return null;

  const [user, memberships] = await Promise.all([
    db.select().from(users).where(eq(users.id, authUser.id)).get(),
    db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
        purpose: workspaces.purpose,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(eq(workspaceMembers.userId, authUser.id)),
  ]);

  if (!user) return null;

  return {
    ...user,
    workspaces: memberships,
  };
}

/**
 * Update the current user's profile fields.
 */
export async function updateUserProfile(
  data: UpdateUserProfileInput
): Promise<{ success: boolean; message: string }> {
  const authUser = await getCurrentUser();
  if (!authUser) {
    return { success: false, message: "Not authenticated" };
  }

  const now = new Date();

  await db
    .update(users)
    .set({
      ...(data.role !== undefined && { role: data.role }),
      ...(data.bio !== undefined && { bio: data.bio }),
      ...(data.aiCommunicationStyle !== undefined && {
        aiCommunicationStyle: data.aiCommunicationStyle,
      }),
      ...(data.aiCustomInstructions !== undefined && {
        aiCustomInstructions: data.aiCustomInstructions,
      }),
      updatedAt: now,
    })
    .where(eq(users.id, authUser.id));

  revalidatePath("/profile");

  return { success: true, message: "Profile updated" };
}
