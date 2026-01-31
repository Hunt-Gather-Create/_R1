import { inngest } from "../client";
import { db } from "@/lib/db";
import { backgroundJobs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * Track when an Inngest function is invoked
 * Creates a new job record with status "running"
 */
export const trackFunctionInvoked = inngest.createFunction(
  {
    id: "job-tracker-invoked",
    name: "Track Function Invoked",
    retries: 0, // Don't retry tracking functions
  },
  { event: "inngest/function.invoked" },
  async ({ event }) => {
    const { function_id, run_id, event: originalEvent } = event.data;

    // Skip tracking our own tracker functions to avoid infinite loops
    if (function_id.startsWith("job-tracker")) {
      return { skipped: true, reason: "tracker function" };
    }

    // Extract workspaceId from the original event data
    const workspaceId = originalEvent?.data?.workspaceId;
    if (!workspaceId) {
      return { skipped: true, reason: "no workspaceId in event data" };
    }

    // Extract function name from function_id (convert kebab-case to Title Case)
    const functionName = function_id
      .split("-")
      .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");

    // Extract metadata from original event
    const metadata = originalEvent?.data?.metadata ?? {
      description: originalEvent?.data?.description,
    };

    await db.insert(backgroundJobs).values({
      workspaceId,
      functionId: function_id,
      functionName,
      runId: run_id,
      correlationId: originalEvent?.data?.correlationId,
      status: "running",
      metadata: metadata ? JSON.stringify(metadata) : null,
      attempt: 1,
      maxAttempts: 3, // Default, could be extracted from function config
    });

    return { tracked: true, runId: run_id };
  }
);

/**
 * Track when an Inngest function completes successfully
 * Updates the job record with status "completed" and stores the result
 */
export const trackFunctionFinished = inngest.createFunction(
  {
    id: "job-tracker-finished",
    name: "Track Function Finished",
    retries: 0,
  },
  { event: "inngest/function.finished" },
  async ({ event }) => {
    const { function_id, run_id } = event.data;
    // Result is only present on success, need to check union type
    const result = "result" in event.data ? event.data.result : null;

    // Skip tracker functions
    if (function_id.startsWith("job-tracker")) {
      return { skipped: true, reason: "tracker function" };
    }

    await db
      .update(backgroundJobs)
      .set({
        status: "completed",
        completedAt: new Date(),
        result: result ? JSON.stringify(result) : null,
      })
      .where(eq(backgroundJobs.runId, run_id));

    return { updated: true, runId: run_id };
  }
);

/**
 * Track when an Inngest function fails
 * Updates the job record with status "failed" and stores the error
 */
export const trackFunctionFailed = inngest.createFunction(
  {
    id: "job-tracker-failed",
    name: "Track Function Failed",
    retries: 0,
  },
  { event: "inngest/function.failed" },
  async ({ event }) => {
    const { function_id, run_id } = event.data;
    // Error is only present on failure, need to check union type
    const error = "error" in event.data ? event.data.error : null;

    // Skip tracker functions
    if (function_id.startsWith("job-tracker")) {
      return { skipped: true, reason: "tracker function" };
    }

    const errorMessage =
      typeof error === "string"
        ? error
        : (error as { message?: string } | null)?.message ?? "Unknown error";

    await db
      .update(backgroundJobs)
      .set({
        status: "failed",
        completedAt: new Date(),
        error: errorMessage,
      })
      .where(eq(backgroundJobs.runId, run_id));

    return { updated: true, runId: run_id, error: errorMessage };
  }
);
