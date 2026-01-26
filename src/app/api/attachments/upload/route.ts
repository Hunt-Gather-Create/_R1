import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { issues, columns, workspaceMembers } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getCurrentUserId } from "@/lib/auth";
import { generateStorageKey, generateUploadUrl } from "@/lib/storage/r2-client";
import {
  validateFile,
  isAllowedMimeType,
  MAX_FILE_SIZE,
} from "@/lib/storage/file-validation";

const uploadRequestSchema = z.object({
  issueId: z.string().min(1),
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
    const parsed = uploadRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { issueId, filename, mimeType, size } = parsed.data;

    // Validate file
    const validationError = validateFile({
      type: mimeType,
      size,
      name: filename,
    });
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    // Validate MIME type
    if (!isAllowedMimeType(mimeType)) {
      return NextResponse.json(
        { error: "File type not allowed" },
        { status: 400 }
      );
    }

    // Check file size
    if (size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File size exceeds 10MB limit" },
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

    // Generate storage key and presigned upload URL
    const storageKey = generateStorageKey(
      column.workspaceId,
      issueId,
      filename
    );
    const uploadUrl = await generateUploadUrl(storageKey, mimeType);

    return NextResponse.json({
      uploadUrl,
      storageKey,
    });
  } catch (error) {
    console.error("Upload initiation error:", error);
    return NextResponse.json(
      { error: "Failed to initiate upload" },
      { status: 500 }
    );
  }
}
