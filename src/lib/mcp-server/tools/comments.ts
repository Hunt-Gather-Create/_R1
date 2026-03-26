import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { requireMCPWorkspaceAccess } from "@/lib/mcp-server/auth/middleware";
import { formatToolError } from "@/lib/mcp-server/errors";
import type { MCPAuthContext } from "@/lib/mcp-server/services/auth-context";
import { addComment } from "@/lib/mcp-server/services/comments";

export function registerCommentTools(server: McpServer, ctx: MCPAuthContext) {
  server.tool(
    "add-comment",
    "Add a comment to an issue",
    {
      issueId: z.string().describe("Issue ID to comment on"),
      body: z.string().min(1).describe("Comment text (markdown)"),
    },
    async (args) => {
      try {
        await requireMCPWorkspaceAccess(ctx, "member");
        const result = await addComment(ctx, args.issueId, args.body);
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
