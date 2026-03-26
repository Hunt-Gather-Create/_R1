import { db } from "@/lib/db";
import { mcpAuthorizationCodes, mcpRefreshTokens } from "@/lib/db/schema";
import { eq, lt } from "drizzle-orm";
import { createAccessToken } from "./token";

/**
 * Generate a cryptographically random string for codes and tokens.
 */
function generateRandomString(length: number = 64): string {
  let result = "";

  while (result.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    result += btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  return result.slice(0, length);
}

/**
 * Validate PKCE S256 code verifier against a challenge.
 */
async function validatePKCE(
  codeVerifier: string,
  codeChallenge: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const base64url = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return base64url === codeChallenge;
}

/**
 * Create an authorization code and store it in the database.
 */
export async function createAuthorizationCode(
  userId: string,
  workspaceId: string | null,
  clientId: string,
  redirectUri: string,
  codeChallenge: string,
  codeChallengeMethod: string
): Promise<string> {
  const code = generateRandomString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await db.insert(mcpAuthorizationCodes).values({
    code,
    userId,
    workspaceId,
    clientId,
    redirectUri,
    codeChallenge,
    codeChallengeMethod,
    expiresAt,
  });

  return code;
}

/**
 * Exchange an authorization code for access and refresh tokens.
 * Validates PKCE and deletes the code after use.
 */
export async function exchangeAuthorizationCode(
  code: string,
  clientId: string,
  redirectUri: string,
  codeVerifier: string
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const authCode = await db
    .select()
    .from(mcpAuthorizationCodes)
    .where(eq(mcpAuthorizationCodes.code, code))
    .get();

  if (!authCode) {
    throw new Error("Invalid authorization code");
  }

  // Delete code immediately (single use)
  await db
    .delete(mcpAuthorizationCodes)
    .where(eq(mcpAuthorizationCodes.code, code));

  // Check expiry
  if (authCode.expiresAt < new Date()) {
    throw new Error("Authorization code expired");
  }

  // Validate client and redirect
  if (authCode.clientId !== clientId) {
    throw new Error("Client ID mismatch");
  }

  if (authCode.redirectUri !== redirectUri) {
    throw new Error("Redirect URI mismatch");
  }

  // Validate PKCE
  const isValid = await validatePKCE(codeVerifier, authCode.codeChallenge);
  if (!isValid) {
    throw new Error("Invalid code verifier (PKCE validation failed)");
  }

  // Create tokens
  const accessToken = await createAccessToken(
    authCode.userId,
    authCode.workspaceId
  );
  const refreshToken = generateRandomString();
  const refreshExpiresAt = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000
  ); // 30 days

  await db.insert(mcpRefreshTokens).values({
    token: refreshToken,
    userId: authCode.userId,
    workspaceId: authCode.workspaceId,
    clientId,
    expiresAt: refreshExpiresAt,
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: 3600,
  };
}

/**
 * Refresh an access token using a refresh token.
 * Issues a new refresh token and revokes the old one (rotation).
 */
export async function refreshAccessToken(
  refreshTokenValue: string,
  clientId: string
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const existing = await db
    .select()
    .from(mcpRefreshTokens)
    .where(eq(mcpRefreshTokens.token, refreshTokenValue))
    .get();

  if (!existing) {
    throw new Error("Invalid refresh token");
  }

  if (existing.expiresAt < new Date()) {
    await db
      .delete(mcpRefreshTokens)
      .where(eq(mcpRefreshTokens.token, refreshTokenValue));
    throw new Error("Refresh token expired");
  }

  if (existing.clientId !== clientId) {
    throw new Error("Client ID mismatch");
  }

  // Rotate: delete old, create new
  await db
    .delete(mcpRefreshTokens)
    .where(eq(mcpRefreshTokens.token, refreshTokenValue));

  const accessToken = await createAccessToken(
    existing.userId,
    existing.workspaceId
  );
  const newRefreshToken = generateRandomString();
  const refreshExpiresAt = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000
  );

  await db.insert(mcpRefreshTokens).values({
    token: newRefreshToken,
    userId: existing.userId,
    workspaceId: existing.workspaceId,
    clientId,
    expiresAt: refreshExpiresAt,
  });

  return {
    accessToken,
    refreshToken: newRefreshToken,
    expiresIn: 3600,
  };
}

/**
 * Revoke a refresh token.
 */
export async function revokeRefreshToken(token: string): Promise<void> {
  await db.delete(mcpRefreshTokens).where(eq(mcpRefreshTokens.token, token));
}

/**
 * Clean up expired authorization codes and refresh tokens.
 */
export async function cleanupExpiredTokens(): Promise<void> {
  const now = new Date();
  await db
    .delete(mcpAuthorizationCodes)
    .where(lt(mcpAuthorizationCodes.expiresAt, now));
  await db
    .delete(mcpRefreshTokens)
    .where(lt(mcpRefreshTokens.expiresAt, now));
}
