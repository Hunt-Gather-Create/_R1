import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  webhooks,
  workspaces,
  columns,
  issues,
  labels,
  issueLabels,
  activities,
} from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { authenticateApiKey, checkRateLimit } from "@/lib/api-auth";
import { processWebhookData } from "@/lib/webhooks/process";
import type { Status } from "@/lib/design-tokens";

export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceSlug: string; webhookSlug: string }> }
) {
  const { workspaceSlug, webhookSlug } = await params;

  // 1. Authenticate API key
  const authResult = await authenticateApiKey(request);
  if (authResult instanceof NextResponse) return authResult;

  const { workspaceId, apiKeyId } = authResult;

  // 2. Rate limit
  const rateLimitResponse = checkRateLimit(apiKeyId);
  if (rateLimitResponse) return rateLimitResponse;

  // 3. Look up workspace by slug
  const workspace = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, workspaceSlug))
    .get();

  if (!workspace) {
    return NextResponse.json(
      { error: "Workspace not found" },
      { status: 404 }
    );
  }

  // 4. Verify API key belongs to this workspace
  if (workspace.id !== workspaceId) {
    return NextResponse.json(
      { error: "API key does not have access to this workspace" },
      { status: 403 }
    );
  }

  // 5. Look up webhook
  const webhook = await db
    .select()
    .from(webhooks)
    .where(
      and(
        eq(webhooks.workspaceId, workspace.id),
        eq(webhooks.slug, webhookSlug)
      )
    )
    .get();

  if (!webhook || !webhook.isActive) {
    return NextResponse.json(
      { error: "Webhook not found or disabled" },
      { status: 404 }
    );
  }

  // 6. Parse request body
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  // Accept { data: ... } wrapper or treat entire body as data
  const data = body.data ?? body;
  // Always use the webhook's stored prompt — never accept prompt overrides from the request
  const prompt = webhook.prompt;

  // 7. Process data with AI
  let processed;
  try {
    processed = await processWebhookData({
      prompt,
      data,
      workspaceId: workspace.id,
    });
  } catch (err) {
    console.error("Webhook AI processing failed:", err);
    return NextResponse.json(
      { error: "Failed to process webhook data" },
      { status: 500 }
    );
  }

  // 8. Apply webhook defaults (explicit overrides take precedence over AI output)
  if (webhook.defaultStatus) {
    processed.status = webhook.defaultStatus;
  }
  if (webhook.defaultPriority !== null && webhook.defaultPriority !== undefined) {
    processed.priority = webhook.defaultPriority;
  }

  // 9. Find the target column based on status
  const targetStatus = (processed.status || "todo") as Status;

  let targetColumn = await db
    .select()
    .from(columns)
    .where(
      and(
        eq(columns.workspaceId, workspace.id),
        eq(columns.status, targetStatus)
      )
    )
    .get();

  // Fallback to first column
  if (!targetColumn) {
    targetColumn = await db
      .select()
      .from(columns)
      .where(eq(columns.workspaceId, workspace.id))
      .orderBy(columns.position)
      .get();
  }

  if (!targetColumn) {
    return NextResponse.json(
      { error: "Workspace has no columns" },
      { status: 500 }
    );
  }

  // 10. Generate issue identifier (atomic increment to avoid race conditions)
  await db
    .update(workspaces)
    .set({ issueCounter: sql`issue_counter + 1` })
    .where(eq(workspaces.id, workspace.id));

  const updated = await db
    .select({ issueCounter: workspaces.issueCounter })
    .from(workspaces)
    .where(eq(workspaces.id, workspace.id))
    .get();

  const identifier = `${workspace.identifier}-${updated!.issueCounter}`;

  // 11. Get max position in target column
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

  // 12. Create the issue
  const now = new Date();
  const issueId = crypto.randomUUID();

  await db.insert(issues).values({
    id: issueId,
    columnId: targetColumn.id,
    identifier,
    title: processed.title,
    description: processed.description ?? null,
    status: targetStatus,
    priority: processed.priority ?? 4,
    position: (maxPosition?.maxPos ?? -1) + 1,
    createdAt: now,
    updatedAt: now,
  });

  // 13. Resolve and apply labels
  if (processed.labels && processed.labels.length > 0) {
    const workspaceLabels = await db
      .select()
      .from(labels)
      .where(eq(labels.workspaceId, workspace.id));

    const labelNameMap = new Map(
      workspaceLabels.map((l) => [l.name.toLowerCase(), l.id])
    );

    const matchedLabelIds = processed.labels
      .map((name) => labelNameMap.get(name.toLowerCase()))
      .filter((id): id is string => !!id);

    // Also include webhook default labels
    if (webhook.defaultLabelIds) {
      try {
        const defaultIds = JSON.parse(webhook.defaultLabelIds) as string[];
        for (const id of defaultIds) {
          if (!matchedLabelIds.includes(id)) {
            matchedLabelIds.push(id);
          }
        }
      } catch {
        // Ignore malformed JSON
      }
    }

    if (matchedLabelIds.length > 0) {
      await db.insert(issueLabels).values(
        matchedLabelIds.map((labelId) => ({
          issueId,
          labelId,
        }))
      );
    }
  } else if (webhook.defaultLabelIds) {
    // No AI labels but webhook has defaults
    try {
      const defaultIds = JSON.parse(webhook.defaultLabelIds) as string[];
      if (defaultIds.length > 0) {
        await db.insert(issueLabels).values(
          defaultIds.map((labelId) => ({
            issueId,
            labelId,
          }))
        );
      }
    } catch {
      // Ignore malformed JSON
    }
  }

  // 14. Log activity
  await db.insert(activities).values({
    id: crypto.randomUUID(),
    issueId,
    userId: null,
    type: "issue_created",
    data: JSON.stringify({ source: "webhook", webhookId: webhook.id }),
    createdAt: now,
  });

  // 15. Revalidate so the board reflects the new issue
  revalidatePath(`/w/${workspaceSlug}`);

  // 16. Return success
  return NextResponse.json({
    success: true,
    issue: {
      id: issueId,
      identifier,
      title: processed.title,
      status: targetStatus,
      priority: processed.priority ?? 4,
    },
  });
}
