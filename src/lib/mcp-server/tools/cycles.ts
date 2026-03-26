import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatToolError } from "@/lib/mcp-server/errors";
import type { MCPAuthContext } from "@/lib/mcp-server/services/auth-context";
import { listCycles } from "@/lib/mcp-server/services/cycles";

export function registerCycleTools(server: McpServer, ctx: MCPAuthContext) {
  server.tool(
    "list-cycles",
    "List cycles/sprints for the connected workspace with optional issue counts",
    {
      includeIssues: z
        .boolean()
        .default(false)
        .describe("Include issue counts per cycle"),
    },
    async (args) => {
      try {
        const result = await listCycles(ctx, args.includeIssues);
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
