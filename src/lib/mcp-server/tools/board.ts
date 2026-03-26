import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatToolError } from "@/lib/mcp-server/errors";
import { requireMCPWorkspaceAccess } from "@/lib/mcp-server/auth/middleware";
import type { MCPAuthContext } from "@/lib/mcp-server/services/auth-context";
import { getBoardOverview, createLabel } from "@/lib/mcp-server/services/board";

export function registerBoardTools(server: McpServer, ctx: MCPAuthContext) {
  server.tool(
    "get-board-overview",
    "Get a board overview for the connected workspace: columns with issues, labels, and cycles",
    {},
    async () => {
      try {
        const result = await getBoardOverview(ctx);
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

  server.tool(
    "create-label",
    "Create a new label in the connected workspace",
    {
      name: z.string().min(1).max(100).describe("Label name"),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .describe('Hex color (e.g. "#ef4444")'),
    },
    async (args) => {
      try {
        await requireMCPWorkspaceAccess(ctx, "member");
        const result = await createLabel(ctx, args.name, args.color);
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
