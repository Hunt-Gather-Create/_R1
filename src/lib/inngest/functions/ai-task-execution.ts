import { inngest } from "../client";
import { db } from "@/lib/db";
import { issues, workspaces, attachments, activities, columns } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { recordTokenUsage } from "@/lib/token-usage";
import { generateStorageKey, uploadContent, generateDownloadUrl } from "@/lib/storage/r2-client";
import type { WorkspaceSoul, AttachmentWithUrl } from "@/lib/types";

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
 * Build system prompt with parent issue context
 */
function buildSystemPrompt(
  parentIssue: { identifier: string; title: string; description: string | null } | null,
  subtaskTitle: string,
  subtaskDescription: string | null,
  aiInstructions: string | null,
  soul?: WorkspaceSoul | null
): string {
  const parts: string[] = [];

  // Add workspace soul/persona if configured
  if (soul) {
    parts.push(`You are ${soul.name}. ${soul.personality}

Tone: ${soul.tone}
Response Length: ${soul.responseLength}`);
  }

  parts.push(`You are completing a subtask as part of a larger project. Use the tools available to research if needed.

## Parent Issue Context
${parentIssue ? `**${parentIssue.identifier}: ${parentIssue.title}**
${parentIssue.description || "No description provided."}` : "No parent context available."}

## Your Subtask
**Title:** ${subtaskTitle}
${subtaskDescription ? `**Description:** ${subtaskDescription}` : ""}
${aiInstructions ? `**Special Instructions:** ${aiInstructions}` : ""}

## Tools Available
- **web_search**: Search the web for current information
- **web_fetch**: Fetch and read content from specific URLs

## Output Format
Provide your complete response as well-formatted markdown. Be thorough but concise. Focus on actionable, specific content relevant to the parent issue context.`);

  return parts.join("\n\n");
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
      const issueId = event.data.event.data.issueId;
      console.error(`[AI Task] Function failed for ${issueId}:`, error);

      try {
        await db
          .update(issues)
          .set({
            aiExecutionStatus: "failed",
            aiExecutionSummary: `Execution failed: ${error.message}`,
            updatedAt: new Date(),
          })
          .where(eq(issues.id, issueId));
      } catch (dbError) {
        console.error(`[AI Task] Failed to update issue status:`, dbError);
      }
    },
  },
  { event: "ai/task.execute" },
  async ({ event, step }) => {
    const { issueId, workspaceId, parentIssueId } = event.data;

    // Step 1: Load context and mark as running
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

      // Mark subtask as running
      await db
        .update(issues)
        .set({ aiExecutionStatus: "running", updatedAt: new Date() })
        .where(eq(issues.id, issueId));

      const soul = workspace?.soul ? (JSON.parse(workspace.soul) as WorkspaceSoul) : null;

      return { subtask, parentIssue: parentIssue ?? null, soul };
    });

    // Step 2: Execute AI with web tools
    const executionResult = await step.run("execute-ai", async () => {
      const { subtask, parentIssue, soul } = context;

      const systemPrompt = buildSystemPrompt(
        parentIssue,
        subtask.title,
        subtask.description,
        subtask.aiInstructions,
        soul
      );

      const result = await generateText({
        model: anthropic(EXECUTION_MODEL),
        system: systemPrompt,
        prompt: "Complete the subtask described above. Use web_search and web_fetch if you need current information. Provide your response as markdown.",
        tools: {
          web_search: anthropic.tools.webSearch_20250305({ maxUses: MAX_TOOL_USES }),
          web_fetch: anthropic.tools.webFetch_20250910({ maxUses: MAX_TOOL_USES }),
        },
        maxRetries: 0,
      });

      return {
        content: result.text,
        usage: {
          inputTokens: result.usage.inputTokens ?? 0,
          outputTokens: result.usage.outputTokens ?? 0,
        },
      };
    });

    // Step 3: Track token usage
    await step.run("track-usage", async () => {
      await recordTokenUsage({
        workspaceId,
        model: EXECUTION_MODEL,
        inputTokens: executionResult.usage.inputTokens,
        outputTokens: executionResult.usage.outputTokens,
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

    // Step 5: Finalize - update subtask with results
    const finalResult = await step.run("finalize", async () => {
      const hasContent = !!executionResult.content;
      const status = hasContent ? "completed" : "failed";

      // Create a brief summary from the content
      const summary = hasContent
        ? `Task completed. Output saved as ${attachmentResult.attached ? "attachment" : "text"}.`
        : "Task failed - no content generated.";

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

      return { status, summary, attached: attachmentResult.attached };
    });

    return finalResult;
  }
);
