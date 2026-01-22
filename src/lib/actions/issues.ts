"use server";

import { revalidatePath } from "next/cache";
import { db } from "../db";
import {
  issues,
  boards,
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
} from "../types";
import { STATUS } from "../design-tokens";

// Helper to generate next identifier
async function getNextIdentifier(boardId: string): Promise<string> {
  const board = await db
    .select({ identifier: boards.identifier, counter: boards.issueCounter })
    .from(boards)
    .where(eq(boards.id, boardId))
    .get();

  if (!board) throw new Error("Board not found");

  const newCounter = board.counter + 1;

  await db
    .update(boards)
    .set({ issueCounter: newCounter })
    .where(eq(boards.id, boardId));

  return `${board.identifier}-${newCounter}`;
}

// Helper to log activity
async function logActivity(
  issueId: string,
  type: ActivityType,
  data?: ActivityData
): Promise<void> {
  await db.insert(activities).values({
    id: crypto.randomUUID(),
    issueId,
    type,
    data: data ? JSON.stringify(data) : null,
    createdAt: new Date(),
  });
}

// Get column's board ID
async function getColumnBoardId(columnId: string): Promise<string | null> {
  const column = await db
    .select({ boardId: columns.boardId })
    .from(columns)
    .where(eq(columns.id, columnId))
    .get();
  return column?.boardId ?? null;
}

export async function createIssue(
  columnId: string,
  input: CreateIssueInput
): Promise<IssueWithLabels> {
  const boardId = await getColumnBoardId(columnId);
  if (!boardId) throw new Error("Column not found");

  const identifier = await getNextIdentifier(boardId);

  // Get max position
  const maxPosition = await db
    .select({ maxPos: sql<number>`COALESCE(MAX(position), -1)` })
    .from(issues)
    .where(eq(issues.columnId, columnId))
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
    position: (maxPosition?.maxPos ?? -1) + 1,
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

  // Log activity
  await logActivity(newIssue.id, "created");

  revalidatePath("/");

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
    await logActivity(issueId, "status_changed", {
      oldValue: existingIssue.status,
      newValue: input.status,
    });
  }

  if (
    input.priority !== undefined &&
    input.priority !== existingIssue.priority
  ) {
    updates.priority = input.priority;
    await logActivity(issueId, "priority_changed", {
      oldValue: existingIssue.priority,
      newValue: input.priority,
    });
  }

  if (input.estimate !== undefined) {
    updates.estimate = input.estimate ?? null;
  }

  if (input.dueDate !== undefined) {
    updates.dueDate = input.dueDate ?? null;
  }

  if (input.cycleId !== undefined && input.cycleId !== existingIssue.cycleId) {
    updates.cycleId = input.cycleId ?? null;
    await logActivity(issueId, "cycle_changed", {
      oldValue: existingIssue.cycleId,
      newValue: input.cycleId ?? null,
    });
  }

  await db.update(issues).set(updates).where(eq(issues.id, issueId));

  // Log general update if there were field changes
  if (changedFields.length > 0) {
    await logActivity(issueId, "updated", {
      field: changedFields.map((c) => c.field).join(", "),
    });
  }

  revalidatePath("/");
}

export async function deleteIssue(issueId: string): Promise<void> {
  const issue = await db
    .select()
    .from(issues)
    .where(eq(issues.id, issueId))
    .get();

  if (!issue) return;

  await db.delete(issues).where(eq(issues.id, issueId));

  // Update positions of remaining issues in column
  await db
    .update(issues)
    .set({ position: sql`position - 1` })
    .where(
      and(eq(issues.columnId, issue.columnId), gt(issues.position, issue.position))
    );

  revalidatePath("/");
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

    // Log the move
    await logActivity(issueId, "moved", {
      fromColumn: sourceColumnId,
      toColumn: targetColumnId,
    });
  }

  revalidatePath("/");
}

// Label operations
export async function addLabel(issueId: string, labelId: string): Promise<void> {
  const label = await db
    .select()
    .from(labels)
    .where(eq(labels.id, labelId))
    .get();

  if (!label) return;

  await db.insert(issueLabels).values({ issueId, labelId }).onConflictDoNothing();

  await logActivity(issueId, "label_added", {
    labelId,
    labelName: label.name,
  });

  await db
    .update(issues)
    .set({ updatedAt: new Date() })
    .where(eq(issues.id, issueId));

  revalidatePath("/");
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

  await db
    .delete(issueLabels)
    .where(
      and(eq(issueLabels.issueId, issueId), eq(issueLabels.labelId, labelId))
    );

  if (label) {
    await logActivity(issueId, "label_removed", {
      labelId,
      labelName: label.name,
    });
  }

  await db
    .update(issues)
    .set({ updatedAt: new Date() })
    .where(eq(issues.id, issueId));

  revalidatePath("/");
}

// Comment operations
export async function addComment(
  issueId: string,
  body: string
): Promise<Comment> {
  const now = new Date();
  const comment: Comment = {
    id: crypto.randomUUID(),
    issueId,
    body,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(comments).values(comment);

  await logActivity(issueId, "comment_added");

  await db
    .update(issues)
    .set({ updatedAt: now })
    .where(eq(issues.id, issueId));

  revalidatePath("/");

  return comment;
}

export async function updateComment(
  commentId: string,
  body: string
): Promise<void> {
  await db
    .update(comments)
    .set({ body, updatedAt: new Date() })
    .where(eq(comments.id, commentId));

  revalidatePath("/");
}

export async function deleteComment(commentId: string): Promise<void> {
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
