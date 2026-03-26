import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { db } from "@/lib/db";
import {
  issues,
  labels,
  issueLabels,
  comments,
  activities,
  columns,
} from "@/lib/db/schema";
import { eq, asc, desc, inArray } from "drizzle-orm";
import type { MCPAuthContext } from "@/lib/mcp-server/services/auth-context";

export function registerIssueResource(
  server: McpServer,
  ctx: MCPAuthContext
) {
  server.resource(
    "issue",
    new ResourceTemplate("insight://issue/{issueId}", { list: undefined }),
    { description: "Full issue detail with labels, comments, activities, and subtasks" },
    async (uri, { issueId }) => {
      const id = String(issueId);

      if (!ctx.workspaceId) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({ error: "No workspace connected" }),
            },
          ],
        };
      }

      const issue = await db
        .select()
        .from(issues)
        .where(eq(issues.id, id))
        .get();

      if (!issue) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({ error: `Issue not found: ${id}` }),
            },
          ],
        };
      }

      // Verify workspace access
      const col = await db
        .select({ workspaceId: columns.workspaceId })
        .from(columns)
        .where(eq(columns.id, issue.columnId))
        .get();

      if (!col || col.workspaceId !== ctx.workspaceId) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({
                error: "Issue does not belong to the connected workspace",
              }),
            },
          ],
        };
      }

      // Fetch related data in parallel
      const [issueLabelsData, issueComments, issueActivities, subtasks] =
        await Promise.all([
          db
            .select({ label: labels })
            .from(issueLabels)
            .innerJoin(labels, eq(issueLabels.labelId, labels.id))
            .where(eq(issueLabels.issueId, id)),
          db
            .select()
            .from(comments)
            .where(eq(comments.issueId, id))
            .orderBy(asc(comments.createdAt)),
          db
            .select()
            .from(activities)
            .where(eq(activities.issueId, id))
            .orderBy(desc(activities.createdAt))
            .limit(20),
          db
            .select()
            .from(issues)
            .where(eq(issues.parentIssueId, id))
            .orderBy(asc(issues.position)),
        ]);

      const data = {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description,
        status: issue.status,
        priority: issue.priority,
        assigneeId: issue.assigneeId,
        estimate: issue.estimate,
        dueDate: issue.dueDate,
        cycleId: issue.cycleId,
        epicId: issue.epicId,
        parentIssueId: issue.parentIssueId,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        labels: issueLabelsData.map((r) => ({
          id: r.label.id,
          name: r.label.name,
          color: r.label.color,
        })),
        comments: issueComments.map((c) => ({
          id: c.id,
          body: c.body,
          userId: c.userId,
          createdAt: c.createdAt,
        })),
        activities: issueActivities.map((a) => ({
          id: a.id,
          type: a.type,
          data: a.data ? JSON.parse(a.data) : null,
          userId: a.userId,
          createdAt: a.createdAt,
        })),
        subtasks: subtasks.map((s) => ({
          id: s.id,
          identifier: s.identifier,
          title: s.title,
          status: s.status,
          priority: s.priority,
          assigneeId: s.assigneeId,
        })),
      };

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );
}
