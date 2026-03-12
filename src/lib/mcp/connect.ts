/**
 * Smithery Connect integration layer.
 * Uses createConnection() from @smithery/api/mcp which auto-manages
 * namespaces and handles OAuth orchestration with upstream MCP servers.
 * Only requires SMITHERY_API_KEY — no manual namespace setup needed.
 */

import Smithery from "@smithery/api";
import {
  createConnection,
  SmitheryAuthorizationError,
} from "@smithery/api/mcp";
import { createMCPClient } from "@ai-sdk/mcp";
import type { ToolSet } from "ai";
import {
  type PlatformKey,
  getPlatformMcpUrl,
} from "./platforms";

/**
 * Build a deterministic connection ID for a user-platform pair.
 */
export function buildConnectionId(
  userId: string,
  platform: PlatformKey
): string {
  return `${userId}-${platform}`;
}

export type ConnectionResult =
  | { status: "connected"; connectionId: string }
  | {
      status: "auth_required";
      authorizationUrl: string;
      connectionId: string;
    };

/**
 * Initiate a platform connection via Smithery Connect.
 * createConnection auto-creates namespaces and connections as needed.
 * Returns either a connected status or an authorization URL for OAuth.
 */
export async function initiatePlatformConnection(
  userId: string,
  platform: PlatformKey
): Promise<ConnectionResult> {
  const connectionId = buildConnectionId(userId, platform);
  const mcpUrl = getPlatformMcpUrl(platform);

  try {
    await createConnection({ connectionId, mcpUrl });
    return { status: "connected", connectionId };
  } catch (error) {
    if (error instanceof SmitheryAuthorizationError) {
      return {
        status: "auth_required",
        authorizationUrl: error.authorizationUrl,
        connectionId: error.connectionId,
      };
    }
    throw error;
  }
}

/**
 * Get the current status of a platform connection.
 */
export async function getConnectionStatus(
  userId: string,
  platform: PlatformKey
): Promise<"connected" | "auth_required" | "error" | "not_found"> {
  const connectionId = buildConnectionId(userId, platform);
  const mcpUrl = getPlatformMcpUrl(platform);

  try {
    await createConnection({ connectionId, mcpUrl });
    return "connected";
  } catch (error) {
    if (error instanceof SmitheryAuthorizationError) {
      return "auth_required";
    }
    return "not_found";
  }
}

/**
 * Get MCP tools from a connected platform.
 * Uses Smithery Connect transport with the user's stored credentials.
 */
export async function getToolsFromPlatformConnection(
  userId: string,
  platform: PlatformKey
): Promise<ToolSet> {
  const connectionId = buildConnectionId(userId, platform);
  const mcpUrl = getPlatformMcpUrl(platform);

  try {
    const { transport } = await createConnection({ connectionId, mcpUrl });
    const mcpClient = await createMCPClient({ transport });
    return mcpClient.tools();
  } catch (error) {
    if (error instanceof SmitheryAuthorizationError) {
      console.warn(
        `[MCP] Platform ${platform} needs re-authorization for user ${userId}`
      );
      return {};
    }
    console.error(`[MCP] Failed to get tools from ${platform}:`, error);
    return {};
  }
}

/**
 * Disconnect a platform by deleting the Smithery connection.
 * Resolves the namespace automatically via the Smithery client.
 */
export async function disconnectPlatform(
  userId: string,
  platform: PlatformKey
): Promise<void> {
  const client = new Smithery({ apiKey: process.env.SMITHERY_API_KEY });
  const connectionId = buildConnectionId(userId, platform);

  try {
    const { namespaces } = await client.namespaces.list();
    if (namespaces.length > 0) {
      await client.beta.connect.connections.delete(connectionId, {
        namespace: namespaces[0].name,
      });
    }
  } catch (error) {
    console.warn(`[MCP] Failed to disconnect ${platform}:`, error);
  }
}

// Re-export for convenience
export { SmitheryAuthorizationError };
