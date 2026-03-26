import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatToolError } from "@/lib/mcp-server/errors";
import type { MCPAuthContext } from "@/lib/mcp-server/services/auth-context";
import { searchKnowledge } from "@/lib/mcp-server/services/knowledge";

export function registerKnowledgeTools(server: McpServer, ctx: MCPAuthContext) {
  server.tool(
    "search-knowledge",
    "Search knowledge base documents in the connected workspace by query, tag, or folder",
    {
      query: z.string().optional().describe("Search query — matches title"),
      tag: z.string().optional().describe("Filter by tag"),
      folderId: z.string().optional().describe("Filter by folder ID"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(20)
        .describe("Maximum results to return"),
    },
    async (args) => {
      try {
        const result = await searchKnowledge(ctx, args);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );
}
