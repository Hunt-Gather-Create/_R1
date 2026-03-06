import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "./api-keys";
import { db } from "./db";
import { apiKeys } from "./db/schema";
import { eq } from "drizzle-orm";

/**
 * Authenticate a request using a Bearer API key.
 * Extracts the key from the Authorization header, validates it,
 * and updates lastUsedAt.
 */
export async function authenticateApiKey(
  request: NextRequest
): Promise<
  | { workspaceId: string; apiKeyId: string }
  | NextResponse
> {
  const authHeader = request.headers.get("authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing or invalid Authorization header. Use: Bearer ak_..." },
      { status: 401 }
    );
  }

  const key = authHeader.slice(7); // Remove "Bearer "

  const result = await validateApiKey(key);

  if (!result) {
    return NextResponse.json(
      { error: "Invalid or expired API key" },
      { status: 401 }
    );
  }

  // Update lastUsedAt (non-blocking, don't fail auth if this errors)
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, result.apiKeyId))
    .catch(() => {});

  return result;
}

/**
 * Simple in-memory rate limiter per API key.
 * Uses a sliding window counter with per-minute limits.
 */
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 60; // requests per minute
const WINDOW_MS = 60_000;

export function checkRateLimit(
  apiKeyId: string
): NextResponse | null {
  const now = Date.now();
  const entry = rateLimitMap.get(apiKeyId);

  if (!entry || entry.resetAt < now) {
    rateLimitMap.set(apiKeyId, { count: 1, resetAt: now + WINDOW_MS });
    return null;
  }

  entry.count++;

  if (entry.count > RATE_LIMIT) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfter) },
      }
    );
  }

  return null;
}
