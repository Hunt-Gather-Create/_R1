"use server";

import { redirect } from "next/navigation";
import { db } from "../db";
import { inviteCodes, inviteCodeClaims, users } from "../db/schema";
import { eq, count } from "drizzle-orm";
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
 * Validate an invite code: exists, not expired, not exhausted, not already claimed by user.
 * Returns { valid, errorMessage }.
 * Uses a generic error message to prevent invite code enumeration.
 */
export async function validateInviteCode(
  token: string,
  userId?: string
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

  // Check maxUses limit
  if (code.maxUses !== null) {
    const [{ claimCount }] = await db
      .select({ claimCount: count() })
      .from(inviteCodeClaims)
      .where(eq(inviteCodeClaims.inviteCodeId, token));

    if (claimCount >= code.maxUses) {
      return { valid: false, errorMessage: "This invite code is invalid or has expired." };
    }
  }

  // Check if user already claimed this code
  if (userId) {
    const existingClaim = await db
      .select()
      .from(inviteCodeClaims)
      .where(eq(inviteCodeClaims.inviteCodeId, token))
      .all();

    const alreadyClaimed = existingClaim.some((c) => c.userId === userId);
    if (alreadyClaimed) {
      return { valid: false, errorMessage: "You have already used this invite code." };
    }
  }

  return { valid: true };
}

/**
 * Claim an invite code: validates the code and activates the user.
 * Uses a transaction to atomically activate the user and record the claim,
 * preventing race conditions where too many users claim the same code.
 * Requires authentication. Redirects to /projects on success.
 */
export async function claimInviteCode(token: string): Promise<void> {
  const user = await requireAuth();

  const { valid, errorMessage } = await validateInviteCode(token, user.id);
  if (!valid) {
    throw new Error(errorMessage ?? "Invalid invite code.");
  }

  // Atomically activate user and record the claim
  await db.transaction(async (tx) => {
    // Re-check maxUses inside transaction to prevent race conditions
    const code = await tx
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.id, token))
      .get();

    if (!code) {
      throw new Error("Invalid invite code.");
    }

    if (code.maxUses !== null) {
      const [{ claimCount }] = await tx
        .select({ claimCount: count() })
        .from(inviteCodeClaims)
        .where(eq(inviteCodeClaims.inviteCodeId, token));

      if (claimCount >= code.maxUses) {
        throw new Error("This invite code has reached its usage limit.");
      }
    }

    // Activate user if not already active
    if (user.status !== "active") {
      await tx
        .update(users)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(users.id, user.id));
    }

    await tx.insert(inviteCodeClaims).values({
      inviteCodeId: token,
      userId: user.id,
    });
  });

  redirect("/projects");
}

/**
 * Generate invite codes (for CLI / admin use).
 */
export async function generateInviteCodes(
  count: number,
  options?: { label?: string; expiresAt?: Date; maxUses?: number }
): Promise<InviteCode[]> {
  const codes: InviteCode[] = [];

  for (let i = 0; i < count; i++) {
    const id = crypto.randomUUID();
    const now = new Date();
    const code: InviteCode = {
      id,
      label: options?.label ?? null,
      maxUses: options?.maxUses ?? null,
      createdAt: now,
      expiresAt: options?.expiresAt ?? null,
    };
    await db.insert(inviteCodes).values(code);
    codes.push(code);
  }

  return codes;
}
