"use server";

import {
  getWorkspaceSocialAccount,
  ensureValidToken,
} from "./social-accounts";
import { requireWorkspaceAccess } from "./workspace";
import { getPlatformAdapter } from "@/lib/social/adapters";
import type { SocialPlatform } from "@/lib/types";

interface TestResult {
  success: boolean;
  data?: unknown;
  error?: string;
  durationMs: number;
}

/** Test getUserProfile for a connected platform */
export async function testGetProfile(
  workspaceId: string,
  platform: SocialPlatform
): Promise<TestResult> {
  await requireWorkspaceAccess(workspaceId);
  const start = Date.now();

  try {
    const account = await getWorkspaceSocialAccount(workspaceId, platform);
    if (!account) {
      return { success: false, error: "Account not connected", durationMs: Date.now() - start };
    }

    const accessToken = await ensureValidToken(account.id);
    if (!accessToken) {
      return { success: false, error: "Token expired or invalid", durationMs: Date.now() - start };
    }

    const adapter = getPlatformAdapter(platform);
    const profile = await adapter.getUserProfile(accessToken);

    return { success: true, data: profile, durationMs: Date.now() - start };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      durationMs: Date.now() - start,
    };
  }
}

/** Test listPosts for a connected platform */
export async function testListPosts(
  workspaceId: string,
  platform: SocialPlatform,
  limit: number = 5
): Promise<TestResult> {
  await requireWorkspaceAccess(workspaceId);
  const start = Date.now();

  try {
    const account = await getWorkspaceSocialAccount(workspaceId, platform);
    if (!account) {
      return { success: false, error: "Account not connected", durationMs: Date.now() - start };
    }

    const accessToken = await ensureValidToken(account.id);
    if (!accessToken) {
      return { success: false, error: "Token expired or invalid", durationMs: Date.now() - start };
    }

    const adapter = getPlatformAdapter(platform);
    const result = await adapter.listPosts(accessToken, { limit });

    return {
      success: true,
      data: {
        posts: result.posts,
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
        count: result.posts.length,
      },
      durationMs: Date.now() - start,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      durationMs: Date.now() - start,
    };
  }
}

/** Test getPost for a connected platform */
export async function testGetPost(
  workspaceId: string,
  platform: SocialPlatform,
  postId: string
): Promise<TestResult> {
  await requireWorkspaceAccess(workspaceId);
  const start = Date.now();

  try {
    const account = await getWorkspaceSocialAccount(workspaceId, platform);
    if (!account) {
      return { success: false, error: "Account not connected", durationMs: Date.now() - start };
    }

    const accessToken = await ensureValidToken(account.id);
    if (!accessToken) {
      return { success: false, error: "Token expired or invalid", durationMs: Date.now() - start };
    }

    const adapter = getPlatformAdapter(platform);
    const post = await adapter.getPost(accessToken, postId);

    if (!post) {
      return { success: false, error: "Post not found", durationMs: Date.now() - start };
    }

    return { success: true, data: post, durationMs: Date.now() - start };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      durationMs: Date.now() - start,
    };
  }
}
