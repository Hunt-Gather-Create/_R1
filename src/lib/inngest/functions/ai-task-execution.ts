import { inngest } from "../client";
import { db } from "@/lib/db";
import { issues, workspaces, brands, attachments, activities, columns, backgroundJobs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { recordTokenUsage } from "@/lib/token-usage";
import { generateStorageKey, uploadContent, generateDownloadUrl } from "@/lib/storage/r2-client";
import type { WorkspaceSoul, Brand, AttachmentWithUrl } from "@/lib/types";
import { buildBrandSystemPrompt, type BrandPromptInput } from "@/lib/brand-formatters";

// Use Haiku for fast, cost-effective execution
const EXECUTION_MODEL = "claude-haiku-4-5-20251001";

// Limit tool usage to prevent runaway loops
const MAX_TOOL_USES = 3;

/**
 * Get workspace ID from an issue (no auth required).
 * Used by background jobs.
 */
async function getWorkspaceIdFromIssue(issueId: string): Promise<string | null> {
  const issue = await db
    .select({ columnId: issues.columnId })
    .from(issues)
    .where(eq(issues.id, issueId))
    .get();

  if (!issue) return null;

  const column = await db
    .select({ workspaceId: columns.workspaceId })
    .from(columns)
    .where(eq(columns.id, issue.columnId))
    .get();

  return column?.workspaceId ?? null;
}

/**
 * Attach AI-generated content to an issue (no auth required).
 * Used by background jobs that don't have a user session.
 */
async function attachContentFromBackgroundJob(
  issueId: string,
  content: string,
  filename: string,
  mimeType: string = "text/markdown"
): Promise<AttachmentWithUrl> {
  const workspaceId = await getWorkspaceIdFromIssue(issueId);
  if (!workspaceId) {
    throw new Error("Issue not found");
  }

  // Generate storage key and upload content
  const storageKey = generateStorageKey(workspaceId, issueId, filename);
  await uploadContent(storageKey, content, mimeType);

  // Create attachment record
  const attachmentId = crypto.randomUUID();
  const now = new Date();
  const size = Buffer.byteLength(content, "utf-8");

  await db.insert(attachments).values({
    id: attachmentId,
    issueId,
    userId: null, // Background job - no user
    filename,
    storageKey,
    mimeType,
    size,
    createdAt: now,
  });

  // Log activity
  await db.insert(activities).values({
    id: crypto.randomUUID(),
    issueId,
    userId: null, // Background job - no user
    type: "attachment_added",
    data: JSON.stringify({
      attachmentId,
      attachmentFilename: filename,
      source: "ai-task-execution",
    }),
    createdAt: now,
  });

  // Update issue updatedAt
  await db
    .update(issues)
    .set({ updatedAt: now })
    .where(eq(issues.id, issueId));

  // Generate signed URL
  const url = await generateDownloadUrl(storageKey, 900);

  return {
    id: attachmentId,
    issueId,
    userId: null,
    filename,
    storageKey,
    mimeType,
    size,
    createdAt: now,
    url,
  };
}

/**
 * Build system prompt with parent issue context.
 * Returns two parts: static (cacheable) and dynamic (per-task).
 * The static part is placed first to maximize cache hits across parallel tasks.
 */
export interface PreviousTaskResult {
  identifier: string;
  title: string;
  summary: string;
}

/** @internal Exported for testing */
export function buildSystemPrompt(
  parentIssue: { identifier: string; title: string; description: string | null } | null,
  subtaskTitle: string,
  subtaskDescription: string | null,
  aiInstructions: string | null,
  soul?: WorkspaceSoul | null,
  brand?: BrandPromptInput | null,
  previousResults?: PreviousTaskResult[]
): { staticPart: string; dynamicPart: string } {
  // Static part - same across all tasks in a workspace (cacheable)
  const staticParts: string[] = [];

  if (soul) {
    staticParts.push(`You are ${soul.name}. ${soul.personality}

Tone: ${soul.tone}
Response Length: ${soul.responseLength}`);
  }

  // Add brand context if available (static, cacheable across tasks)
  if (brand?.summary) {
    staticParts.push(buildBrandSystemPrompt(brand));
  }

  staticParts.push(`You are completing a subtask as part of a larger project. Use the tools available to research if needed.

## Tools Available
- **web_search**: Search the web for current information
- **web_fetch**: Fetch and read content from specific URLs

## Output Format
Provide your complete response as well-formatted markdown. Be thorough but concise. Focus on actionable, specific content relevant to the parent issue context.`);

  // Dynamic part - unique per task
  const dynamicParts: string[] = [];

  dynamicParts.push(`## Parent Issue Context
${parentIssue ? `**${parentIssue.identifier}: ${parentIssue.title}**
${parentIssue.description || "No description provided."}` : "No parent context available."}`);

  if (previousResults && previousResults.length > 0) {
    const resultsText = previousResults
      .map((r) => `### ${r.identifier}: ${r.title}\n${r.summary}`)
      .join("\n\n");
    dynamicParts.push(`## Completed Prior Subtasks
The following subtasks have already been completed (in order). Reference their outputs to avoid duplicating work and to build on their findings.

${resultsText}`);
  }

  dynamicParts.push(`## Your Subtask
**Title:** ${subtaskTitle}
${subtaskDescription ? `**Description:** ${subtaskDescription}` : ""}
${aiInstructions ? `**Special Instructions:** ${aiInstructions}` : ""}`);

  return {
    staticPart: staticParts.join("\n\n"),
    dynamicPart: dynamicParts.join("\n\n"),
  };
}

/**
 * Inngest function for executing AI tasks.
 * Uses web_search and web_fetch tools with maxUses limits to prevent runaway loops.
 */
export const executeAITask = inngest.createFunction(
  {
    id: "ai-task-execution",
    name: "AI Task Execution",
    retries: 1,
    concurrency: { limit: 5 },
    onFailure: async ({ event, error }) => {
      const { issueId, workspaceId } = event.data.event.data;
      const runId = event.data.run_id;
      console.error(`[AI Task] Function failed for ${issueId}:`, error);

      try {
        // Update issue status
        await db
          .update(issues)
          .set({
            aiExecutionStatus: "failed",
            aiExecutionSummary: `Execution failed: ${error.message}`,
            updatedAt: new Date(),
          })
          .where(eq(issues.id, issueId));

        // Update job status
        await db
          .update(backgroundJobs)
          .set({
            status: "failed",
            completedAt: new Date(),
            error: error.message,
          })
          .where(eq(backgroundJobs.runId, runId));
      } catch (dbError) {
        console.error(`[AI Task] Failed to update status:`, dbError);
      }
    },
  },
  { event: "ai/task.execute" },
  async ({ event, step, runId }) => {
    const { issueId, workspaceId, parentIssueId } = event.data;

    // Step 1: Load context, create job record, and mark as running
    const context = await step.run("load-context", async () => {
      const subtask = await db
        .select()
        .from(issues)
        .where(eq(issues.id, issueId))
        .get();

      if (!subtask) throw new Error(`Subtask not found: ${issueId}`);
      if (!subtask.aiAssignable) throw new Error(`Subtask is not AI-assignable: ${issueId}`);

      // Load parent issue for context
      const parentIssue = await db
        .select()
        .from(issues)
        .where(eq(issues.id, parentIssueId))
        .get();

      const workspace = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .get();

      // Fetch brand if workspace has one linked
      let brand: Brand | null = null;
      if (workspace?.brandId) {
        brand = await db
          .select()
          .from(brands)
          .where(eq(brands.id, workspace.brandId))
          .get() ?? null;
      }

      // Create job record for tracking
      await db.insert(backgroundJobs).values({
        id: crypto.randomUUID(),
        workspaceId,
        functionId: "ai-task-execution",
        functionName: "AI Task Execution",
        runId,
        status: "running",
        startedAt: new Date(),
        metadata: JSON.stringify({
          issueId,
          parentIssueId,
          subtaskTitle: subtask.title,
          subtaskIdentifier: subtask.identifier,
        }),
        attempt: 1,
        maxAttempts: 2,
      }).onConflictDoNothing(); // In case of retry, don't create duplicate

      // Mark subtask as running
      await db
        .update(issues)
        .set({ aiExecutionStatus: "running", updatedAt: new Date() })
        .where(eq(issues.id, issueId));

      const soul = workspace?.soul ? (JSON.parse(workspace.soul) as WorkspaceSoul) : null;

      return { subtask, parentIssue: parentIssue ?? null, soul, brand };
    });

    // Step 2: Execute AI with web tools and prompt caching
    const executionResult = await step.run("execute-ai", async () => {
      const { subtask, parentIssue, soul, brand } = context;

      const { staticPart, dynamicPart } = buildSystemPrompt(
        parentIssue,
        subtask.title,
        subtask.description,
        subtask.aiInstructions,
        soul,
        brand
      );

      // Combine system prompt parts - static part first for better cache hits
      const fullSystemPrompt = `${staticPart}\n\n${dynamicPart}`;

      // Use messages array with cache control for prompt caching
      // Cache the system prompt - when multiple tasks run in parallel,
      // subsequent requests within 5 minutes can reuse the cached prefix
      const cacheControl = { cacheControl: { type: "ephemeral" as const } };

      const result = await generateText({
        model: anthropic(EXECUTION_MODEL),
        messages: [
          {
            role: "system" as const,
            content: fullSystemPrompt,
            providerOptions: { anthropic: cacheControl },
          },
          {
            role: "user" as const,
            content: "Complete the subtask described above. Use web_search and web_fetch if you need current information. Provide your response as markdown.",
          },
        ],
        tools: {
          web_search: anthropic.tools.webSearch_20250305({ maxUses: MAX_TOOL_USES }),
          web_fetch: anthropic.tools.webFetch_20250910({ maxUses: MAX_TOOL_USES }),
        },
        maxRetries: 0,
      });

      // Extract cache token details (same pattern as chat implementation)
      const usage = result.usage as typeof result.usage & {
        inputTokenDetails?: {
          cacheReadTokens?: number;
          cacheWriteTokens?: number;
        };
      };
      const cacheDetails = usage.inputTokenDetails;

      return {
        content: result.text,
        usage: {
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          cacheCreationInputTokens: cacheDetails?.cacheWriteTokens ?? 0,
          cacheReadInputTokens: cacheDetails?.cacheReadTokens ?? 0,
        },
      };
    });

    // Step 3: Track token usage (including cache metrics)
    await step.run("track-usage", async () => {
      await recordTokenUsage({
        workspaceId,
        model: EXECUTION_MODEL,
        inputTokens: executionResult.usage.inputTokens,
        outputTokens: executionResult.usage.outputTokens,
        cacheCreationInputTokens: executionResult.usage.cacheCreationInputTokens,
        cacheReadInputTokens: executionResult.usage.cacheReadInputTokens,
        source: "ai-task-execution",
      });
    });

    // Step 4: Save attachment to parent issue
    const attachmentResult = await step.run("save-attachment", async () => {
      if (!executionResult.content) {
        return { attached: false, reason: "No content" };
      }

      const filename = `${context.subtask.identifier}-output.md`;

      try {
        const attachment = await attachContentFromBackgroundJob(
          parentIssueId,
          executionResult.content,
          filename,
          "text/markdown"
        );
        return { attached: true, attachmentId: attachment.id, filename };
      } catch (error) {
        console.error("[AI Task] Failed to attach content:", error);
        return { attached: false, reason: error instanceof Error ? error.message : "Unknown error" };
      }
    });

    // Step 5: Finalize - update subtask and job with results
    const finalResult = await step.run("finalize", async () => {
      const hasContent = !!executionResult.content;
      const status = hasContent ? "completed" : "failed";

      // Create a brief summary from the content
      const summary = hasContent
        ? `Task completed. Output saved as ${attachmentResult.attached ? "attachment" : "text"}.`
        : "Task failed - no content generated.";

      // Update issue status
      await db
        .update(issues)
        .set({
          aiExecutionStatus: status,
          aiExecutionResult: JSON.stringify({ content: executionResult.content }),
          aiExecutionSummary: summary,
          status: status === "completed" ? "done" : context.subtask.status,
          updatedAt: new Date(),
        })
        .where(eq(issues.id, issueId));

      // Update job status
      await db
        .update(backgroundJobs)
        .set({
          status,
          completedAt: new Date(),
          result: JSON.stringify({
            summary,
            attached: attachmentResult.attached,
            attachmentId: "attachmentId" in attachmentResult ? attachmentResult.attachmentId : undefined,
          }),
        })
        .where(eq(backgroundJobs.runId, runId));

      return { status, summary, attached: attachmentResult.attached };
    });

    return finalResult;
  }
);

/**
 * Inngest function for executing AI tasks sequentially.
 * Each subtask receives the outputs of all previously completed subtasks
 * so it can build on prior work and avoid duplication.
 */
export const executeAllAITasksSequential = inngest.createFunction(
  {
    id: "ai-tasks-sequential-execution",
    name: "AI Tasks Sequential Execution",
    retries: 1,
    // Lower concurrency — each invocation processes multiple subtasks in series
    concurrency: { limit: 3 },
    onFailure: async ({ event, error }) => {
      const { parentIssueId, subtaskIds } = event.data.event.data;
      const runId = event.data.run_id;
      console.error(`[AI Tasks Sequential] Function failed for parent ${parentIssueId}:`, error);

      try {
        // Mark any subtasks still stuck in pending/running as failed
        for (const subtaskId of subtaskIds) {
          const subtask = await db.select({ status: issues.aiExecutionStatus }).from(issues).where(eq(issues.id, subtaskId)).get();
          if (subtask && (subtask.status === "pending" || subtask.status === "running")) {
            await db
              .update(issues)
              .set({
                aiExecutionStatus: "failed",
                aiExecutionSummary: `Sequential execution failed: ${error.message}`,
                updatedAt: new Date(),
              })
              .where(eq(issues.id, subtaskId));
          }
        }

        // Update job status
        await db
          .update(backgroundJobs)
          .set({
            status: "failed",
            completedAt: new Date(),
            error: error.message,
          })
          .where(eq(backgroundJobs.runId, runId));
      } catch (dbError) {
        console.error(`[AI Tasks Sequential] Failed to update status:`, dbError);
      }
    },
  },
  { event: "ai/tasks.executeSequential" },
  async ({ event, step, runId }) => {
    const { parentIssueId, workspaceId, subtaskIds } = event.data;

    // Step 1: Load shared context (workspace, parent issue, soul, brand)
    const sharedContext = await step.run("load-shared-context", async () => {
      const parentIssue = await db
        .select()
        .from(issues)
        .where(eq(issues.id, parentIssueId))
        .get();

      const workspace = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .get();

      let brand: Brand | null = null;
      if (workspace?.brandId) {
        brand = await db
          .select()
          .from(brands)
          .where(eq(brands.id, workspace.brandId))
          .get() ?? null;
      }

      const soul = workspace?.soul ? (JSON.parse(workspace.soul) as WorkspaceSoul) : null;

      // Create a single job record for the whole sequential run
      await db.insert(backgroundJobs).values({
        id: crypto.randomUUID(),
        workspaceId,
        functionId: "ai-tasks-sequential-execution",
        functionName: "AI Tasks Sequential Execution",
        runId,
        status: "running",
        startedAt: new Date(),
        metadata: JSON.stringify({
          parentIssueId,
          subtaskCount: subtaskIds.length,
        }),
        attempt: 1,
        maxAttempts: 2,
      }).onConflictDoNothing();

      return { parentIssue: parentIssue ?? null, soul, brand };
    });

    // Step 2+: Execute each subtask sequentially, accumulating results.
    // NOTE on Inngest replay safety: these mutable arrays live outside step.run()
    // but are safe because on replay, the outer code re-executes and completed
    // step.run() calls return their memoized results instantly, re-populating
    // the arrays in order before the next step executes.
    const completedResults: PreviousTaskResult[] = [];
    const results: Array<{ issueId: string; status: string; summary: string }> = [];

    for (let i = 0; i < subtaskIds.length; i++) {
      const subtaskId = subtaskIds[i];

      const taskResult = await step.run(`execute-subtask-${i}`, async () => {
        // Load this specific subtask
        const subtask = await db
          .select()
          .from(issues)
          .where(eq(issues.id, subtaskId))
          .get();

        if (!subtask) {
          return { issueId: subtaskId, status: "failed" as const, summary: "Subtask not found", content: null };
        }

        if (!subtask.aiAssignable) {
          return { issueId: subtaskId, status: "failed" as const, summary: "Subtask is not AI-assignable", content: null };
        }

        // Mark as running
        await db
          .update(issues)
          .set({ aiExecutionStatus: "running", updatedAt: new Date() })
          .where(eq(issues.id, subtaskId));

        // Build prompt with previous results for context chaining
        const { staticPart, dynamicPart } = buildSystemPrompt(
          sharedContext.parentIssue,
          subtask.title,
          subtask.description,
          subtask.aiInstructions,
          sharedContext.soul,
          sharedContext.brand,
          completedResults
        );

        const fullSystemPrompt = `${staticPart}\n\n${dynamicPart}`;
        const cacheControl = { cacheControl: { type: "ephemeral" as const } };

        try {
          const result = await generateText({
            model: anthropic(EXECUTION_MODEL),
            messages: [
              {
                role: "system" as const,
                content: fullSystemPrompt,
                providerOptions: { anthropic: cacheControl },
              },
              {
                role: "user" as const,
                content: "Complete the subtask described above. Use web_search and web_fetch if you need current information. Provide your response as markdown.",
              },
            ],
            tools: {
              web_search: anthropic.tools.webSearch_20250305({ maxUses: MAX_TOOL_USES }),
              web_fetch: anthropic.tools.webFetch_20250910({ maxUses: MAX_TOOL_USES }),
            },
            maxRetries: 0,
          });

          // Track token usage
          const usage = result.usage as typeof result.usage & {
            inputTokenDetails?: {
              cacheReadTokens?: number;
              cacheWriteTokens?: number;
            };
          };
          const cacheDetails = usage.inputTokenDetails;

          await recordTokenUsage({
            workspaceId,
            model: EXECUTION_MODEL,
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
            cacheCreationInputTokens: cacheDetails?.cacheWriteTokens ?? 0,
            cacheReadInputTokens: cacheDetails?.cacheReadTokens ?? 0,
            source: "ai-task-execution",
          });

          // Save attachment to parent issue
          let attached = false;
          if (result.text) {
            try {
              await attachContentFromBackgroundJob(
                parentIssueId,
                result.text,
                `${subtask.identifier}-output.md`,
                "text/markdown"
              );
              attached = true;
            } catch (attachErr) {
              console.error(`[AI Tasks Sequential] Failed to attach content for ${subtaskId}:`, attachErr);
            }
          }

          const hasContent = !!result.text;
          const status = hasContent ? "completed" : "failed";
          const summary = hasContent
            ? `Task completed. Output saved as ${attached ? "attachment" : "text"}.`
            : "Task failed - no content generated.";

          // Update subtask status
          await db
            .update(issues)
            .set({
              aiExecutionStatus: status,
              aiExecutionResult: JSON.stringify({ content: result.text }),
              aiExecutionSummary: summary,
              status: status === "completed" ? "done" : subtask.status,
              updatedAt: new Date(),
            })
            .where(eq(issues.id, subtaskId));

          return {
            issueId: subtaskId,
            identifier: subtask.identifier,
            title: subtask.title,
            status,
            summary,
            content: result.text,
          };
        } catch (execError) {
          const errorMessage = execError instanceof Error ? execError.message : "Unknown error";
          console.error(`[AI Tasks Sequential] Execution failed for ${subtaskId}:`, execError);

          await db
            .update(issues)
            .set({
              aiExecutionStatus: "failed",
              aiExecutionSummary: `Execution failed: ${errorMessage}`,
              updatedAt: new Date(),
            })
            .where(eq(issues.id, subtaskId));

          return { issueId: subtaskId, status: "failed" as const, summary: `Failed: ${errorMessage}`, content: null };
        }
      });

      // Accumulate results so next subtask can reference them
      if (taskResult.status === "completed" && taskResult.content) {
        completedResults.push({
          identifier: (taskResult as { identifier: string }).identifier,
          title: (taskResult as { title: string }).title,
          // Pass a truncated version to avoid blowing up the context window
          summary: taskResult.content.length > 2000
            ? taskResult.content.substring(0, 2000) + "\n\n[Output truncated for brevity]"
            : taskResult.content,
        });
      }

      results.push({
        issueId: taskResult.issueId,
        status: taskResult.status,
        summary: taskResult.summary,
      });
    }

    // Final step: update the job record
    await step.run("finalize-job", async () => {
      const completedCount = results.filter((r) => r.status === "completed").length;
      const failedCount = results.filter((r) => r.status === "failed").length;

      await db
        .update(backgroundJobs)
        .set({
          status: failedCount === results.length ? "failed" : "completed",
          completedAt: new Date(),
          result: JSON.stringify({
            total: results.length,
            completed: completedCount,
            failed: failedCount,
            results,
          }),
        })
        .where(eq(backgroundJobs.runId, runId));
    });

    return { total: results.length, results };
  }
);
