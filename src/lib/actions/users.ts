"use server";

import { db } from "../db";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import type { User } from "../types";

export interface WorkOSUserData {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
}

/**
 * Sync a user from WorkOS to the database.
 * Creates new user or updates existing one.
 */
export async function syncUserFromWorkOS(userData: WorkOSUserData): Promise<User> {
  const now = new Date();

  const existingUser = await db
    .select()
    .from(users)
    .where(eq(users.id, userData.id))
    .get();

  if (existingUser) {
    // Update existing user
    await db
      .update(users)
      .set({
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
        avatarUrl: userData.avatarUrl,
        updatedAt: now,
      })
      .where(eq(users.id, userData.id));

    return {
      ...existingUser,
      email: userData.email,
      firstName: userData.firstName,
      lastName: userData.lastName,
      avatarUrl: userData.avatarUrl,
      updatedAt: now,
    };
  }

  // Create new user
  const newUser: User = {
    id: userData.id,
    email: userData.email,
    firstName: userData.firstName,
    lastName: userData.lastName,
    avatarUrl: userData.avatarUrl,
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
  const user = await db.select().from(users).where(eq(users.email, email)).get();
  return user ?? null;
}
