import { z } from "zod";

// Workspace tools
export const listWorkspacesInput = z.object({});

export const createWorkspaceInput = z.object({
  name: z.string().min(1).max(100).describe("Workspace name"),
  purpose: z
    .enum(["software", "marketing", "sales", "custom"])
    .default("software")
    .describe("Workspace purpose — determines default columns and labels"),
});

export const getBoardOverviewInput = z.object({
  workspaceId: z.string().describe("Workspace ID"),
});

// Brand tools
export const researchBrandInput = z.object({
  query: z
    .string()
    .min(1)
    .describe("Brand name or website URL to research"),
  type: z
    .enum(["name", "url"])
    .optional()
    .describe("Search type — auto-detected from query if omitted"),
});

export const createBrandInput = z.object({
  name: z.string().min(1).max(200).describe("Brand name"),
  tagline: z.string().max(500).optional().describe("Brand tagline"),
  description: z.string().optional().describe("Brand description"),
  logoUrl: z.string().url().optional().describe("URL to brand logo"),
  websiteUrl: z
    .string()
    .url()
    .optional()
    .describe("Brand website URL — triggers async summary generation"),
  primaryColor: z
    .string()
    .optional()
    .describe('Primary brand color (hex, e.g. "#635BFF")'),
  secondaryColor: z
    .string()
    .optional()
    .describe('Secondary brand color (hex)'),
  industry: z.string().optional().describe("Industry/sector"),
});

export const listBrandsInput = z.object({});

export const linkWorkspaceBrandInput = z.object({
  workspaceId: z.string().describe("Workspace ID"),
  brandId: z.string().describe("Brand ID to link"),
});

// Issue tools
export const listIssuesInput = z.object({
  workspaceId: z.string().describe("Workspace ID"),
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
    .describe("Filter by priority (0=urgent, 1=high, 2=medium, 3=low, 4=none)"),
  labelId: z.string().optional().describe("Filter by label ID"),
  cycleId: z.string().optional().describe("Filter by cycle ID"),
  assigneeId: z.string().optional().describe("Filter by assignee user ID"),
  query: z
    .string()
    .optional()
    .describe("Search query — matches title and description"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(50)
    .describe("Maximum results to return"),
});

export const createIssueInput = z.object({
  workspaceId: z.string().describe("Workspace ID"),
  title: z.string().min(1).max(500).describe("Issue title"),
  description: z.string().optional().describe("Issue description (markdown)"),
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
});

export const updateIssueInput = z.object({
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
  labelIds: z
    .array(z.string())
    .optional()
    .describe("Replace all labels with these IDs"),
  cycleId: z
    .string()
    .nullable()
    .optional()
    .describe("New cycle ID (null to remove)"),
  epicId: z
    .string()
    .nullable()
    .optional()
    .describe("New epic ID (null to remove)"),
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
});

export const createSubtaskInput = z.object({
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
});

// Comment tools
export const addCommentInput = z.object({
  issueId: z.string().describe("Issue ID to comment on"),
  body: z.string().min(1).describe("Comment text (markdown)"),
});

// Knowledge tools
export const searchKnowledgeInput = z.object({
  workspaceId: z.string().describe("Workspace ID"),
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
});

// Cycle tools
export const listCyclesInput = z.object({
  workspaceId: z.string().describe("Workspace ID"),
  includeIssues: z
    .boolean()
    .default(false)
    .describe("Include issue counts per cycle"),
});
