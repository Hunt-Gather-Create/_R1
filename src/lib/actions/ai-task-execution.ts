"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { issues } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { inngest } from "@/lib/inngest/client";
import { requireWorkspaceAccess } from "./workspace";
import { getWorkspaceSlug, getWorkspaceIdFromIssue } from "./helpers";
import type { AIExecutionStatus } from "@/lib/types";

/**
 * Execute a single AI subtask
 * @param issueId - The ID of the subtask to execute
 * @returns The Inngest run ID
 */
export async function executeAITask(
  issueId: string
): Promise<{ runId: string }> {
  // Get the subtask
  const subtask = await db
    .select()
    .from(issues)
    .where(eq(issues.id, issueId))
    .get();

  if (!subtask) {
    throw new Error("Subtask not found");
  }

  if (!subtask.aiAssignable) {
    throw new Error("Subtask is not AI-assignable");
  }

  if (!subtask.parentIssueId) {
    throw new Error("Issue is not a subtask");
  }

  // Get workspace ID for auth check
  const workspaceId = await getWorkspaceIdFromIssue(issueId);
  if (!workspaceId) {
    throw new Error("Workspace not found");
  }

  // Verify user has access
  await requireWorkspaceAccess(workspaceId, "member");

  // Update status to pending
  await db
    .update(issues)
    .set({
      aiExecutionStatus: "pending",
      updatedAt: new Date(),
    })
    .where(eq(issues.id, issueId));

  // Send event to Inngest
  const result = await inngest.send({
    name: "ai/task.execute",
    data: {
      issueId,
      workspaceId,
      parentIssueId: subtask.parentIssueId,
    },
  });

  // Revalidate workspace path
  const slug = await getWorkspaceSlug(workspaceId);
  revalidatePath(slug ? `/w/${slug}` : "/");

  return { runId: result.ids[0] };
}

/**
 * Execute all pending AI subtasks for a parent issue (sequential execution).
 * Subtasks run in position order so each can reference outputs from prior subtasks.
 * @param parentIssueId - The ID of the parent issue
 * @returns The Inngest run ID for the sequential execution
 */
export async function executeAllAITasks(
  parentIssueId: string
): Promise<{ runId: string | null }> {
  // Get parent issue
  const parentIssue = await db
    .select()
    .from(issues)
    .where(eq(issues.id, parentIssueId))
    .get();

  if (!parentIssue) {
    throw new Error("Parent issue not found");
  }

  // Get workspace ID for auth check
  const workspaceId = await getWorkspaceIdFromIssue(parentIssueId);
  if (!workspaceId) {
    throw new Error("Workspace not found");
  }

  // Verify user has access
  await requireWorkspaceAccess(workspaceId, "member");

  // Get all AI subtasks ordered by position (execution order)
  const aiSubtasks = await db
    .select()
    .from(issues)
    .where(
      and(
        eq(issues.parentIssueId, parentIssueId),
        eq(issues.aiAssignable, true)
      )
    )
    .orderBy(issues.position);

  // Filter to only those with null or pending status.
  // Failed tasks are excluded — they can be retried individually via the play button
  // to avoid breaking the sequential dependency chain.
  const pendingSubtasks = aiSubtasks.filter(
    (s) => s.aiExecutionStatus === null || s.aiExecutionStatus === "pending"
  );

  if (pendingSubtasks.length === 0) {
    return { runId: null };
  }

  // Batch update all to pending status
  await db
    .update(issues)
    .set({
      aiExecutionStatus: "pending",
      updatedAt: new Date(),
    })
    .where(inArray(issues.id, pendingSubtasks.map((s) => s.id)));

  // Send a single sequential execution event
  const result = await inngest.send({
    name: "ai/tasks.executeSequential",
    data: {
      parentIssueId,
      workspaceId,
      subtaskIds: pendingSubtasks.map((s) => s.id),
    },
  });

  // Revalidate workspace path
  const slug = await getWorkspaceSlug(workspaceId);
  revalidatePath(slug ? `/w/${slug}` : "/");

  return { runId: result.ids[0] };
}

/**
 * Get AI task execution status
 * @param issueId - The ID of the subtask
 * @returns Execution status and result
 */
export async function getAITaskStatus(issueId: string): Promise<{
  status: AIExecutionStatus;
  result?: unknown;
  summary?: string;
}> {
  const issue = await db
    .select({
      aiExecutionStatus: issues.aiExecutionStatus,
      aiExecutionResult: issues.aiExecutionResult,
      aiExecutionSummary: issues.aiExecutionSummary,
    })
    .from(issues)
    .where(eq(issues.id, issueId))
    .get();

  if (!issue) {
    throw new Error("Issue not found");
  }

  return {
    status: issue.aiExecutionStatus as AIExecutionStatus,
    result: issue.aiExecutionResult
      ? JSON.parse(issue.aiExecutionResult)
      : undefined,
    summary: issue.aiExecutionSummary ?? undefined,
  };
}
