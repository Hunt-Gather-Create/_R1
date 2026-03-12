"use server";

import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { platformConnections } from "@/lib/db/schema";
import { requireWorkspaceAccess } from "./workspace";
import { getCurrentUserId } from "@/lib/auth";
import {
  SOCIAL_PLATFORMS,
  type PlatformKey,
  isValidPlatform,
} from "@/lib/mcp/platforms";
import {
  initiatePlatformConnection,
  getConnectionStatus,
  disconnectPlatform as smitheryDisconnect,
} from "@/lib/mcp/connect";

export type PlatformConnectionWithStatus = {
  platform: PlatformKey;
  name: string;
  description: string;
  icon: string;
  status:
    | "not_connected"
    | "pending"
    | "connected"
    | "auth_required"
    | "error";
  displayName?: string;
  errorMessage?: string;
};

/**
 * Get all platform connections for the current user in a workspace.
 */
export async function getUserPlatformConnections(
  workspaceId: string
): Promise<PlatformConnectionWithStatus[]> {
  await requireWorkspaceAccess(workspaceId);
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const connections = await db
    .select()
    .from(platformConnections)
    .where(
      and(
        eq(platformConnections.userId, userId),
        eq(platformConnections.workspaceId, workspaceId)
      )
    );

  const connectionMap = new Map(connections.map((c) => [c.platform, c]));

  return Object.values(SOCIAL_PLATFORMS).map((platform) => {
    const conn = connectionMap.get(platform.key);
    return {
      platform: platform.key as PlatformKey,
      name: platform.name,
      description: platform.description,
      icon: platform.icon,
      status:
        (conn?.status as PlatformConnectionWithStatus["status"]) ??
        "not_connected",
      displayName: conn?.displayName ?? undefined,
      errorMessage: conn?.errorMessage ?? undefined,
    };
  });
}

/**
 * Start connecting a platform. Returns an auth URL if OAuth is needed.
 */
export async function connectPlatform(
  workspaceId: string,
  platform: string
): Promise<{ success: boolean; authorizationUrl?: string; error?: string }> {
  await requireWorkspaceAccess(workspaceId);
  const userId = await getCurrentUserId();
  if (!userId) return { success: false, error: "Not authenticated" };

  if (!isValidPlatform(platform)) {
    return { success: false, error: "Invalid platform" };
  }

  try {
    const result = await initiatePlatformConnection(userId, platform);

    // Upsert the connection record
    const [existing] = await db
      .select()
      .from(platformConnections)
      .where(
        and(
          eq(platformConnections.userId, userId),
          eq(platformConnections.workspaceId, workspaceId),
          eq(platformConnections.platform, platform)
        )
      );

    const values = {
      userId,
      workspaceId,
      platform,
      connectionId: result.connectionId,
      status: result.status === "connected" ? "connected" : "pending",
      updatedAt: new Date(),
    };

    if (existing) {
      await db
        .update(platformConnections)
        .set(values)
        .where(eq(platformConnections.id, existing.id));
    } else {
      await db.insert(platformConnections).values({
        ...values,
        id: crypto.randomUUID(),
        createdAt: new Date(),
      });
    }

    revalidatePath(`/w/[slug]/settings/integrations`, "page");

    if (result.status === "auth_required") {
      return { success: true, authorizationUrl: result.authorizationUrl };
    }

    return { success: true };
  } catch (error) {
    console.error("Failed to connect platform:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Connection failed",
    };
  }
}

/**
 * Check and update the status of a platform connection.
 * Called after OAuth popup completes.
 */
export async function refreshPlatformStatus(
  workspaceId: string,
  platform: string
): Promise<{ status: string }> {
  await requireWorkspaceAccess(workspaceId);
  const userId = await getCurrentUserId();
  if (!userId) return { status: "error" };

  if (!isValidPlatform(platform)) {
    return { status: "error" };
  }

  const status = await getConnectionStatus(userId, platform);

  if (status === "not_found") {
    return { status: "not_connected" };
  }

  // Update DB
  await db
    .update(platformConnections)
    .set({
      status,
      errorMessage: status === "error" ? "Connection error" : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(platformConnections.userId, userId),
        eq(platformConnections.workspaceId, workspaceId),
        eq(platformConnections.platform, platform)
      )
    );

  revalidatePath(`/w/[slug]/settings/integrations`, "page");
  return { status };
}

/**
 * Disconnect a platform.
 */
export async function disconnectPlatformAction(
  workspaceId: string,
  platform: string
): Promise<{ success: boolean; error?: string }> {
  await requireWorkspaceAccess(workspaceId);
  const userId = await getCurrentUserId();
  if (!userId) return { success: false, error: "Not authenticated" };

  if (!isValidPlatform(platform)) {
    return { success: false, error: "Invalid platform" };
  }

  try {
    await smitheryDisconnect(userId, platform);

    await db.delete(platformConnections).where(
      and(
        eq(platformConnections.userId, userId),
        eq(platformConnections.workspaceId, workspaceId),
        eq(platformConnections.platform, platform)
      )
    );

    revalidatePath(`/w/[slug]/settings/integrations`, "page");
    return { success: true };
  } catch (error) {
    console.error("Failed to disconnect platform:", error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Disconnect failed",
    };
  }
}
