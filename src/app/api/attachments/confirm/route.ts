import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  attachments,
  issues,
  columns,
  workspaceMembers,
  activities,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getCurrentUserId } from "@/lib/auth";
import { generateDownloadUrl } from "@/lib/storage/r2-client";
import { isAllowedMimeType } from "@/lib/storage/file-validation";
import type { AttachmentWithUrl } from "@/lib/types";

const confirmRequestSchema = z.object({
  issueId: z.string().min(1),
  storageKey: z.string().min(1),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().positive(),
});

export async function POST(req: Request) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = confirmRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { issueId, storageKey, filename, mimeType, size } = parsed.data;

    // Validate MIME type
    if (!isAllowedMimeType(mimeType)) {
      return NextResponse.json(
        { error: "File type not allowed" },
        { status: 400 }
      );
    }

    // Get issue and verify it exists
    const issue = await db
      .select()
      .from(issues)
      .where(eq(issues.id, issueId))
      .get();

    if (!issue) {
      return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    }

    // Get workspace ID from column
    const column = await db
      .select({ workspaceId: columns.workspaceId })
      .from(columns)
      .where(eq(columns.id, issue.columnId))
      .get();

    if (!column) {
      return NextResponse.json(
        { error: "Issue column not found" },
        { status: 404 }
      );
    }

    // Verify user has access to this workspace
    const member = await db
      .select()
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, column.workspaceId),
          eq(workspaceMembers.userId, userId)
        )
      )
      .get();

    if (!member) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Create attachment record
    const attachmentId = crypto.randomUUID();
    const now = new Date();

    await db.insert(attachments).values({
      id: attachmentId,
      issueId,
      userId,
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
      userId,
      type: "attachment_added",
      data: JSON.stringify({
        attachmentId,
        attachmentFilename: filename,
      }),
      createdAt: now,
    });

    // Update issue updatedAt
    await db
      .update(issues)
      .set({ updatedAt: now })
      .where(eq(issues.id, issueId));

    // Generate signed URL for the new attachment
    const url = await generateDownloadUrl(storageKey, 900); // 15 minutes

    const attachment: AttachmentWithUrl = {
      id: attachmentId,
      issueId,
      userId,
      filename,
      storageKey,
      mimeType,
      size,
      createdAt: now,
      url,
    };

    return NextResponse.json({ attachment });
  } catch (error) {
    console.error("Upload confirmation error:", error);
    return NextResponse.json(
      { error: "Failed to confirm upload" },
      { status: 500 }
    );
  }
}
