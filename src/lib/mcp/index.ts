import { createMCPClient } from "@ai-sdk/mcp";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { workspaceMcpServers, platformConnections } from "@/lib/db/schema";
import { MCP_SERVERS, type McpServerKey } from "./servers";
import { type PlatformKey } from "./platforms";
import { getToolsFromPlatformConnection } from "./connect";
import type { ToolSet } from "ai";

// Re-export server definitions
export { MCP_SERVERS, type McpServerKey, getMcpServer, getAllMcpServers } from "./servers";
export { SOCIAL_PLATFORMS, type PlatformKey } from "./platforms";

/**
 * Get enabled MCP servers for a workspace from the database
 */
export async function getEnabledMcpServers(workspaceId: string) {
  return db
    .select()
    .from(workspaceMcpServers)
    .where(
      and(
        eq(workspaceMcpServers.workspaceId, workspaceId),
        eq(workspaceMcpServers.isEnabled, true)
      )
    );
}

/**
 * Get tools from a specific MCP server.
 */
export async function getToolsFromServer(serverKey: McpServerKey): Promise<ToolSet> {
  const server = MCP_SERVERS[serverKey];

  try {
    const mcpClient = await createMCPClient({
      transport: {
        type: server.transportType,
        url: server.mcpUrl,
      },
    });

    const tools = await mcpClient.tools();

    // Note: We intentionally don't call mcpClient.close() for HTTP transport
    // as it causes AbortError. The connection will be cleaned up when the
    // request ends.

    return tools;
  } catch (error) {
    console.error(`[MCP] Failed to get tools from ${server.name}:`, error);
    return {};
  }
}

/**
 * Test connection to an MCP server.
 * Returns true if connection succeeds, false otherwise.
 */
export async function testServerConnection(serverKey: McpServerKey): Promise<{
  connected: boolean;
  error?: string;
}> {
  const server = MCP_SERVERS[serverKey];

  try {
    const mcpClient = await createMCPClient({
      transport: {
        type: server.transportType,
        url: server.mcpUrl,
      },
    });

    // Try to list tools as a connection test
    await mcpClient.tools();

    // Note: We intentionally don't call mcpClient.close() for HTTP transport
    // as it causes AbortError. The connection will be cleaned up when the
    // request ends.

    return { connected: true };
  } catch (error) {
    console.error(`[MCP] Connection test failed for ${server.name}:`, error);
    return {
      connected: false,
      error: error instanceof Error ? error.message : "Connection failed",
    };
  }
}

/**
 * Aggregate all tools from enabled MCP servers AND connected platforms for a workspace.
 * Used by the chat module to add MCP tools to the AI's tool set.
 */
export async function getMcpToolsForWorkspace(
  workspaceId: string,
  userId?: string
): Promise<ToolSet> {
  const allTools: ToolSet = {};

  // Load workspace-level MCP server tools (e.g., Exa)
  const enabledServers = await getEnabledMcpServers(workspaceId);

  for (const server of enabledServers) {
    const serverKey = server.serverKey as McpServerKey;

    if (!(serverKey in MCP_SERVERS)) {
      continue;
    }

    try {
      const tools = await getToolsFromServer(serverKey);

      for (const [toolName, tool] of Object.entries(tools)) {
        allTools[`${serverKey}_${toolName}`] = tool;
      }
    } catch (error) {
      console.error(`[MCP] Failed to get tools for ${serverKey}:`, error);
    }
  }

  // Load user's connected platform tools (social media via Smithery Connect)
  if (userId) {
    const userConnections = await db
      .select()
      .from(platformConnections)
      .where(
        and(
          eq(platformConnections.userId, userId),
          eq(platformConnections.workspaceId, workspaceId),
          eq(platformConnections.status, "connected")
        )
      );

    const platformToolResults = await Promise.all(
      userConnections.map(async (conn) => {
        const platformKey = conn.platform as PlatformKey;
        try {
          const tools = await getToolsFromPlatformConnection(
            userId,
            platformKey
          );
          return { platform: platformKey, tools };
        } catch (error) {
          console.error(
            `[MCP] Failed to get platform tools for ${platformKey}:`,
            error
          );
          return { platform: platformKey, tools: {} as ToolSet };
        }
      })
    );

    for (const { platform, tools } of platformToolResults) {
      for (const [toolName, tool] of Object.entries(tools)) {
        allTools[`${platform}_${toolName}`] = tool;
      }
    }
  }

  return allTools;
}
