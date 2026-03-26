import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { db } from "@/lib/db";
import {
  workspaces,
  columns,
  labels,
  workspaceMembers,
} from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import type { MCPAuthContext } from "@/lib/mcp-server/services/auth-context";

export function registerWorkspaceResource(
  server: McpServer,
  ctx: MCPAuthContext
) {
  server.resource(
    "workspace",
    "insight://workspace",
    { description: "Current workspace info: name, slug, purpose, columns, labels, member count" },
    async () => {
      if (!ctx.workspaceId) {
        return {
          contents: [
            {
              uri: "insight://workspace",
              mimeType: "application/json",
              text: JSON.stringify({ error: "No workspace connected" }),
            },
          ],
        };
      }

      const [workspace, cols, workspaceLabels, members] = await Promise.all([
        db
          .select()
          .from(workspaces)
          .where(eq(workspaces.id, ctx.workspaceId))
          .get(),
        db
          .select()
          .from(columns)
          .where(eq(columns.workspaceId, ctx.workspaceId))
          .orderBy(asc(columns.position)),
        db
          .select()
          .from(labels)
          .where(eq(labels.workspaceId, ctx.workspaceId))
          .orderBy(asc(labels.name)),
        db
          .select()
          .from(workspaceMembers)
          .where(eq(workspaceMembers.workspaceId, ctx.workspaceId)),
      ]);

      const data = {
        id: workspace?.id,
        name: workspace?.name,
        slug: workspace?.slug,
        purpose: workspace?.purpose,
        columns: cols.map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          position: c.position,
        })),
        labels: workspaceLabels.map((l) => ({
          id: l.id,
          name: l.name,
          color: l.color,
        })),
        memberCount: members.length,
      };

      return {
        contents: [
          {
            uri: "insight://workspace",
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );
}
