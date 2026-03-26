import { db } from "@/lib/db";
import {
  issues,
  workspaces,
  columns,
  labels,
  issueLabels,
  activities,
} from "@/lib/db/schema";
import { eq, and, sql, inArray, like, gte, lte } from "drizzle-orm";
import type {
  Issue,
  IssueWithLabels,
  ActivityType,
  ActivityData,
} from "@/lib/types";
import { STATUS, type Status } from "@/lib/design-tokens";
import type { MCPAuthContext } from "@/lib/mcp-server/services/auth-context";
import { McpToolError } from "@/lib/mcp-server/errors";

// ---------------------------------------------------------------------------
// Internal helpers (mirrors private helpers from actions/issues.ts)
// ---------------------------------------------------------------------------

function assertWorkspaceAccess(
  ctx: MCPAuthContext,
  workspaceId: string
): void {
  if (!ctx.workspaceId) {
    throw new McpToolError("FORBIDDEN", "No workspace connected");
  }
  if (ctx.workspaceId !== workspaceId) {
    throw new McpToolError("FORBIDDEN", "Issue does not belong to the connected workspace");
  }
}

async function getNextIdentifier(workspaceId: string): Promise<string> {
  const workspace = await db
    .select({
      identifier: workspaces.identifier,
      counter: workspaces.issueCounter,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .get();

  if (!workspace) {
    throw new McpToolError("NOT_FOUND", "Workspace not found");
  }

  const newCounter = workspace.counter + 1;

  await db
    .update(workspaces)
    .set({ issueCounter: newCounter })
    .where(eq(workspaces.id, workspaceId));

  return `${workspace.identifier}-${newCounter}`;
}

async function findColumnForStatus(
  workspaceId: string,
  status: Status
): Promise<{ id: string; name: string } | null> {
  const column = await db
    .select({ id: columns.id, name: columns.name })
    .from(columns)
    .where(
      and(eq(columns.workspaceId, workspaceId), eq(columns.status, status))
    )
    .get();

  return column ?? null;
}

async function getColumnWorkspaceId(
  columnId: string
): Promise<string | null> {
  const column = await db
    .select({ workspaceId: columns.workspaceId })
    .from(columns)
    .where(eq(columns.id, columnId))
    .get();
  return column?.workspaceId ?? null;
}

async function logActivity(
  issueId: string,
  type: ActivityType,
  data?: ActivityData,
  userId?: string | null
): Promise<void> {
  await db.insert(activities).values({
    id: crypto.randomUUID(),
    issueId,
    userId: userId ?? null,
    type,
    data: data ? JSON.stringify(data) : null,
    createdAt: new Date(),
  });
}

// ---------------------------------------------------------------------------
// Public service functions
// ---------------------------------------------------------------------------

export interface ListIssuesFilters {
  status?: string;
  priority?: number;
  labelId?: string;
  cycleId?: string;
  assigneeId?: string;
  query?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  dueAfter?: Date;
  dueBefore?: Date;
}

/**
 * List issues for the connected workspace with optional filters.
 */
export async function listIssues(
  ctx: MCPAuthContext,
  filters: ListIssuesFilters = {}
): Promise<IssueWithLabels[]> {
  if (!ctx.workspaceId) {
    throw new McpToolError("FORBIDDEN", "No workspace connected");
  }
  const workspaceId = ctx.workspaceId;

  // Get all columns for this workspace
  const workspaceColumns = await db
    .select({ id: columns.id, status: columns.status })
    .from(columns)
    .where(eq(columns.workspaceId, workspaceId));

  if (workspaceColumns.length === 0) return [];

  // When filtering by status, use column status (matches board view)
  // since issues may have been dragged to a different column without
  // their status field being updated.
  let columnIds: string[];
  if (filters.status) {
    columnIds = workspaceColumns
      .filter((c) => c.status === filters.status)
      .map((c) => c.id);
    if (columnIds.length === 0) return [];
  } else {
    columnIds = workspaceColumns.map((c) => c.id);
  }

  // Build conditions
  const conditions = [inArray(issues.columnId, columnIds)];
  if (filters.priority !== undefined) {
    conditions.push(eq(issues.priority, filters.priority));
  }
  if (filters.cycleId) {
    conditions.push(eq(issues.cycleId, filters.cycleId));
  }
  if (filters.assigneeId) {
    conditions.push(eq(issues.assigneeId, filters.assigneeId));
  }
  if (filters.query?.trim()) {
    const q = `%${filters.query.trim()}%`;
    conditions.push(
      sql`(${issues.title} LIKE ${q} OR ${issues.description} LIKE ${q})`
    );
  }
  if (filters.createdAfter) {
    conditions.push(gte(issues.createdAt, filters.createdAfter));
  }
  if (filters.createdBefore) {
    conditions.push(lte(issues.createdAt, filters.createdBefore));
  }
  if (filters.dueAfter) {
    conditions.push(gte(issues.dueDate, filters.dueAfter));
  }
  if (filters.dueBefore) {
    conditions.push(lte(issues.dueDate, filters.dueBefore));
  }

  const allIssues = await db
    .select()
    .from(issues)
    .where(and(...conditions));

  if (allIssues.length === 0) return [];

  // If filtering by label, narrow down issues first
  let issueIds = allIssues.map((i) => i.id);

  if (filters.labelId) {
    const matchingIssueLabels = await db
      .select({ issueId: issueLabels.issueId })
      .from(issueLabels)
      .where(
        and(
          inArray(issueLabels.issueId, issueIds),
          eq(issueLabels.labelId, filters.labelId)
        )
      );
    const matchingIds = new Set(matchingIssueLabels.map((il) => il.issueId));
    issueIds = issueIds.filter((id) => matchingIds.has(id));
    if (issueIds.length === 0) return [];
  }

  // Batch fetch labels for all matching issues
  const allIssueLabelRows =
    issueIds.length > 0
      ? await db
          .select({ issueId: issueLabels.issueId, label: labels })
          .from(issueLabels)
          .innerJoin(labels, eq(issueLabels.labelId, labels.id))
          .where(inArray(issueLabels.issueId, issueIds))
      : [];

  const labelsByIssueId = new Map<string, typeof allIssueLabelRows[0]["label"][]>();
  for (const row of allIssueLabelRows) {
    const existing = labelsByIssueId.get(row.issueId);
    if (existing) {
      existing.push(row.label);
    } else {
      labelsByIssueId.set(row.issueId, [row.label]);
    }
  }

  // Filter and map
  const issueIdSet = new Set(issueIds);
  return allIssues
    .filter((i) => issueIdSet.has(i.id))
    .map((issue) => ({
      ...issue,
      labels: labelsByIssueId.get(issue.id) ?? [],
    }));
}

export interface CreateIssueInput {
  title: string;
  description?: string;
  status?: string;
  priority?: number;
  estimate?: number;
  dueDate?: Date;
  cycleId?: string;
  epicId?: string;
  labelIds?: string[];
  assigneeId?: string | null;
}

/**
 * Create a new issue in the connected workspace.
 */
export async function createIssue(
  ctx: MCPAuthContext,
  input: CreateIssueInput
): Promise<IssueWithLabels> {
  if (!ctx.workspaceId) {
    throw new McpToolError("FORBIDDEN", "No workspace connected");
  }
  const workspaceId = ctx.workspaceId;

  const status = (input.status as Status) ?? STATUS.TODO;

  // Find the column for the requested status
  const column = await findColumnForStatus(workspaceId, status);
  if (!column) {
    throw new McpToolError(
      "INVALID_INPUT",
      `No column found for status "${status}" in this workspace`
    );
  }

  const identifier = await getNextIdentifier(workspaceId);

  // Get max position in target column
  const maxPosition = await db
    .select({ maxPos: sql<number>`COALESCE(MAX(position), -1)` })
    .from(issues)
    .where(
      and(eq(issues.columnId, column.id), sql`parent_issue_id IS NULL`)
    )
    .get();

  const now = new Date();
  const newIssue: Issue = {
    id: crypto.randomUUID(),
    columnId: column.id,
    identifier,
    title: input.title,
    description: input.description ?? null,
    status,
    priority: input.priority ?? 4,
    estimate: input.estimate ?? null,
    dueDate: input.dueDate ?? null,
    cycleId: input.cycleId ?? null,
    epicId: input.epicId ?? null,
    parentIssueId: null,
    position: (maxPosition?.maxPos ?? -1) + 1,
    sentToAI: false,
    assigneeId: input.assigneeId ?? null,
    aiAssignable: false,
    aiInstructions: null,
    aiTools: null,
    aiExecutionStatus: null,
    aiJobId: null,
    aiExecutionResult: null,
    aiExecutionSummary: null,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(issues).values(newIssue);

  // Attach labels
  if (input.labelIds && input.labelIds.length > 0) {
    await db.insert(issueLabels).values(
      input.labelIds.map((labelId) => ({
        issueId: newIssue.id,
        labelId,
      }))
    );
  }

  // Log activity
  await logActivity(newIssue.id, "created", undefined, ctx.userId);

  // Fetch labels for return
  const issueLabelsData =
    input.labelIds && input.labelIds.length > 0
      ? await db
          .select()
          .from(labels)
          .where(inArray(labels.id, input.labelIds))
      : [];

  return {
    ...newIssue,
    labels: issueLabelsData,
  };
}

export interface UpdateIssueInput {
  title?: string;
  description?: string | null;
  status?: string;
  priority?: number;
  estimate?: number | null;
  dueDate?: Date | null;
  cycleId?: string | null;
  assigneeId?: string | null;
  labelIds?: string[];
}

/**
 * Update an existing issue.
 */
export async function updateIssue(
  ctx: MCPAuthContext,
  issueId: string,
  input: UpdateIssueInput
): Promise<void> {
  const existingIssue = await db
    .select()
    .from(issues)
    .where(eq(issues.id, issueId))
    .get();

  if (!existingIssue) {
    throw new McpToolError("NOT_FOUND", `Issue not found: ${issueId}`);
  }

  // Verify workspace access
  const workspaceId = await getColumnWorkspaceId(existingIssue.columnId);
  if (!workspaceId) {
    throw new McpToolError("INTERNAL", "Could not determine workspace for issue");
  }
  await assertWorkspaceAccess(ctx, workspaceId);

  const updates: Partial<Issue> = {
    updatedAt: new Date(),
  };

  const changedFields: Array<{
    field: string;
    oldValue: string | number | null;
    newValue: string | number | null;
  }> = [];

  if (input.title !== undefined && input.title !== existingIssue.title) {
    updates.title = input.title;
    changedFields.push({
      field: "title",
      oldValue: existingIssue.title,
      newValue: input.title,
    });
  }

  if (
    input.description !== undefined &&
    input.description !== existingIssue.description
  ) {
    updates.description = input.description ?? null;
    changedFields.push({
      field: "description",
      oldValue: existingIssue.description,
      newValue: input.description ?? null,
    });
  }

  if (input.status !== undefined && input.status !== existingIssue.status) {
    updates.status = input.status;

    // Auto-move column on status change (non-subtasks only)
    if (!existingIssue.parentIssueId) {
      const targetColumn = await findColumnForStatus(
        workspaceId,
        input.status as Status
      );
      if (targetColumn && targetColumn.id !== existingIssue.columnId) {
        const maxPos = await db
          .select({ maxPos: sql<number>`COALESCE(MAX(position), -1)` })
          .from(issues)
          .where(
            and(
              eq(issues.columnId, targetColumn.id),
              sql`parent_issue_id IS NULL`
            )
          )
          .get();

        updates.columnId = targetColumn.id;
        updates.position = (maxPos?.maxPos ?? -1) + 1;
      }
    }

    await logActivity(
      issueId,
      "status_changed",
      { oldValue: existingIssue.status, newValue: input.status },
      ctx.userId
    );
  }

  if (
    input.priority !== undefined &&
    input.priority !== existingIssue.priority
  ) {
    updates.priority = input.priority;
    await logActivity(
      issueId,
      "priority_changed",
      { oldValue: existingIssue.priority, newValue: input.priority },
      ctx.userId
    );
  }

  if (input.estimate !== undefined) {
    updates.estimate = input.estimate ?? null;
  }

  if (input.dueDate !== undefined) {
    updates.dueDate = input.dueDate ?? null;
  }

  if (input.cycleId !== undefined && input.cycleId !== existingIssue.cycleId) {
    updates.cycleId = input.cycleId ?? null;
    await logActivity(
      issueId,
      "cycle_changed",
      { oldValue: existingIssue.cycleId, newValue: input.cycleId ?? null },
      ctx.userId
    );
  }

  if (
    input.assigneeId !== undefined &&
    input.assigneeId !== existingIssue.assigneeId
  ) {
    updates.assigneeId = input.assigneeId ?? null;
    await logActivity(
      issueId,
      "assignee_changed",
      { oldValue: existingIssue.assigneeId, newValue: input.assigneeId ?? null },
      ctx.userId
    );
  }

  await db.update(issues).set(updates).where(eq(issues.id, issueId));

  // Replace labels if provided
  if (input.labelIds !== undefined) {
    await db.delete(issueLabels).where(eq(issueLabels.issueId, issueId));
    if (input.labelIds.length > 0) {
      await db.insert(issueLabels).values(
        input.labelIds.map((labelId) => ({
          issueId,
          labelId,
        }))
      );
    }
    changedFields.push({
      field: "labels",
      oldValue: null,
      newValue: input.labelIds.join(", "),
    });
  }

  // Log general update if there were field changes
  if (changedFields.length > 0) {
    await logActivity(
      issueId,
      "updated",
      { field: changedFields.map((c) => c.field).join(", ") },
      ctx.userId
    );
  }
}

/**
 * Create a subtask under a parent issue.
 */
export async function createSubtask(
  ctx: MCPAuthContext,
  parentIssueId: string,
  input: CreateIssueInput
): Promise<IssueWithLabels> {
  // Validate parent exists and is not itself a subtask
  const parentIssue = await db
    .select()
    .from(issues)
    .where(eq(issues.id, parentIssueId))
    .get();

  if (!parentIssue) {
    throw new McpToolError("NOT_FOUND", "Parent issue not found");
  }

  if (parentIssue.parentIssueId) {
    throw new McpToolError(
      "INVALID_INPUT",
      "Subtasks cannot have their own subtasks"
    );
  }

  const workspaceId = await getColumnWorkspaceId(parentIssue.columnId);
  if (!workspaceId) {
    throw new McpToolError("INTERNAL", "Could not determine workspace for parent issue");
  }
  await assertWorkspaceAccess(ctx, workspaceId);

  const identifier = await getNextIdentifier(workspaceId);

  // Get max position among parent's subtasks
  const maxPosition = await db
    .select({ maxPos: sql<number>`COALESCE(MAX(position), -1)` })
    .from(issues)
    .where(eq(issues.parentIssueId, parentIssueId))
    .get();

  const now = new Date();
  const status = (input.status as Status) ?? STATUS.TODO;

  const newIssue: Issue = {
    id: crypto.randomUUID(),
    columnId: parentIssue.columnId, // Inherit parent's column
    identifier,
    title: input.title,
    description: input.description ?? null,
    status,
    priority: input.priority ?? 4,
    estimate: input.estimate ?? null,
    dueDate: input.dueDate ?? null,
    cycleId: input.cycleId ?? null,
    epicId: input.epicId ?? null,
    parentIssueId,
    position: (maxPosition?.maxPos ?? -1) + 1,
    sentToAI: false,
    assigneeId: input.assigneeId ?? null,
    aiAssignable: false,
    aiInstructions: null,
    aiTools: null,
    aiExecutionStatus: null,
    aiJobId: null,
    aiExecutionResult: null,
    aiExecutionSummary: null,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(issues).values(newIssue);

  // Attach labels
  if (input.labelIds && input.labelIds.length > 0) {
    await db.insert(issueLabels).values(
      input.labelIds.map((labelId) => ({
        issueId: newIssue.id,
        labelId,
      }))
    );
  }

  // Log activity
  await logActivity(newIssue.id, "created", undefined, ctx.userId);
  await logActivity(
    parentIssueId,
    "subtask_added",
    {
      subtaskId: newIssue.id,
      subtaskIdentifier: identifier,
      subtaskTitle: input.title,
    },
    ctx.userId
  );

  // Fetch labels for return
  const issueLabelsData =
    input.labelIds && input.labelIds.length > 0
      ? await db
          .select()
          .from(labels)
          .where(inArray(labels.id, input.labelIds))
      : [];

  return {
    ...newIssue,
    labels: issueLabelsData,
  };
}
