import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MCP_SERVER_NAME, MCP_SERVER_VERSION } from "./config";
import { registerAllTools } from "./tools";
import { registerAllResources } from "./resources";
import type { MCPAuthContext } from "./services/auth-context";

/**
 * Create a configured MCP server with all tools and resources registered.
 * Each request gets its own server instance scoped to the authenticated user + workspace.
 */
export function createMCPServer(ctx: MCPAuthContext): McpServer {
  const server = new McpServer(
    {
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  registerAllTools(server, ctx);
  registerAllResources(server, ctx);

  return server;
}
