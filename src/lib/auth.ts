"use server";

import { cache } from "react";
import { cookies } from "next/headers";
import { unsealData } from "iron-session";
import { isNextSentinelError } from "@/lib/utils/is-next-sentinel-error";

// WorkOS uses these env vars
const WORKOS_COOKIE_NAME = process.env.WORKOS_COOKIE_NAME || "wos-session";
const WORKOS_COOKIE_PASSWORD = process.env.WORKOS_COOKIE_PASSWORD || "";

interface WorkOSUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  profilePictureUrl: string | null;
}

interface Session {
  accessToken: string;
  refreshToken: string;
  user: WorkOSUser;
  impersonator?: {
    email: string;
    reason: string | null;
  };
}

/**
 * Get session from cookie - matches WorkOS's internal implementation
 */
async function getSessionFromCookie(): Promise<Session | null> {
  try {
    const cookieStore = await cookies();
    const cookie = cookieStore.get(WORKOS_COOKIE_NAME);

    if (!cookie?.value) {
      return null;
    }

    const session = await unsealData<Session>(cookie.value, {
      password: WORKOS_COOKIE_PASSWORD,
    });

    return session;
  } catch (error) {
    // Re-throw Next.js internal sentinel errors (DYNAMIC_SERVER_USAGE,
    // NEXT_REDIRECT, NEXT_NOT_FOUND, NEXT_HTTP_ERROR_FALLBACK, etc.)
    // so Next's static-bailout / control-flow mechanisms work correctly.
    // See `isNextSentinelError` for the exact digest contract.
    if (isNextSentinelError(error)) {
      throw error;
    }
    console.error("Failed to decrypt session:", error);
    return null;
  }
}

/**
 * Get the current authenticated user.
 * Returns null if not authenticated.
 * Wrapped with React.cache() to deduplicate calls within a single request.
 */
export const getCurrentUser = cache(async (): Promise<WorkOSUser | null> => {
  const session = await getSessionFromCookie();
  return session?.user ?? null;
});

/**
 * Get the current authenticated user's ID.
 * Returns null if not authenticated.
 * Wrapped with React.cache() to deduplicate calls within a single request.
 */
export const getCurrentUserId = cache(async (): Promise<string | null> => {
  const user = await getCurrentUser();
  return user?.id ?? null;
});
