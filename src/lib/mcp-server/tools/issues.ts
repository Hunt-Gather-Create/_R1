import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatToolError } from "@/lib/mcp-server/errors";
import { requireMCPWorkspaceAccess } from "@/lib/mcp-server/auth/middleware";
import type { MCPAuthContext } from "@/lib/mcp-server/services/auth-context";
import {
  listIssues,
  createIssue,
  updateIssue,
  createSubtask,
} from "@/lib/mcp-server/services/issues";

export function registerIssueTools(server: McpServer, ctx: MCPAuthContext) {
  server.tool(
    "list-issues",
    "List and filter issues in the connected workspace by status, priority, label, cycle, assignee, or search query",
    {
      status: z
        .enum(["backlog", "todo", "in_progress", "done", "canceled"])
        .optional()
        .describe("Filter by status"),
      priority: z
        .number()
        .int()
        .min(0)
        .max(4)
        .optional()
        .describe(
          "Filter by priority (0=urgent, 1=high, 2=medium, 3=low, 4=none)"
        ),
      labelId: z.string().optional().describe("Filter by label ID"),
      cycleId: z.string().optional().describe("Filter by cycle ID"),
      assigneeId: z.string().optional().describe("Filter by assignee user ID"),
      query: z
        .string()
        .optional()
        .describe("Search query — matches title and description"),
      createdAfter: z.string().optional().describe("Issues created after this date (ISO 8601)"),
      createdBefore: z.string().optional().describe("Issues created before this date (ISO 8601)"),
      dueAfter: z.string().optional().describe("Issues due after this date (ISO 8601)"),
      dueBefore: z.string().optional().describe("Issues due before this date (ISO 8601)"),
    },
    async (args) => {
      try {
        await requireMCPWorkspaceAccess(ctx, "viewer");
        const { createdAfter, createdBefore, dueAfter, dueBefore, ...rest } = args;
        const result = await listIssues(ctx, {
          ...rest,
          createdAfter: createdAfter ? new Date(createdAfter) : undefined,
          createdBefore: createdBefore ? new Date(createdBefore) : undefined,
          dueAfter: dueAfter ? new Date(dueAfter) : undefined,
          dueBefore: dueBefore ? new Date(dueBefore) : undefined,
        });
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ issues: result, total: result.length }, null, 2) },
          ],
        };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "create-issue",
    "Create a new issue in the connected workspace",
    {
      title: z.string().min(1).max(500).describe("Issue title"),
      description: z
        .string()
        .optional()
        .describe("Issue description (markdown)"),
      status: z
        .enum(["backlog", "todo", "in_progress", "done", "canceled"])
        .default("todo")
        .describe("Issue status"),
      priority: z
        .number()
        .int()
        .min(0)
        .max(4)
        .default(4)
        .describe("Priority (0=urgent, 4=none)"),
      labelIds: z
        .array(z.string())
        .optional()
        .describe("Label IDs to attach"),
      cycleId: z.string().optional().describe("Cycle/sprint ID"),
      epicId: z.string().optional().describe("Epic ID"),
      assigneeId: z.string().optional().describe("Assignee user ID"),
      estimate: z.number().int().optional().describe("Story point estimate"),
      dueDate: z.string().optional().describe("Due date (ISO 8601)"),
    },
    async (args) => {
      try {
        await requireMCPWorkspaceAccess(ctx, "member");
        const { dueDate, ...rest } = args;
        const result = await createIssue(ctx, {
          ...rest,
          dueDate: dueDate ? new Date(dueDate) : undefined,
        });
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
    "update-issue",
    "Update fields on an issue. Issue auto-moves to matching column on status change.",
    {
      issueId: z.string().describe("Issue ID to update"),
      title: z.string().min(1).max(500).optional().describe("New title"),
      description: z
        .string()
        .nullable()
        .optional()
        .describe("New description (null to clear)"),
      status: z
        .enum(["backlog", "todo", "in_progress", "done", "canceled"])
        .optional()
        .describe("New status — issue auto-moves to matching column"),
      priority: z
        .number()
        .int()
        .min(0)
        .max(4)
        .optional()
        .describe("New priority"),
      cycleId: z
        .string()
        .nullable()
        .optional()
        .describe("New cycle ID (null to remove)"),
      assigneeId: z
        .string()
        .nullable()
        .optional()
        .describe("New assignee (null to unassign)"),
      estimate: z
        .number()
        .int()
        .nullable()
        .optional()
        .describe("New estimate (null to clear)"),
      dueDate: z
        .string()
        .nullable()
        .optional()
        .describe("New due date ISO 8601 (null to clear)"),
      labelIds: z
        .array(z.string())
        .optional()
        .describe("Replace all labels with these IDs (empty array to clear)"),
    },
    async (args) => {
      try {
        await requireMCPWorkspaceAccess(ctx, "member");
        const { issueId, dueDate, ...rest } = args;
        await updateIssue(ctx, issueId, {
          ...rest,
          dueDate: dueDate === null ? null : dueDate ? new Date(dueDate) : undefined,
        });
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ success: true, issueId }, null, 2) },
          ],
        };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "create-subtask",
    "Create a subtask under a parent issue. Inherits workspace from the parent.",
    {
      parentIssueId: z.string().describe("Parent issue ID"),
      title: z.string().min(1).max(500).describe("Subtask title"),
      description: z.string().optional().describe("Subtask description"),
      status: z
        .enum(["backlog", "todo", "in_progress", "done", "canceled"])
        .default("todo")
        .describe("Subtask status"),
      priority: z
        .number()
        .int()
        .min(0)
        .max(4)
        .default(4)
        .describe("Subtask priority"),
      assigneeId: z.string().optional().describe("Assignee user ID"),
    },
    async (args) => {
      try {
        await requireMCPWorkspaceAccess(ctx, "member");
        const { parentIssueId, ...input } = args;
        const result = await createSubtask(ctx, parentIssueId, input);
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
