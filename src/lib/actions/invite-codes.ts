"use server";

import { redirect } from "next/navigation";
import { db } from "../db";
import { inviteCodes, users } from "../db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "./workspace";
import type { InviteCode } from "../types";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Get an invite code by token (UUID).
 * Returns null if invalid format or not found.
 */
export async function getInviteCode(
  token: string
): Promise<InviteCode | null> {
  if (!UUID_REGEX.test(token)) return null;

  const code = await db
    .select()
    .from(inviteCodes)
    .where(eq(inviteCodes.id, token))
    .get();

  return code ?? null;
}

/**
 * Validate an invite code: exists and not expired.
 * Returns { valid, errorMessage }.
 * Uses a generic error message to prevent invite code enumeration.
 */
export async function validateInviteCode(
  token: string
): Promise<{ valid: boolean; errorMessage?: string }> {
  if (!UUID_REGEX.test(token)) {
    return { valid: false, errorMessage: "This invite code is invalid or has expired." };
  }

  const code = await getInviteCode(token);

  if (!code) {
    return { valid: false, errorMessage: "This invite code is invalid or has expired." };
  }

  if (code.expiresAt && code.expiresAt < new Date()) {
    return { valid: false, errorMessage: "This invite code is invalid or has expired." };
  }

  return { valid: true };
}

/**
 * Claim an invite code: validates the code and activates the user.
 * Uses a transaction to atomically activate the user and delete the code,
 * preventing race conditions where multiple users claim the same code.
 * Requires authentication. Redirects to /projects on success.
 */
export async function claimInviteCode(token: string): Promise<void> {
  const user = await requireAuth();

  // Already active — just redirect
  if (user.status === "active") {
    redirect("/projects");
  }

  const { valid, errorMessage } = await validateInviteCode(token);
  if (!valid) {
    throw new Error(errorMessage ?? "Invalid invite code.");
  }

  // Atomically activate user and consume the invite code
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(users.id, user.id));

    await tx.delete(inviteCodes).where(eq(inviteCodes.id, token));
  });

  redirect("/projects");
}

/**
 * Generate invite codes (for CLI / admin use).
 */
export async function generateInviteCodes(
  count: number,
  options?: { label?: string; expiresAt?: Date }
): Promise<InviteCode[]> {
  const codes: InviteCode[] = [];

  for (let i = 0; i < count; i++) {
    const id = crypto.randomUUID();
    const now = new Date();
    const code: InviteCode = {
      id,
      label: options?.label ?? null,
      createdAt: now,
      expiresAt: options?.expiresAt ?? null,
    };
    await db.insert(inviteCodes).values(code);
    codes.push(code);
  }

  return codes;
}
