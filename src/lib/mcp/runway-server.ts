/**
 * Runway MCP Server — entry point
 *
 * Central access layer for all Runway read/write operations.
 * Clients: Slack bot, Claude Code, Open Brain
 *
 * All business logic lives in @/lib/runway/operations.
 * Tool registrations live in ./runway-tools.ts.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerRunwayTools } from "./runway-tools";

export function createRunwayMcpServer(): McpServer {
  const server = new McpServer({
    name: "runway",
    version: "1.0.0",
  });

  registerRunwayTools(server);

  return server;
}
