"use server";

import { db } from "../db";
import { adArtifacts, attachments, workspaceChats } from "../db/schema";
import { eq, desc } from "drizzle-orm";
import { generateDownloadUrl, deleteObject, uploadContent, getObjectBinary } from "../storage/r2-client";
import { renderAdToHtml } from "../ad-html-templates";
import { revalidatePath } from "next/cache";
import { attachContentToIssue } from "./attachments";
import { requireWorkspaceAccess } from "./workspace";
import { getWorkspaceSlug } from "./helpers";
import type { AdArtifact } from "../types";
import type { MediaSlot } from "@/components/ads/types/ArtifactData";
import {
  parseMediaAssetsToSlots,
  allCurrentMediaReady,
  getPromptsFromContent,
  mergeClientMediaIntoSlots,
  isClientMediaShape,
  type ClientMediaPayload,
} from "./ad-artifacts-utils";

function isEmptyUrl(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value !== "string") return true;
  return value.trim() === "";
}

/**
 * When profile/company image URL is empty and we have a generated image in slot 0,
 * substitute it into content and return content media starting at index 1
 * (so content image indices stay 0-based for the frontend).
 * Skip for Facebook in-stream: slot 0 is the secondary ad image, not profile.
 */
function mergeProfileMediaIntoContent(
  content: Record<string, unknown>,
  resolvedMediaBySlot: ResolvedMediaBySlot
): { mergedContent: Record<string, unknown>; contentMediaBySlot: ResolvedMediaBySlot } {
  if (content.secondaryAd != null && typeof content.secondaryAd === "object") {
    return { mergedContent: content, contentMediaBySlot: resolvedMediaBySlot };
  }
  const profileUrl = resolvedMediaBySlot[0]?.currentImageUrl ?? null;
  if (!profileUrl) return { mergedContent: content, contentMediaBySlot: resolvedMediaBySlot };

  const profile = content.profile && typeof content.profile === "object" ? (content.profile as Record<string, unknown>) : null;
  const company = content.company && typeof content.company === "object" ? (content.company as Record<string, unknown>) : null;
  const needsFill =
    (profile && (isEmptyUrl(profile.image) || isEmptyUrl(profile.profileImageUrl) || isEmptyUrl(profile.imageUrl))) ||
    (company && isEmptyUrl(company.logo)) ||
    isEmptyUrl(content.profileImageUrl);
  if (!needsFill) return { mergedContent: content, contentMediaBySlot: resolvedMediaBySlot };

  const merged = JSON.parse(JSON.stringify(content)) as Record<string, unknown>;
  if (merged.profile && typeof merged.profile === "object") {
    const p = merged.profile as Record<string, unknown>;
    if (isEmptyUrl(p.image)) p.image = profileUrl;
    if (isEmptyUrl(p.profileImageUrl)) p.profileImageUrl = profileUrl;
    if (isEmptyUrl(p.imageUrl)) p.imageUrl = profileUrl;
  }
  if (merged.company && typeof merged.company === "object") {
    const c = merged.company as Record<string, unknown>;
    if (isEmptyUrl(c.logo)) c.logo = profileUrl;
  }
  if (isEmptyUrl(merged.profileImageUrl)) merged.profileImageUrl = profileUrl;

  return {
    mergedContent: merged,
    contentMediaBySlot: resolvedMediaBySlot,
  };
}

/**
 * Create a new ad artifact
 */
export async function createAdArtifact(input: {
  workspaceId: string;
  chatId?: string;
  messageId?: string;
  platform: string;
  templateType: string;
  name: string;
  content: string;
  mediaAssets?: string;
  brandId?: string;
  issueId?: string;
}): Promise<AdArtifact> {
  await requireWorkspaceAccess(input.workspaceId, "member");
  try {
    const [artifact] = await db
      .insert(adArtifacts)
      .values({
        workspaceId: input.workspaceId,
        chatId: input.chatId ?? null,
        messageId: input.messageId ?? null,
        platform: input.platform,
        templateType: input.templateType,
        name: input.name,
        content: input.content,
        mediaAssets: input.mediaAssets ?? null,
        brandId: input.brandId ?? null,
        issueId: input.issueId ?? null,
      })
      .returning();

    return artifact;
  } catch (error) {
    console.error("Failed to create ad artifact:", error);
    throw error;
  }
}

/** Shape compatible with ArtifactMediaUrls for initial media in ArtifactProvider */
export type ResolvedMediaBySlot = Array<{
  imageUrls: string[];
  videoUrls: string[];
  currentIndex: number;
  currentImageUrl: string | null;
  generatedAt: Date;
  showVideo: boolean;
  /** Prompt for the current version (for client-side generation when url is missing) */
  currentPrompt?: string;
}>;

/**
 * Resolve current version of each slot to a base64 data URL for HTML embedding.
 * Only uses storageKey (fetches from R2) or existing imageUrl if it is already a data URL.
 * Returns one string per slot in order (for renderAdToHtml mediaUrls).
 */
export async function resolveMediaToBase64DataUrls(mediaAssets: string | null): Promise<string[]> {
  const slots = parseMediaAssetsToSlots(mediaAssets);
  const dataUrls: string[] = [];
  for (const slot of slots) {
    const v = slot.versions[slot.currentIndex];
    if (!v) {
      dataUrls.push("");
      continue;
    }
    if (v.imageUrl?.startsWith("data:")) {
      dataUrls.push(v.imageUrl);
      continue;
    }
    if (v.storageKey) {
      const obj = await getObjectBinary(v.storageKey);
      if (obj) {
        const base64 = Buffer.from(obj.body).toString("base64");
        const mime = obj.contentType.startsWith("image/") ? obj.contentType : "image/png";
        dataUrls.push(`data:${mime};base64,${base64}`);
        continue;
      }
    }
    dataUrls.push("");
  }
  return dataUrls;
}

/**
 * Resolve a single slot's versions to URLs (signed for display). Returns imageUrls in version order
 * and the current version's url + prompt.
 */
async function resolveSlotToUrls(slot: MediaSlot): Promise<{
  imageUrls: string[];
  currentImageUrl: string | null;
  currentPrompt: string | undefined;
}> {
  const imageUrls: string[] = [];
  for (const v of slot.versions) {
    if (v.storageKey) {
      const url = await generateDownloadUrl(v.storageKey);
      imageUrls.push(url);
    } else if (v.imageUrl) {
      imageUrls.push(v.imageUrl);
    } else {
      imageUrls.push("");
    }
  }
  const idx = Math.max(0, Math.min(slot.currentIndex, slot.versions.length - 1));
  const currentImageUrl = imageUrls[idx] || null;
  const currentPrompt = slot.versions[idx]?.prompt;
  return { imageUrls, currentImageUrl, currentPrompt };
}

/**
 * Get a single ad artifact with fresh signed URLs for media.
 * resolvedMediaBySlot can be passed as initialMediaUrls to ArtifactProvider so generated images show on reload.
 * Each slot includes currentPrompt for the current version so the client can generate when url is missing.
 */
export async function getAdArtifact(
  artifactId: string
): Promise<
  (AdArtifact & { resolvedMediaUrls: string[]; resolvedMediaBySlot: ResolvedMediaBySlot }) | null
> {
  const artifact = await db
    .select()
    .from(adArtifacts)
    .where(eq(adArtifacts.id, artifactId))
    .get();

  if (!artifact) return null;

  await requireWorkspaceAccess(artifact.workspaceId);

  const resolvedMediaUrls: string[] = [];
  const resolvedMediaBySlot: ResolvedMediaBySlot = [];

  const slots = parseMediaAssetsToSlots(artifact.mediaAssets);
  for (const slot of slots) {
    const { imageUrls, currentImageUrl, currentPrompt } = await resolveSlotToUrls(slot);
    resolvedMediaUrls.push(...imageUrls.filter(Boolean));
    resolvedMediaBySlot.push({
      imageUrls,
      videoUrls: [],
      currentIndex: slot.currentIndex,
      currentImageUrl,
      generatedAt: new Date(),
      showVideo: false,
      currentPrompt,
    });
  }

  let contentForResponse: string = artifact.content;
  try {
    const parsed = typeof artifact.content === "string" ? JSON.parse(artifact.content) : artifact.content;
    if (parsed && typeof parsed === "object") {
      const { mergedContent } = mergeProfileMediaIntoContent(
        parsed as Record<string, unknown>,
        resolvedMediaBySlot
      );
      contentForResponse = JSON.stringify(mergedContent);
    }
  } catch {
    // Keep original content
  }

  return {
    ...artifact,
    content: contentForResponse,
    resolvedMediaUrls,
    resolvedMediaBySlot,
  };
}

/**
 * Get all ad artifacts for a workspace
 */
export async function getWorkspaceAdArtifacts(
  workspaceId: string
): Promise<AdArtifact[]> {
  await requireWorkspaceAccess(workspaceId);
  return db
    .select()
    .from(adArtifacts)
    .where(eq(adArtifacts.workspaceId, workspaceId))
    .orderBy(desc(adArtifacts.createdAt))
    .all();
}

/**
 * Get ad artifacts for a specific chat
 */
export async function getChatAdArtifacts(chatId: string): Promise<AdArtifact[]> {
  const chat = await db
    .select({ workspaceId: workspaceChats.workspaceId })
    .from(workspaceChats)
    .where(eq(workspaceChats.id, chatId))
    .get();
  if (!chat) return [];
  await requireWorkspaceAccess(chat.workspaceId);
  return db
    .select()
    .from(adArtifacts)
    .where(eq(adArtifacts.chatId, chatId))
    .orderBy(desc(adArtifacts.createdAt))
    .all();
}

/**
 * Update an existing artifact with new image version(s). Each media asset (slot) has its own
 * currentIndex; we only append a new version and bump currentIndex for slots whose prompt
 * changed, so each asset's version advances independently.
 */
export async function updateAdArtifactWithNewImageVersion(
  artifactId: string,
  content: string
): Promise<AdArtifact | null> {
  const existing = await db
    .select()
    .from(adArtifacts)
    .where(eq(adArtifacts.id, artifactId))
    .get();
  if (!existing) return null;
  await requireWorkspaceAccess(existing.workspaceId, "member");

  let parsedContent: Record<string, unknown>;
  try {
    parsedContent = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }

  const prompts = getPromptsFromContent(existing.platform, existing.templateType, parsedContent);
  if (prompts.length === 0) return null;

  const slots = parseMediaAssetsToSlots(existing.mediaAssets);

  // Ensure we have at least as many slots as prompts (e.g. profile + content)
  while (slots.length < prompts.length) {
    slots.push({ currentIndex: 0, versions: [] });
  }

  for (let i = 0; i < prompts.length; i++) {
    const slot = slots[i]!;
    const newPrompt = (prompts[i] ?? "").trim();
    const currentVersion = slot.versions[slot.currentIndex];
    const currentPrompt = (currentVersion?.prompt ?? "").trim();
    // Only append a new version for this media asset when its prompt changed
    if (newPrompt !== currentPrompt) {
      slot.versions.push({ prompt: newPrompt || undefined });
      slot.currentIndex = slot.versions.length - 1;
    }
  }

  const mediaAssetsJson = JSON.stringify(slots);
  const [updated] = await db
    .update(adArtifacts)
    .set({ mediaAssets: mediaAssetsJson, updatedAt: new Date() })
    .where(eq(adArtifacts.id, artifactId))
    .returning();

  return updated ?? null;
}

/**
 * Update ad artifact content (copy/text fields)
 */
export async function updateAdArtifactContent(
  artifactId: string,
  content: string
): Promise<AdArtifact | null> {
  const existing = await db
    .select({ workspaceId: adArtifacts.workspaceId })
    .from(adArtifacts)
    .where(eq(adArtifacts.id, artifactId))
    .get();
  if (!existing) return null;
  await requireWorkspaceAccess(existing.workspaceId, "member");
  const [updated] = await db
    .update(adArtifacts)
    .set({ content, updatedAt: new Date() })
    .where(eq(adArtifacts.id, artifactId))
    .returning();

  if (updated) {
    // Fire-and-forget: re-render HTML attachment only when all media are ready
    refreshAdAttachmentIfMediaReady(artifactId).catch(() => {});
  }

  return updated ?? null;
}

/**
 * Update ad artifact media assets.
 * When the payload is client-save shape (imageUrls per slot), merges with existing
 * media so storageKeys from generate-image are preserved and the profile URL stays saved.
 */
export async function updateAdArtifactMedia(
  artifactId: string,
  mediaAssets: string
): Promise<AdArtifact | null> {
  const row = await db
    .select({
      workspaceId: adArtifacts.workspaceId,
      mediaAssets: adArtifacts.mediaAssets,
    })
    .from(adArtifacts)
    .where(eq(adArtifacts.id, artifactId))
    .get();
  if (!row) return null;
  await requireWorkspaceAccess(row.workspaceId, "member");

  let payload = mediaAssets;
  if (isClientMediaShape(mediaAssets)) {
    const existingSlots = parseMediaAssetsToSlots(row.mediaAssets);
    let clientMedia: ClientMediaPayload;
    try {
      clientMedia = JSON.parse(mediaAssets) as ClientMediaPayload;
    } catch {
      clientMedia = [];
    }
    const merged = mergeClientMediaIntoSlots(existingSlots, clientMedia);
    payload = JSON.stringify(merged);
  }

  const [updated] = await db
    .update(adArtifacts)
    .set({
      mediaAssets: payload,
      updatedAt: new Date(),
    })
    .where(eq(adArtifacts.id, artifactId))
    .returning();

  return updated ?? null;
}

/**
 * Attach an ad artifact's HTML preview to an issue (on-demand).
 * Only creates the attachment when all media for the current index are ready (no placeholders).
 * HTML uses base64 data URLs for images so the document is self-contained and does not expire.
 */
export async function attachAdArtifactToIssue(
  artifactId: string,
  issueId: string
): Promise<{ success: true; attachmentId: string } | { success: false; error: string }> {
  try {
    const artifact = await db
      .select()
      .from(adArtifacts)
      .where(eq(adArtifacts.id, artifactId))
      .get();

    if (!artifact) {
      return { success: false, error: "Artifact not found" };
    }

    await requireWorkspaceAccess(artifact.workspaceId, "member");

    const slots = parseMediaAssetsToSlots(artifact.mediaAssets);
    if (!allCurrentMediaReady(slots)) {
      return {
        success: false,
        error: "Not all media generated yet. Generate all images first, then attach.",
      };
    }

    const dataUrls = await resolveMediaToBase64DataUrls(artifact.mediaAssets);
    const resolvedMediaBySlotForHtml: ResolvedMediaBySlot = dataUrls.map((url) => ({
      imageUrls: url ? [url] : [],
      videoUrls: [],
      currentIndex: 0,
      currentImageUrl: url || null,
      generatedAt: new Date(),
      showVideo: false,
    }));

    let parsedContent: unknown;
    try {
      parsedContent = JSON.parse(artifact.content);
    } catch {
      parsedContent = artifact.content;
    }

    const { mergedContent: contentForHtml, contentMediaBySlot } = mergeProfileMediaIntoContent(
      parsedContent as Record<string, unknown>,
      resolvedMediaBySlotForHtml
    );
    // Slot 0 = profile (already in contentForHtml); HTML templates expect mediaUrls[0] = first content image
    const contentOnlySlots = contentMediaBySlot.slice(1);
    const contentMediaUrls = contentOnlySlots.map((s) => s.currentImageUrl).filter(Boolean) as string[];

    const html = renderAdToHtml(artifact.platform, artifact.templateType, contentForHtml, contentMediaUrls);
    if (!html) {
      return { success: false, error: "Failed to render ad HTML" };
    }

    const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9-_ ]/g, "").trim();
    const filename = `${sanitize(artifact.name)} - ${sanitize(artifact.platform)} ${sanitize(artifact.templateType)}.html`;
    const attachment = await attachContentToIssue(issueId, html, filename, "text/html");

    // Store the attachmentId on the artifact for later refresh
    await db
      .update(adArtifacts)
      .set({ issueAttachmentId: attachment.id, updatedAt: new Date() })
      .where(eq(adArtifacts.id, artifactId));

    return { success: true, attachmentId: attachment.id };
  } catch (error) {
    console.error("Failed to attach ad artifact to issue:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Re-render and overwrite the HTML attachment for an ad artifact using base64 data URLs.
 * Only updates when the artifact has an existing attachment (e.g. after attach).
 */
export async function refreshAdAttachment(artifactId: string): Promise<void> {
  const artifact = await db
    .select()
    .from(adArtifacts)
    .where(eq(adArtifacts.id, artifactId))
    .get();

  if (!artifact?.issueAttachmentId) return;

  await requireWorkspaceAccess(artifact.workspaceId, "member");

  const attachment = await db
    .select()
    .from(attachments)
    .where(eq(attachments.id, artifact.issueAttachmentId))
    .get();

  if (!attachment) return;

  const slots = parseMediaAssetsToSlots(artifact.mediaAssets);
  if (!allCurrentMediaReady(slots)) return;

  const dataUrls = await resolveMediaToBase64DataUrls(artifact.mediaAssets);
  const resolvedMediaBySlotForHtml: ResolvedMediaBySlot = dataUrls.map((url) => ({
    imageUrls: url ? [url] : [],
    videoUrls: [],
    currentIndex: 0,
    currentImageUrl: url || null,
    generatedAt: new Date(),
    showVideo: false,
  }));

  let parsedContent: unknown;
  try {
    parsedContent = JSON.parse(artifact.content);
  } catch {
    parsedContent = artifact.content;
  }
  const { mergedContent: contentForHtml, contentMediaBySlot } = mergeProfileMediaIntoContent(
    parsedContent as Record<string, unknown>,
    resolvedMediaBySlotForHtml
  );
  const contentOnlySlots = contentMediaBySlot.slice(1);
  const contentMediaUrls = contentOnlySlots.map((s) => s.currentImageUrl).filter(Boolean) as string[];

  const html = renderAdToHtml(artifact.platform, artifact.templateType, contentForHtml, contentMediaUrls);
  if (!html) return;

  await uploadContent(attachment.storageKey, html, "text/html");

  const size = Buffer.byteLength(html, "utf-8");
  await db
    .update(attachments)
    .set({ size })
    .where(eq(attachments.id, attachment.id));

  const slug = await getWorkspaceSlug(artifact.workspaceId);
  revalidatePath(slug ? `/w/${slug}` : "/");
}

/**
 * Re-render and overwrite the HTML attachment only when all media for the current index are ready.
 * Called after generate-image so the attachment is updated only when every slot has media (no placeholders).
 * Also auto-creates the attachment when issueId is set but no attachment exists yet.
 */
export async function refreshAdAttachmentIfMediaReady(artifactId: string): Promise<void> {
  const artifact = await db
    .select()
    .from(adArtifacts)
    .where(eq(adArtifacts.id, artifactId))
    .get();

  if (!artifact) return;

  const slots = parseMediaAssetsToSlots(artifact.mediaAssets);
  if (!allCurrentMediaReady(slots)) return;

  if (artifact.issueAttachmentId) {
    await refreshAdAttachment(artifactId);
  } else if (artifact.issueId) {
    // Guard: ad needs images (has prompts) but none initiated yet — wait for images
    let parsedContent: Record<string, unknown>;
    try {
      parsedContent = JSON.parse(artifact.content) as Record<string, unknown>;
    } catch {
      parsedContent = {};
    }
    const prompts = getPromptsFromContent(artifact.platform, artifact.templateType, parsedContent);
    const needsImages = prompts.some((p) => p?.trim());
    if (needsImages && slots.length === 0) return;

    await attachAdArtifactToIssue(artifactId, artifact.issueId);
  }
}

/**
 * Delete an ad artifact and clean up R2 media
 */
export async function deleteAdArtifact(artifactId: string): Promise<void> {
  const artifact = await db
    .select()
    .from(adArtifacts)
    .where(eq(adArtifacts.id, artifactId))
    .get();

  if (!artifact) return;

  await requireWorkspaceAccess(artifact.workspaceId, "admin");

  // Clean up R2 media assets (versioned or legacy)
  const slots = parseMediaAssetsToSlots(artifact.mediaAssets);
  for (const slot of slots) {
    for (const v of slot.versions) {
      if (v.storageKey) {
        await deleteObject(v.storageKey).catch(() => {});
      }
    }
  }

  await db.delete(adArtifacts).where(eq(adArtifacts.id, artifactId));
}
