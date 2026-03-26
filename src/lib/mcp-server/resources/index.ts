import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MCPAuthContext } from "@/lib/mcp-server/services/auth-context";
import { registerWorkspaceResource } from "./workspace";
import { registerIssueResource } from "./issue";

export function registerAllResources(server: McpServer, ctx: MCPAuthContext) {
  registerWorkspaceResource(server, ctx);
  registerIssueResource(server, ctx);
}
