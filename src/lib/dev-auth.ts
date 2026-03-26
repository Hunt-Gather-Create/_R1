import { db } from "@/lib/db";
import { users, workspaceMembers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * Dev-only auth bypass. When DEV_USER_EMAIL is set in development,
 * resolves the user from the database without WorkOS or JWT.
 */
export async function getDevUser() {
  if (process.env.NODE_ENV !== "development" || !process.env.DEV_USER_EMAIL) {
    return null;
  }

  return db
    .select()
    .from(users)
    .where(eq(users.email, process.env.DEV_USER_EMAIL))
    .get();
}

/**
 * Get the dev user's default workspace ID.
 * Uses DEV_WORKSPACE_ID if set, otherwise the user's first workspace.
 */
export async function getDevWorkspaceId(
  userId: string
): Promise<string | null> {
  if (process.env.DEV_WORKSPACE_ID) {
    return process.env.DEV_WORKSPACE_ID;
  }

  const membership = await db
    .select()
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId))
    .get();

  return membership?.workspaceId ?? null;
}
