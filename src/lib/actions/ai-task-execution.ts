"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { issues } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
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
 * Execute all pending AI subtasks for a parent issue (parallel execution)
 * @param parentIssueId - The ID of the parent issue
 * @returns Array of Inngest run IDs
 */
export async function executeAllAITasks(
  parentIssueId: string
): Promise<{ runIds: string[] }> {
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

  // Get all AI subtasks that are pending or null status
  const aiSubtasks = await db
    .select()
    .from(issues)
    .where(
      and(
        eq(issues.parentIssueId, parentIssueId),
        eq(issues.aiAssignable, true)
      )
    );

  // Filter to only those with null or pending status
  const pendingSubtasks = aiSubtasks.filter(
    (s) => s.aiExecutionStatus === null || s.aiExecutionStatus === "pending"
  );

  if (pendingSubtasks.length === 0) {
    return { runIds: [] };
  }

  // Update all to pending status
  const subtaskIds = pendingSubtasks.map((s) => s.id);
  for (const id of subtaskIds) {
    await db
      .update(issues)
      .set({
        aiExecutionStatus: "pending",
        updatedAt: new Date(),
      })
      .where(eq(issues.id, id));
  }

  // Send events to Inngest (parallel execution)
  const events = pendingSubtasks.map((subtask) => ({
    name: "ai/task.execute" as const,
    data: {
      issueId: subtask.id,
      workspaceId,
      parentIssueId,
    },
  }));

  const result = await inngest.send(events);

  // Revalidate workspace path
  const slug = await getWorkspaceSlug(workspaceId);
  revalidatePath(slug ? `/w/${slug}` : "/");

  return { runIds: result.ids };
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
