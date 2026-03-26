import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MCPAuthContext } from "@/lib/mcp-server/services/auth-context";
import { registerIssueTools } from "./issues";
import { registerCommentTools } from "./comments";
import { registerBoardTools } from "./board";
import { registerKnowledgeTools } from "./knowledge";
import { registerCycleTools } from "./cycles";

export function registerAllTools(server: McpServer, ctx: MCPAuthContext) {
  registerIssueTools(server, ctx);
  registerCommentTools(server, ctx);
  registerBoardTools(server, ctx);
  registerKnowledgeTools(server, ctx);
  registerCycleTools(server, ctx);
}
