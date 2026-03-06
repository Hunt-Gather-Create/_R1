"use server";

import { db } from "../db";
import { apiKeys } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { generateApiKey } from "../api-keys";
import { requireWorkspaceAccess } from "./workspace";
import type { ApiKey } from "../types";

/**
 * Create a new API key for a workspace.
 * Returns the plaintext key once — it cannot be retrieved again.
 */
export async function createApiKey(
  workspaceId: string,
  name: string,
  expiresAt?: Date
): Promise<{ key: string; apiKey: Omit<ApiKey, "keyHash"> }> {
  const { user } = await requireWorkspaceAccess(workspaceId, "admin");

  const { key, keyHash, keyPrefix } = await generateApiKey();

  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(apiKeys).values({
    id,
    workspaceId,
    name,
    keyHash,
    keyPrefix,
    expiresAt: expiresAt ?? null,
    createdBy: user.id,
    createdAt: now,
  });

  const apiKey = {
    id,
    workspaceId,
    name,
    keyPrefix,
    lastUsedAt: null,
    expiresAt: expiresAt ?? null,
    createdBy: user.id,
    createdAt: now,
  };

  return { key, apiKey };
}

/**
 * List API keys for a workspace (never exposes the hash).
 */
export async function listApiKeys(
  workspaceId: string
): Promise<Omit<ApiKey, "keyHash">[]> {
  await requireWorkspaceAccess(workspaceId);

  const keys = await db
    .select({
      id: apiKeys.id,
      workspaceId: apiKeys.workspaceId,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
      createdBy: apiKeys.createdBy,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.workspaceId, workspaceId))
    .orderBy(apiKeys.createdAt);

  return keys;
}

/**
 * Delete (revoke) an API key.
 */
export async function deleteApiKey(
  workspaceId: string,
  keyId: string
): Promise<void> {
  await requireWorkspaceAccess(workspaceId, "admin");

  await db
    .delete(apiKeys)
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.workspaceId, workspaceId)));
}
