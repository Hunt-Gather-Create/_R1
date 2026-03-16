"use server";

import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { socialAccounts } from "@/lib/db/schema";
import { requireWorkspaceAccess } from "./workspace";
import { encryptToken, decryptToken } from "@/lib/social/token-encryption";
import { getPlatformAdapter } from "@/lib/social/adapters";
import type { SocialAccount, SocialPlatform } from "@/lib/types";

/** Safe subset of social account data for client-side use (no tokens) */
export type SocialAccountPublic = {
  id: string;
  workspaceId: string;
  platform: string;
  platformUserId: string | null;
  platformUsername: string | null;
  connectionStatus: string;
  scopes: string;
  tokenExpiresAt: Date | null;
  lastError: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

/** Get all connected social accounts for a workspace (safe projection, no tokens) */
export async function getWorkspaceSocialAccounts(
  workspaceId: string
): Promise<SocialAccountPublic[]> {
  await requireWorkspaceAccess(workspaceId);
  return db
    .select({
      id: socialAccounts.id,
      workspaceId: socialAccounts.workspaceId,
      platform: socialAccounts.platform,
      platformUserId: socialAccounts.platformUserId,
      platformUsername: socialAccounts.platformUsername,
      connectionStatus: socialAccounts.connectionStatus,
      scopes: socialAccounts.scopes,
      tokenExpiresAt: socialAccounts.tokenExpiresAt,
      lastError: socialAccounts.lastError,
      createdAt: socialAccounts.createdAt,
      updatedAt: socialAccounts.updatedAt,
    })
    .from(socialAccounts)
    .where(eq(socialAccounts.workspaceId, workspaceId));
}

/** Get a specific social account by platform for a workspace */
export async function getWorkspaceSocialAccount(
  workspaceId: string,
  platform: SocialPlatform
): Promise<SocialAccount | null> {
  const results = await db
    .select()
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.workspaceId, workspaceId),
        eq(socialAccounts.platform, platform)
      )
    )
    .limit(1);

  return results[0] ?? null;
}

/** Store a new social account after OAuth callback */
export async function createSocialAccount(data: {
  workspaceId: string;
  userId: string;
  platform: SocialPlatform;
  platformUserId: string;
  platformUsername: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  scopes: string[];
}): Promise<SocialAccount> {
  const accessTokenSealed = await encryptToken(data.accessToken);
  const refreshTokenSealed = data.refreshToken
    ? await encryptToken(data.refreshToken)
    : null;

  const now = new Date();

  const results = await db
    .insert(socialAccounts)
    .values({
      workspaceId: data.workspaceId,
      userId: data.userId,
      platform: data.platform,
      platformUserId: data.platformUserId,
      platformUsername: data.platformUsername,
      accessTokenSealed,
      refreshTokenSealed,
      tokenExpiresAt: data.tokenExpiresAt,
      scopes: JSON.stringify(data.scopes),
      connectionStatus: "connected",
      lastRefreshedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return results[0];
}

/** Update tokens after refresh or reconnect */
export async function updateSocialAccountTokens(
  accountId: string,
  tokens: {
    accessToken: string;
    refreshToken?: string;
    tokenExpiresAt?: Date;
    scopes?: string[];
    platformUserId?: string;
    platformUsername?: string;
  }
): Promise<void> {
  const accessTokenSealed = await encryptToken(tokens.accessToken);
  const refreshTokenSealed = tokens.refreshToken
    ? await encryptToken(tokens.refreshToken)
    : undefined;

  const now = new Date();

  await db
    .update(socialAccounts)
    .set({
      accessTokenSealed,
      ...(refreshTokenSealed !== undefined && { refreshTokenSealed }),
      ...(tokens.tokenExpiresAt !== undefined && {
        tokenExpiresAt: tokens.tokenExpiresAt,
      }),
      ...(tokens.scopes && { scopes: JSON.stringify(tokens.scopes) }),
      ...(tokens.platformUserId && {
        platformUserId: tokens.platformUserId,
      }),
      ...(tokens.platformUsername && {
        platformUsername: tokens.platformUsername,
      }),
      connectionStatus: "connected",
      lastRefreshedAt: now,
      lastError: null,
      updatedAt: now,
    })
    .where(eq(socialAccounts.id, accountId));
}

/** Disconnect a social account from a workspace */
export async function disconnectSocialAccount(
  workspaceId: string,
  platform: SocialPlatform
): Promise<void> {
  await requireWorkspaceAccess(workspaceId);
  await db
    .delete(socialAccounts)
    .where(
      and(
        eq(socialAccounts.workspaceId, workspaceId),
        eq(socialAccounts.platform, platform)
      )
    );
}

/**
 * Check token validity and attempt refresh if expired.
 * Returns the valid access token, or null if unable to get one.
 */
export async function ensureValidToken(
  accountId: string
): Promise<string | null> {
  const results = await db
    .select()
    .from(socialAccounts)
    .where(eq(socialAccounts.id, accountId))
    .limit(1);

  const account = results[0];
  if (!account) return null;

  // Check if token is still valid
  if (
    account.tokenExpiresAt &&
    account.tokenExpiresAt.getTime() < Date.now()
  ) {
    // Token expired — attempt refresh
    const refreshToken = account.refreshTokenSealed
      ? await decryptToken(account.refreshTokenSealed)
      : null;

    // For some platforms the "refresh token" is the current access token
    const tokenToRefresh =
      refreshToken || (await decryptToken(account.accessTokenSealed));

    try {
      const adapter = getPlatformAdapter(account.platform);
      const newTokens = await adapter.refreshAccessToken(tokenToRefresh);

      await updateSocialAccountTokens(accountId, {
        accessToken: newTokens.accessToken,
        refreshToken: newTokens.refreshToken,
        tokenExpiresAt: newTokens.expiresAt,
      });

      return newTokens.accessToken;
    } catch (error) {
      // Refresh failed — mark as expired
      console.error(
        `[Social] Token refresh failed for ${account.platform}:`,
        error
      );
      await db
        .update(socialAccounts)
        .set({
          connectionStatus: "expired",
          lastError:
            error instanceof Error ? error.message : "Token refresh failed",
          updatedAt: new Date(),
        })
        .where(eq(socialAccounts.id, accountId));

      return null;
    }
  }

  // Token is valid — decrypt and return
  try {
    return await decryptToken(account.accessTokenSealed);
  } catch {
    return null;
  }
}
