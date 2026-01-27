import { createMCPClient } from "@ai-sdk/mcp";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { workspaceMcpServers } from "@/lib/db/schema";
import { MCP_SERVERS, type McpServerKey } from "./servers";
import type { ToolSet } from "ai";

// Re-export server definitions
export { MCP_SERVERS, type McpServerKey, getMcpServer, getAllMcpServers } from "./servers";

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
 * Aggregate all tools from enabled MCP servers for a workspace.
 * Used by the chat module to add MCP tools to the AI's tool set.
 */
export async function getMcpToolsForWorkspace(workspaceId: string): Promise<ToolSet> {
  // Fetch enabled servers from our DB
  const enabledServers = await getEnabledMcpServers(workspaceId);

  if (enabledServers.length === 0) {
    return {};
  }

  // Aggregate tools from each connected server
  const allTools: ToolSet = {};

  for (const server of enabledServers) {
    const serverKey = server.serverKey as McpServerKey;

    // Verify this is a valid server key
    if (!(serverKey in MCP_SERVERS)) {
      continue;
    }

    try {
      const tools = await getToolsFromServer(serverKey);

      // Merge tools, prefixing with server key to avoid conflicts
      for (const [toolName, tool] of Object.entries(tools)) {
        allTools[`${serverKey}_${toolName}`] = tool;
      }
    } catch (error) {
      console.error(`[MCP] Failed to get tools for ${serverKey}:`, error);
    }
  }

  return allTools;
}
