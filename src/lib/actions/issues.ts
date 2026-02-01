"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserId } from "../auth";
import { db } from "../db";
import {
  issues,
  workspaces,
  columns,
  labels,
  issueLabels,
  comments,
  activities,
} from "../db/schema";
import { eq, and, gt, gte, lt, sql, inArray } from "drizzle-orm";
import type {
  Issue,
  IssueWithLabels,
  Label,
  Comment,
  Activity,
  CreateIssueInput,
  UpdateIssueInput,
  ActivityType,
  ActivityData,
  SubtaskCount,
} from "../types";
import { STATUS, type Status } from "../design-tokens";
import { requireWorkspaceAccess } from "./workspace";
import { getWorkspaceSlug } from "./helpers";

// Helper to generate next identifier
async function getNextIdentifier(workspaceId: string): Promise<string> {
  const workspace = await db
    .select({
      identifier: workspaces.identifier,
      counter: workspaces.issueCounter,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .get();

  if (!workspace) throw new Error("Workspace not found");

  const newCounter = workspace.counter + 1;

  await db
    .update(workspaces)
    .set({ issueCounter: newCounter })
    .where(eq(workspaces.id, workspaceId));

  return `${workspace.identifier}-${newCounter}`;
}

// Helper to log activity with user ID
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

// Get column's workspace ID
async function getColumnWorkspaceId(columnId: string): Promise<string | null> {
  const column = await db
    .select({ workspaceId: columns.workspaceId })
    .from(columns)
    .where(eq(columns.id, columnId))
    .get();
  return column?.workspaceId ?? null;
}

// Find column by status within a workspace
async function findColumnForStatus(
  workspaceId: string,
  status: Status
): Promise<{ id: string; name: string } | null> {
  // Find column with matching status field
  const column = await db
    .select({ id: columns.id, name: columns.name })
    .from(columns)
    .where(and(eq(columns.workspaceId, workspaceId), eq(columns.status, status)))
    .get();

  return column ?? null;
}

export async function createIssue(
  columnId: string,
  input: CreateIssueInput
): Promise<IssueWithLabels> {
  const workspaceId = await getColumnWorkspaceId(columnId);
  if (!workspaceId) throw new Error("Column not found");

  // Verify user has access to this workspace
  await requireWorkspaceAccess(workspaceId, "member");

  const userId = await getCurrentUserId();
  const identifier = await getNextIdentifier(workspaceId);

  // For subtasks, validate parent exists and is not itself a subtask
  let parentIssueId: string | null = null;
  if (input.parentIssueId) {
    const parentIssue = await db
      .select()
      .from(issues)
      .where(eq(issues.id, input.parentIssueId))
      .get();

    if (!parentIssue) {
      throw new Error("Parent issue not found");
    }

    // Prevent nested subtasks (subtasks cannot have subtasks)
    if (parentIssue.parentIssueId) {
      throw new Error("Subtasks cannot have their own subtasks");
    }

    parentIssueId = input.parentIssueId;
  }

  // Get max position (for subtasks, position within parent's subtask list)
  const maxPosition = await db
    .select({ maxPos: sql<number>`COALESCE(MAX(position), -1)` })
    .from(issues)
    .where(
      parentIssueId
        ? eq(issues.parentIssueId, parentIssueId)
        : eq(issues.columnId, columnId)
    )
    .get();

  const now = new Date();
  const newIssue: Issue = {
    id: crypto.randomUUID(),
    columnId,
    identifier,
    title: input.title,
    description: input.description ?? null,
    status: input.status ?? STATUS.TODO,
    priority: input.priority ?? 4,
    estimate: input.estimate ?? null,
    dueDate: input.dueDate ?? null,
    cycleId: input.cycleId ?? null,
    parentIssueId,
    position: (maxPosition?.maxPos ?? -1) + 1,
    sentToAI: false,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(issues).values(newIssue);

  // Add labels if provided
  if (input.labelIds && input.labelIds.length > 0) {
    await db.insert(issueLabels).values(
      input.labelIds.map((labelId) => ({
        issueId: newIssue.id,
        labelId,
      }))
    );
  }

  // Log activity with user ID
  await logActivity(newIssue.id, "created", undefined, userId);

  // If this is a subtask, also log activity on parent
  if (parentIssueId) {
    await logActivity(
      parentIssueId,
      "subtask_added",
      {
        subtaskId: newIssue.id,
        subtaskIdentifier: identifier,
        subtaskTitle: input.title,
      },
      userId
    );
  }

  // Revalidate workspace path
  const slug = await getWorkspaceSlug(workspaceId);
  revalidatePath(slug ? `/w/${slug}` : "/");

  // Fetch labels for return
  const issueLabelsData =
    input.labelIds && input.labelIds.length > 0
      ? await db.select().from(labels).where(inArray(labels.id, input.labelIds))
      : [];

  return {
    ...newIssue,
    labels: issueLabelsData,
  };
}

export async function updateIssue(
  issueId: string,
  input: UpdateIssueInput
): Promise<void> {
  const existingIssue = await db
    .select()
    .from(issues)
    .where(eq(issues.id, issueId))
    .get();

  if (!existingIssue) return;

  // Get workspace ID for auth check
  const workspaceId = await getColumnWorkspaceId(existingIssue.columnId);
  if (workspaceId) {
    await requireWorkspaceAccess(workspaceId, "member");
  }

  const userId = await getCurrentUserId();

  const updates: Partial<Issue> = {
    updatedAt: new Date(),
  };

  // Track changes for activity log
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

    // When status changes, also move the issue to the corresponding column
    // (only for non-subtasks - subtasks stay with their parent)
    if (!existingIssue.parentIssueId && workspaceId) {
      const targetColumn = await findColumnForStatus(
        workspaceId,
        input.status as Status
      );
      if (targetColumn && targetColumn.id !== existingIssue.columnId) {
        // Get max position in target column
        const maxPosition = await db
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
        updates.position = (maxPosition?.maxPos ?? -1) + 1;
      }
    }

    await logActivity(
      issueId,
      "status_changed",
      {
        oldValue: existingIssue.status,
        newValue: input.status,
      },
      userId
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
      {
        oldValue: existingIssue.priority,
        newValue: input.priority,
      },
      userId
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
      {
        oldValue: existingIssue.cycleId,
        newValue: input.cycleId ?? null,
      },
      userId
    );
  }

  await db.update(issues).set(updates).where(eq(issues.id, issueId));

  // Log general update if there were field changes
  if (changedFields.length > 0) {
    await logActivity(
      issueId,
      "updated",
      {
        field: changedFields.map((c) => c.field).join(", "),
      },
      userId
    );
  }

  // Revalidate workspace path
  if (workspaceId) {
    const slug = await getWorkspaceSlug(workspaceId);
    revalidatePath(slug ? `/w/${slug}` : "/");
  } else {
    revalidatePath("/");
  }
}

export async function deleteIssue(issueId: string): Promise<void> {
  const issue = await db
    .select()
    .from(issues)
    .where(eq(issues.id, issueId))
    .get();

  if (!issue) return;

  // Get workspace ID for auth check
  const workspaceId = await getColumnWorkspaceId(issue.columnId);
  if (workspaceId) {
    await requireWorkspaceAccess(workspaceId, "member");
  }

  const userId = await getCurrentUserId();

  // If this is a subtask, log activity on parent before deletion
  if (issue.parentIssueId) {
    await logActivity(
      issue.parentIssueId,
      "subtask_removed",
      {
        subtaskId: issueId,
        subtaskIdentifier: issue.identifier,
        subtaskTitle: issue.title,
      },
      userId
    );
  }

  await db.delete(issues).where(eq(issues.id, issueId));

  // Update positions of remaining issues in column (only for non-subtasks)
  if (!issue.parentIssueId) {
    await db
      .update(issues)
      .set({ position: sql`position - 1` })
      .where(
        and(
          eq(issues.columnId, issue.columnId),
          gt(issues.position, issue.position),
          sql`parent_issue_id IS NULL`
        )
      );
  } else {
    // Update positions of sibling subtasks
    await db
      .update(issues)
      .set({ position: sql`position - 1` })
      .where(
        and(
          eq(issues.parentIssueId, issue.parentIssueId),
          gt(issues.position, issue.position)
        )
      );
  }

  // Revalidate workspace path
  if (workspaceId) {
    const slug = await getWorkspaceSlug(workspaceId);
    revalidatePath(slug ? `/w/${slug}` : "/");
  } else {
    revalidatePath("/");
  }
}

export async function moveIssue(
  issueId: string,
  targetColumnId: string,
  targetPosition: number
): Promise<void> {
  const issue = await db
    .select()
    .from(issues)
    .where(eq(issues.id, issueId))
    .get();

  if (!issue) return;

  // Prevent moving subtasks independently - they move with their parent
  if (issue.parentIssueId) {
    throw new Error("Subtasks cannot be moved independently");
  }

  // Get workspace ID for auth check
  const workspaceId = await getColumnWorkspaceId(issue.columnId);
  if (workspaceId) {
    await requireWorkspaceAccess(workspaceId, "member");
  }

  const userId = await getCurrentUserId();
  const sourceColumnId = issue.columnId;
  const sourcePosition = issue.position;

  if (sourceColumnId === targetColumnId) {
    // Same column reorder
    if (sourcePosition === targetPosition) return;

    if (sourcePosition < targetPosition) {
      await db
        .update(issues)
        .set({ position: sql`position - 1` })
        .where(
          and(
            eq(issues.columnId, sourceColumnId),
            gt(issues.position, sourcePosition),
            lt(issues.position, targetPosition + 1)
          )
        );
    } else {
      await db
        .update(issues)
        .set({ position: sql`position + 1` })
        .where(
          and(
            eq(issues.columnId, sourceColumnId),
            gte(issues.position, targetPosition),
            lt(issues.position, sourcePosition)
          )
        );
    }

    await db
      .update(issues)
      .set({ position: targetPosition, updatedAt: new Date() })
      .where(eq(issues.id, issueId));
  } else {
    // Cross-column move
    await db
      .update(issues)
      .set({ position: sql`position - 1` })
      .where(
        and(
          eq(issues.columnId, sourceColumnId),
          gt(issues.position, sourcePosition)
        )
      );

    await db
      .update(issues)
      .set({ position: sql`position + 1` })
      .where(
        and(
          eq(issues.columnId, targetColumnId),
          gte(issues.position, targetPosition)
        )
      );

    await db
      .update(issues)
      .set({
        columnId: targetColumnId,
        position: targetPosition,
        updatedAt: new Date(),
      })
      .where(eq(issues.id, issueId));

    // Move all subtasks to the same column as parent
    await db
      .update(issues)
      .set({
        columnId: targetColumnId,
        updatedAt: new Date(),
      })
      .where(eq(issues.parentIssueId, issueId));

    // Log the move with user ID
    await logActivity(
      issueId,
      "moved",
      {
        fromColumn: sourceColumnId,
        toColumn: targetColumnId,
      },
      userId
    );
  }

  // Revalidate workspace path
  if (workspaceId) {
    const slug = await getWorkspaceSlug(workspaceId);
    revalidatePath(slug ? `/w/${slug}` : "/");
  } else {
    revalidatePath("/");
  }
}

// Label operations
export async function addLabel(
  issueId: string,
  labelId: string
): Promise<void> {
  const label = await db
    .select()
    .from(labels)
    .where(eq(labels.id, labelId))
    .get();

  if (!label) return;

  // Check workspace access
  await requireWorkspaceAccess(label.workspaceId, "member");

  const userId = await getCurrentUserId();

  await db
    .insert(issueLabels)
    .values({ issueId, labelId })
    .onConflictDoNothing();

  await logActivity(
    issueId,
    "label_added",
    {
      labelId,
      labelName: label.name,
    },
    userId
  );

  await db
    .update(issues)
    .set({ updatedAt: new Date() })
    .where(eq(issues.id, issueId));

  const slug = await getWorkspaceSlug(label.workspaceId);
  revalidatePath(slug ? `/w/${slug}` : "/");
}

export async function removeLabel(
  issueId: string,
  labelId: string
): Promise<void> {
  const label = await db
    .select()
    .from(labels)
    .where(eq(labels.id, labelId))
    .get();

  if (label) {
    await requireWorkspaceAccess(label.workspaceId, "member");
  }

  const userId = await getCurrentUserId();

  await db
    .delete(issueLabels)
    .where(
      and(eq(issueLabels.issueId, issueId), eq(issueLabels.labelId, labelId))
    );

  if (label) {
    await logActivity(
      issueId,
      "label_removed",
      {
        labelId,
        labelName: label.name,
      },
      userId
    );

    const slug = await getWorkspaceSlug(label.workspaceId);
    revalidatePath(slug ? `/w/${slug}` : "/");
  } else {
    revalidatePath("/");
  }

  await db
    .update(issues)
    .set({ updatedAt: new Date() })
    .where(eq(issues.id, issueId));
}

// Comment operations
export async function addComment(
  issueId: string,
  body: string
): Promise<Comment> {
  // Get issue to find workspace
  const issue = await db
    .select()
    .from(issues)
    .where(eq(issues.id, issueId))
    .get();

  if (!issue) throw new Error("Issue not found");

  const workspaceId = await getColumnWorkspaceId(issue.columnId);
  if (workspaceId) {
    await requireWorkspaceAccess(workspaceId, "member");
  }

  const userId = await getCurrentUserId();
  const now = new Date();

  const comment = {
    id: crypto.randomUUID(),
    issueId,
    userId,
    body,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(comments).values(comment);

  await logActivity(issueId, "comment_added", undefined, userId);

  await db.update(issues).set({ updatedAt: now }).where(eq(issues.id, issueId));

  if (workspaceId) {
    const slug = await getWorkspaceSlug(workspaceId);
    revalidatePath(slug ? `/w/${slug}` : "/");
  } else {
    revalidatePath("/");
  }

  return comment;
}

export async function updateComment(
  commentId: string,
  body: string
): Promise<void> {
  // Get comment to check ownership
  const comment = await db
    .select()
    .from(comments)
    .where(eq(comments.id, commentId))
    .get();

  if (!comment) return;

  const userId = await getCurrentUserId();
  // Only allow author to edit their own comments
  if (comment.userId && comment.userId !== userId) {
    throw new Error("You can only edit your own comments");
  }

  await db
    .update(comments)
    .set({ body, updatedAt: new Date() })
    .where(eq(comments.id, commentId));

  revalidatePath("/");
}

export async function deleteComment(commentId: string): Promise<void> {
  const comment = await db
    .select()
    .from(comments)
    .where(eq(comments.id, commentId))
    .get();

  if (!comment) return;

  const userId = await getCurrentUserId();
  // Only allow author to delete their own comments
  if (comment.userId && comment.userId !== userId) {
    throw new Error("You can only delete your own comments");
  }

  await db.delete(comments).where(eq(comments.id, commentId));
  revalidatePath("/");
}

// Get issue with all relations
export async function getIssueWithRelations(
  issueId: string
): Promise<IssueWithLabels | null> {
  const issue = await db
    .select()
    .from(issues)
    .where(eq(issues.id, issueId))
    .get();

  if (!issue) return null;

  const issueLabelsData = await db
    .select({ label: labels })
    .from(issueLabels)
    .innerJoin(labels, eq(issueLabels.labelId, labels.id))
    .where(eq(issueLabels.issueId, issueId));

  return {
    ...issue,
    labels: issueLabelsData.map((il) => il.label),
  };
}

// Get comments for an issue
export async function getIssueComments(issueId: string): Promise<Comment[]> {
  return db
    .select()
    .from(comments)
    .where(eq(comments.issueId, issueId))
    .orderBy(comments.createdAt);
}

// Get activities for an issue
export async function getIssueActivities(issueId: string): Promise<Activity[]> {
  return db
    .select()
    .from(activities)
    .where(eq(activities.issueId, issueId))
    .orderBy(activities.createdAt);
}

// ============================================================================
// Subtask Operations
// ============================================================================

// Get all subtasks for an issue
export async function getIssueSubtasks(
  issueId: string
): Promise<IssueWithLabels[]> {
  const subtasks = await db
    .select()
    .from(issues)
    .where(eq(issues.parentIssueId, issueId))
    .orderBy(issues.position);

  if (subtasks.length === 0) {
    return [];
  }

  // Batch fetch all labels for all subtasks in one query (fixes N+1)
  const subtaskIds = subtasks.map((s) => s.id);
  const allSubtaskLabels = await db
    .select({
      issueId: issueLabels.issueId,
      label: labels,
    })
    .from(issueLabels)
    .innerJoin(labels, eq(issueLabels.labelId, labels.id))
    .where(inArray(issueLabels.issueId, subtaskIds));

  // Build a map of subtaskId -> labels for O(1) lookup
  const labelsBySubtaskId = new Map<string, Label[]>();
  for (const row of allSubtaskLabels) {
    const existing = labelsBySubtaskId.get(row.issueId);
    if (existing) {
      existing.push(row.label);
    } else {
      labelsBySubtaskId.set(row.issueId, [row.label]);
    }
  }

  // Map subtasks with their labels
  return subtasks.map((subtask) => ({
    ...subtask,
    labels: labelsBySubtaskId.get(subtask.id) ?? [],
  }));
}

// Get subtask count for progress tracking
export async function getSubtaskCount(issueId: string): Promise<SubtaskCount> {
  const subtasks = await db
    .select({ status: issues.status })
    .from(issues)
    .where(eq(issues.parentIssueId, issueId));

  const total = subtasks.length;
  const completed = subtasks.filter(
    (s) => s.status === STATUS.DONE || s.status === STATUS.CANCELED
  ).length;

  return { total, completed };
}

// Convert a standalone issue to a subtask
export async function convertToSubtask(
  issueId: string,
  parentIssueId: string
): Promise<void> {
  const issue = await db
    .select()
    .from(issues)
    .where(eq(issues.id, issueId))
    .get();

  if (!issue) throw new Error("Issue not found");

  // Verify the issue is not already a subtask
  if (issue.parentIssueId) {
    throw new Error("Issue is already a subtask");
  }

  const parentIssue = await db
    .select()
    .from(issues)
    .where(eq(issues.id, parentIssueId))
    .get();

  if (!parentIssue) throw new Error("Parent issue not found");

  // Prevent nested subtasks
  if (parentIssue.parentIssueId) {
    throw new Error("Cannot convert to subtask of another subtask");
  }

  // Verify the issue doesn't have its own subtasks
  const existingSubtasks = await db
    .select()
    .from(issues)
    .where(eq(issues.parentIssueId, issueId))
    .get();

  if (existingSubtasks) {
    throw new Error("Cannot convert issue with subtasks to a subtask");
  }

  // Get workspace for auth check
  const workspaceId = await getColumnWorkspaceId(issue.columnId);
  if (workspaceId) {
    await requireWorkspaceAccess(workspaceId, "member");
  }

  const userId = await getCurrentUserId();

  // Get max position among parent's subtasks
  const maxPosition = await db
    .select({ maxPos: sql<number>`COALESCE(MAX(position), -1)` })
    .from(issues)
    .where(eq(issues.parentIssueId, parentIssueId))
    .get();

  // Update the issue to be a subtask (inherit parent's column)
  await db
    .update(issues)
    .set({
      parentIssueId,
      columnId: parentIssue.columnId,
      position: (maxPosition?.maxPos ?? -1) + 1,
      updatedAt: new Date(),
    })
    .where(eq(issues.id, issueId));

  // Log activity on both the issue and parent
  await logActivity(
    issueId,
    "converted_to_subtask",
    {
      parentIssueId,
      parentIdentifier: parentIssue.identifier,
    },
    userId
  );

  await logActivity(
    parentIssueId,
    "subtask_added",
    {
      subtaskId: issueId,
      subtaskIdentifier: issue.identifier,
      subtaskTitle: issue.title,
    },
    userId
  );

  // Revalidate workspace path
  if (workspaceId) {
    const slug = await getWorkspaceSlug(workspaceId);
    revalidatePath(slug ? `/w/${slug}` : "/");
  } else {
    revalidatePath("/");
  }
}

// Mark issue as sent to AI
export async function markSentToAI(issueId: string): Promise<void> {
  const issue = await db
    .select()
    .from(issues)
    .where(eq(issues.id, issueId))
    .get();

  if (!issue) throw new Error("Issue not found");

  // Get workspace for auth check
  const workspaceId = await getColumnWorkspaceId(issue.columnId);
  if (workspaceId) {
    await requireWorkspaceAccess(workspaceId, "member");
  }

  await db
    .update(issues)
    .set({ sentToAI: true, updatedAt: new Date() })
    .where(eq(issues.id, issueId));

  // Revalidate workspace path
  if (workspaceId) {
    const slug = await getWorkspaceSlug(workspaceId);
    revalidatePath(slug ? `/w/${slug}` : "/");
  } else {
    revalidatePath("/");
  }
}

// Convert a subtask to a standalone issue
export async function convertToIssue(
  subtaskId: string,
  columnId: string
): Promise<void> {
  const subtask = await db
    .select()
    .from(issues)
    .where(eq(issues.id, subtaskId))
    .get();

  if (!subtask) throw new Error("Subtask not found");

  if (!subtask.parentIssueId) {
    throw new Error("Issue is not a subtask");
  }

  const parentIssue = await db
    .select()
    .from(issues)
    .where(eq(issues.id, subtask.parentIssueId))
    .get();

  // Get workspace for auth check
  const workspaceId = await getColumnWorkspaceId(columnId);
  if (workspaceId) {
    await requireWorkspaceAccess(workspaceId, "member");
  }

  const userId = await getCurrentUserId();

  // Get max position in target column
  const maxPosition = await db
    .select({ maxPos: sql<number>`COALESCE(MAX(position), -1)` })
    .from(issues)
    .where(and(eq(issues.columnId, columnId), sql`parent_issue_id IS NULL`))
    .get();

  // Remove parent reference and assign to column
  await db
    .update(issues)
    .set({
      parentIssueId: null,
      columnId,
      position: (maxPosition?.maxPos ?? -1) + 1,
      updatedAt: new Date(),
    })
    .where(eq(issues.id, subtaskId));

  // Log activity on the subtask
  await logActivity(
    subtaskId,
    "converted_to_issue",
    {
      parentIssueId: subtask.parentIssueId ?? undefined,
      parentIdentifier: parentIssue?.identifier ?? undefined,
    },
    userId
  );

  // Log activity on the parent if it exists
  if (parentIssue) {
    await logActivity(
      parentIssue.id,
      "subtask_removed",
      {
        subtaskId,
        subtaskIdentifier: subtask.identifier,
        subtaskTitle: subtask.title,
      },
      userId
    );
  }

  // Revalidate workspace path
  if (workspaceId) {
    const slug = await getWorkspaceSlug(workspaceId);
    revalidatePath(slug ? `/w/${slug}` : "/");
  } else {
    revalidatePath("/");
  }
}
