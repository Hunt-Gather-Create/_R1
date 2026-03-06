import { db } from "./db";
import { apiKeys } from "./db/schema";
import { eq } from "drizzle-orm";

const KEY_PREFIX = "ak_";
const KEY_LENGTH = 48;
const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Generate a new API key with hash and prefix.
 * Returns the plaintext key (shown once), its SHA-256 hash, and display prefix.
 */
export async function generateApiKey(): Promise<{
  key: string;
  keyHash: string;
  keyPrefix: string;
}> {
  // Generate random alphanumeric string
  const randomBytes = new Uint8Array(KEY_LENGTH);
  crypto.getRandomValues(randomBytes);
  const randomChars = Array.from(randomBytes, (b) => CHARSET[b % CHARSET.length]).join("");

  const key = `${KEY_PREFIX}${randomChars}`;
  const keyHash = await hashApiKey(key);
  const keyPrefix = key.slice(0, 8); // "ak_aBcD..."

  return { key, keyHash, keyPrefix };
}

/**
 * SHA-256 hash of an API key using Web Crypto API.
 */
export async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Validate an API key by looking up its prefix, then verifying the hash.
 * Returns workspace info if valid, null otherwise.
 */
export async function validateApiKey(
  key: string
): Promise<{ workspaceId: string; apiKeyId: string } | null> {
  if (!key.startsWith(KEY_PREFIX)) return null;

  const prefix = key.slice(0, 8);

  // Find keys matching this prefix
  const candidates = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyPrefix, prefix));

  if (candidates.length === 0) return null;

  const hash = await hashApiKey(key);

  for (const candidate of candidates) {
    if (candidate.keyHash === hash) {
      // Check expiry
      if (candidate.expiresAt && candidate.expiresAt < new Date()) {
        return null;
      }

      return {
        workspaceId: candidate.workspaceId,
        apiKeyId: candidate.id,
      };
    }
  }

  return null;
}
