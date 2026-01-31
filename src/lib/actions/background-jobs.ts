"use server";

import { db } from "@/lib/db";
import { backgroundJobs } from "@/lib/db/schema";
import { eq, and, desc, inArray, lt } from "drizzle-orm";
import type { JobStatus, JobsQueryOptions, BackgroundJob } from "@/lib/types";

/**
 * Get all jobs for a workspace with optional filtering
 */
export async function getWorkspaceJobs(
  workspaceId: string,
  options: JobsQueryOptions = {}
): Promise<BackgroundJob[]> {
  const { status, limit = 50, offset = 0 } = options;

  const conditions = [eq(backgroundJobs.workspaceId, workspaceId)];

  // Add status filter if provided
  if (status) {
    const statuses = Array.isArray(status) ? status : [status];
    conditions.push(inArray(backgroundJobs.status, statuses));
  }

  return db
    .select()
    .from(backgroundJobs)
    .where(and(...conditions))
    .orderBy(desc(backgroundJobs.startedAt))
    .limit(limit)
    .offset(offset);
}

/**
 * Get a single job by ID
 */
export async function getJob(jobId: string): Promise<BackgroundJob | null> {
  const [job] = await db
    .select()
    .from(backgroundJobs)
    .where(eq(backgroundJobs.id, jobId))
    .limit(1);

  return job ?? null;
}

/**
 * Get a job by run ID (Inngest's unique execution ID)
 */
export async function getJobByRunId(runId: string): Promise<BackgroundJob | null> {
  const [job] = await db
    .select()
    .from(backgroundJobs)
    .where(eq(backgroundJobs.runId, runId))
    .limit(1);

  return job ?? null;
}

/**
 * Cancel a pending job
 * Note: This only updates the database status.
 * Actually cancelling the Inngest run would require their API.
 */
export async function cancelJob(jobId: string): Promise<BackgroundJob | null> {
  const [job] = await db
    .select()
    .from(backgroundJobs)
    .where(eq(backgroundJobs.id, jobId))
    .limit(1);

  if (!job) {
    return null;
  }

  // Can only cancel pending or running jobs
  if (job.status !== "pending" && job.status !== "running") {
    return job;
  }

  await db
    .update(backgroundJobs)
    .set({
      status: "cancelled",
      completedAt: new Date(),
    })
    .where(eq(backgroundJobs.id, jobId));

  return { ...job, status: "cancelled", completedAt: new Date() };
}

/**
 * Clean up old completed/failed jobs
 * Keeps jobs newer than the specified number of days
 */
export async function cleanupOldJobs(
  workspaceId: string,
  daysToKeep: number = 30
): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

  const result = await db
    .delete(backgroundJobs)
    .where(
      and(
        eq(backgroundJobs.workspaceId, workspaceId),
        inArray(backgroundJobs.status, ["completed", "failed", "cancelled"]),
        lt(backgroundJobs.completedAt, cutoffDate)
      )
    );

  // Return number of deleted rows (libsql returns changes in meta)
  return result.rowsAffected ?? 0;
}

/**
 * Get job statistics for a workspace
 */
export async function getJobStats(workspaceId: string) {
  const jobs = await db
    .select()
    .from(backgroundJobs)
    .where(eq(backgroundJobs.workspaceId, workspaceId));

  const stats = {
    total: jobs.length,
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };

  for (const job of jobs) {
    const status = job.status as JobStatus;
    if (status in stats) {
      stats[status]++;
    }
  }

  return stats;
}
