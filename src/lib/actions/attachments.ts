"use server";

import { revalidatePath } from "next/cache";
import { db } from "../db";
import { attachments, issues, activities } from "../db/schema";
import { eq, inArray } from "drizzle-orm";
import { getCurrentUserId } from "../auth";
import { requireWorkspaceAccess } from "./workspace";
import { getWorkspaceSlug, getWorkspaceIdFromIssue } from "./helpers";
import {
  generateDownloadUrl,
  deleteObject,
  generateStorageKey,
  uploadContent,
} from "../storage/r2-client";
import type { Attachment, AttachmentWithUrl } from "../types";

/**
 * Get workspace ID from an attachment
 */
async function getWorkspaceIdFromAttachment(
  attachmentId: string
): Promise<{ workspaceId: string; attachment: Attachment } | null> {
  const attachment = await db
    .select()
    .from(attachments)
    .where(eq(attachments.id, attachmentId))
    .get();

  if (!attachment) return null;

  const workspaceId = await getWorkspaceIdFromIssue(attachment.issueId);
  if (!workspaceId) return null;

  return { workspaceId, attachment };
}

/**
 * Get a single attachment record (no signed URL generation).
 * Useful when you only need metadata or will read content directly via storageKey.
 */
export async function getAttachment(
  attachmentId: string
): Promise<Attachment | null> {
  const result = await getWorkspaceIdFromAttachment(attachmentId);
  if (!result) return null;

  await requireWorkspaceAccess(result.workspaceId);
  return result.attachment;
}

/**
 * Get all attachment metadata for an issue (no signed URL generation).
 * Faster than getIssueAttachments when URLs are not needed.
 */
export async function getIssueAttachmentMetadata(
  issueId: string
): Promise<Attachment[]> {
  const workspaceId = await getWorkspaceIdFromIssue(issueId);
  if (workspaceId) {
    await requireWorkspaceAccess(workspaceId);
  }

  return db
    .select()
    .from(attachments)
    .where(eq(attachments.issueId, issueId))
    .orderBy(attachments.createdAt);
}

/**
 * Get attachment metadata for multiple issues in a single query (no signed URLs).
 * Auth check is performed once against the first issue's workspace.
 */
export async function getAttachmentsForIssues(
  issueIds: string[]
): Promise<Attachment[]> {
  if (issueIds.length === 0) return [];

  // Auth check against the first issue's workspace
  const workspaceId = await getWorkspaceIdFromIssue(issueIds[0]);
  if (workspaceId) {
    await requireWorkspaceAccess(workspaceId);
  }

  return db
    .select()
    .from(attachments)
    .where(inArray(attachments.issueId, issueIds))
    .orderBy(attachments.createdAt);
}

/**
 * Get all attachments for an issue with signed URLs
 */
export async function getIssueAttachments(
  issueId: string
): Promise<AttachmentWithUrl[]> {
  const workspaceId = await getWorkspaceIdFromIssue(issueId);
  if (workspaceId) {
    await requireWorkspaceAccess(workspaceId);
  }

  const issueAttachments = await db
    .select()
    .from(attachments)
    .where(eq(attachments.issueId, issueId))
    .orderBy(attachments.createdAt);

  // Generate signed URLs for each attachment (15 min expiry for thumbnails)
  const attachmentsWithUrls = await Promise.all(
    issueAttachments.map(async (attachment) => {
      const url = await generateDownloadUrl(attachment.storageKey, 900);
      return { ...attachment, url };
    })
  );

  return attachmentsWithUrls;
}

/**
 * Get a single attachment with signed URL (1 hour for downloads)
 */
export async function getAttachmentWithUrl(
  attachmentId: string
): Promise<AttachmentWithUrl | null> {
  const result = await getWorkspaceIdFromAttachment(attachmentId);
  if (!result) return null;

  const { workspaceId, attachment } = result;
  await requireWorkspaceAccess(workspaceId);

  const url = await generateDownloadUrl(attachment.storageKey, 3600);
  return { ...attachment, url };
}

/**
 * Attach AI-generated content to an issue
 */
export async function attachContentToIssue(
  issueId: string,
  content: string,
  filename: string,
  mimeType: string = "text/markdown"
): Promise<AttachmentWithUrl> {
  const workspaceId = await getWorkspaceIdFromIssue(issueId);
  if (!workspaceId) {
    throw new Error("Issue not found");
  }

  await requireWorkspaceAccess(workspaceId, "member");

  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error("Unauthorized");
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
      source: "ai-generated",
    }),
    createdAt: now,
  });

  // Update issue updatedAt
  await db
    .update(issues)
    .set({ updatedAt: now })
    .where(eq(issues.id, issueId));

  // Revalidate workspace path
  const slug = await getWorkspaceSlug(workspaceId);
  revalidatePath(slug ? `/w/${slug}` : "/");

  // Generate signed URL
  const url = await generateDownloadUrl(storageKey, 900);

  return {
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
}

/**
 * Delete an attachment
 */
export async function deleteAttachment(attachmentId: string): Promise<void> {
  const result = await getWorkspaceIdFromAttachment(attachmentId);
  if (!result) return;

  const { workspaceId, attachment } = result;
  await requireWorkspaceAccess(workspaceId, "member");

  const userId = await getCurrentUserId();

  // Delete from R2
  try {
    await deleteObject(attachment.storageKey);
  } catch (error) {
    console.error("Failed to delete from R2:", error);
    // Continue anyway - we want the database record removed
  }

  // Delete from database
  await db.delete(attachments).where(eq(attachments.id, attachmentId));

  // Log activity
  await db.insert(activities).values({
    id: crypto.randomUUID(),
    issueId: attachment.issueId,
    userId,
    type: "attachment_removed",
    data: JSON.stringify({
      attachmentId,
      attachmentFilename: attachment.filename,
    }),
    createdAt: new Date(),
  });

  // Update issue updatedAt
  await db
    .update(issues)
    .set({ updatedAt: new Date() })
    .where(eq(issues.id, attachment.issueId));

  // Revalidate workspace path
  const slug = await getWorkspaceSlug(workspaceId);
  revalidatePath(slug ? `/w/${slug}` : "/");
}
