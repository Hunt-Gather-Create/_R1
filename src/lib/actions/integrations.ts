"use server";

import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { workspaceMcpServers } from "@/lib/db/schema";
import {
  MCP_SERVERS,
  type McpServerKey,
  getAllMcpServers,
  testServerConnection,
} from "@/lib/mcp";

/**
 * MCP server definition with current enabled status and connection state.
 * Used in the integrations settings UI.
 */
export type McpServerWithStatus = {
  key: string;
  name: string;
  description: string;
  icon: string;
  isEnabled: boolean;
  status?: "connected" | "error" | null;
  errorMessage?: string;
};

/**
 * Get all MCP servers available for a workspace with their enabled status
 */
export async function getWorkspaceMcpServers(
  workspaceId: string
): Promise<McpServerWithStatus[]> {
  // Get all available servers
  const availableServers = getAllMcpServers();

  // Get enabled servers from DB
  const enabledRecords = await db
    .select()
    .from(workspaceMcpServers)
    .where(eq(workspaceMcpServers.workspaceId, workspaceId));

  const enabledMap = new Map(
    enabledRecords.map((r) => [r.serverKey, r.isEnabled])
  );

  // Build response with status info
  const result: McpServerWithStatus[] = [];

  for (const server of availableServers) {
    const isEnabled = enabledMap.get(server.key) ?? false;

    const serverWithStatus: McpServerWithStatus = {
      key: server.key,
      name: server.name,
      description: server.description,
      icon: server.icon,
      isEnabled,
    };

    // Test connection if enabled
    if (isEnabled) {
      const connectionTest = await testServerConnection(server.key as McpServerKey);
      serverWithStatus.status = connectionTest.connected ? "connected" : "error";
      if (!connectionTest.connected) {
        serverWithStatus.errorMessage = connectionTest.error;
      }
    }

    result.push(serverWithStatus);
  }

  return result;
}

/**
 * Enable an MCP server for a workspace
 */
export async function enableMcpServer(
  workspaceId: string,
  serverKey: string
): Promise<{
  success: boolean;
  status?: "connected" | "error";
  error?: string;
}> {
  // Validate server key
  if (!(serverKey in MCP_SERVERS)) {
    return { success: false, error: "Invalid server key" };
  }

  try {
    // Test connection first
    const connectionTest = await testServerConnection(serverKey as McpServerKey);

    // Check if we have an existing record
    const [existing] = await db
      .select()
      .from(workspaceMcpServers)
      .where(
        and(
          eq(workspaceMcpServers.workspaceId, workspaceId),
          eq(workspaceMcpServers.serverKey, serverKey)
        )
      );

    if (existing) {
      // Update existing record
      await db
        .update(workspaceMcpServers)
        .set({
          isEnabled: true,
          updatedAt: new Date(),
        })
        .where(eq(workspaceMcpServers.id, existing.id));
    } else {
      // Create new record
      await db.insert(workspaceMcpServers).values({
        id: crypto.randomUUID(),
        workspaceId,
        serverKey,
        isEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    revalidatePath(`/w/[slug]/settings/integrations`, "page");

    return {
      success: true,
      status: connectionTest.connected ? "connected" : "error",
      error: connectionTest.error,
    };
  } catch (error) {
    console.error("Failed to enable MCP server:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to enable server",
    };
  }
}

/**
 * Disable an MCP server for a workspace
 */
export async function disableMcpServer(
  workspaceId: string,
  serverKey: string
): Promise<{ success: boolean; error?: string }> {
  // Validate server key
  if (!(serverKey in MCP_SERVERS)) {
    return { success: false, error: "Invalid server key" };
  }

  try {
    // Update DB record to disabled
    const [existing] = await db
      .select()
      .from(workspaceMcpServers)
      .where(
        and(
          eq(workspaceMcpServers.workspaceId, workspaceId),
          eq(workspaceMcpServers.serverKey, serverKey)
        )
      );

    if (existing) {
      await db
        .update(workspaceMcpServers)
        .set({
          isEnabled: false,
          updatedAt: new Date(),
        })
        .where(eq(workspaceMcpServers.id, existing.id));
    }

    revalidatePath(`/w/[slug]/settings/integrations`, "page");

    return { success: true };
  } catch (error) {
    console.error("Failed to disable MCP server:", error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to disable server",
    };
  }
}

/**
 * Toggle an MCP server's enabled status
 */
export async function toggleMcpServer(
  workspaceId: string,
  serverKey: string
): Promise<{
  success: boolean;
  isEnabled?: boolean;
  status?: "connected" | "error";
  error?: string;
}> {
  // Get current state
  const [existing] = await db
    .select()
    .from(workspaceMcpServers)
    .where(
      and(
        eq(workspaceMcpServers.workspaceId, workspaceId),
        eq(workspaceMcpServers.serverKey, serverKey)
      )
    );

  const currentlyEnabled = existing?.isEnabled ?? false;

  if (currentlyEnabled) {
    const result = await disableMcpServer(workspaceId, serverKey);
    return { ...result, isEnabled: false };
  } else {
    const result = await enableMcpServer(workspaceId, serverKey);
    return { ...result, isEnabled: result.success };
  }
}
