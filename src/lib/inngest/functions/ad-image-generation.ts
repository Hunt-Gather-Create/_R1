import { inngest } from "../client";
import { db } from "@/lib/db";
import { adArtifacts, adArtifactVersions, attachments, workspaceChatAttachments } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { generateImage, editImage } from "@/lib/services/image-generation";
import {
  parseMediaAssetsToSlots,
  allCurrentMediaReady,
  getEffectivePromptsFromContent,
  getAspectRatiosFromContent,
} from "@/lib/actions/ad-artifacts-utils";
import { resolveMediaToBase64DataUrls } from "@/lib/actions/ad-artifacts";
import { renderAdToHtml } from "@/lib/ad-html-templates";
import { generateStorageKey, uploadContent } from "@/lib/storage/r2-client";
import type { MediaSlot } from "@/components/ads/types/ArtifactData";

function isEmptyUrl(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value !== "string") return true;
  return value.trim() === "";
}

function mergeProfileMediaIntoContent(
  content: Record<string, unknown>,
  mediaBySlot: Array<{ currentImageUrl: string | null }>
): { mergedContent: Record<string, unknown>; contentMediaBySlot: typeof mediaBySlot } {
  if (content.secondaryAd != null && typeof content.secondaryAd === "object") {
    return { mergedContent: content, contentMediaBySlot: mediaBySlot };
  }
  const profileUrl = mediaBySlot[0]?.currentImageUrl ?? null;
  if (!profileUrl) return { mergedContent: content, contentMediaBySlot: mediaBySlot };

  const profile =
    content.profile && typeof content.profile === "object"
      ? (content.profile as Record<string, unknown>)
      : null;
  const company =
    content.company && typeof content.company === "object"
      ? (content.company as Record<string, unknown>)
      : null;
  const needsFill =
    (profile &&
      (isEmptyUrl(profile.image) ||
        isEmptyUrl(profile.profileImageUrl) ||
        isEmptyUrl(profile.imageUrl))) ||
    (company && isEmptyUrl(company.logo)) ||
    isEmptyUrl(content.profileImageUrl);
  if (!needsFill) return { mergedContent: content, contentMediaBySlot: mediaBySlot };

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

  return { mergedContent: merged, contentMediaBySlot: mediaBySlot };
}

/**
 * Inngest background function: generate images for an ad artifact using Gemini (Nano Banana)
 * and create/refresh the issue HTML attachment once all images are ready.
 */
export const generateAdImages = inngest.createFunction(
  { id: "generate-ad-images", name: "Generate Ad Images" },
  { event: "ad/images.generate" },
  async ({ event, step }) => {
    const { artifactId } = event.data;

    // Step 1: Set up media slots with prompts, create pending version row
    await step.run("setup-media-slots", async () => {
      const artifact = await db
        .select()
        .from(adArtifacts)
        .where(eq(adArtifacts.id, artifactId))
        .get();
      if (!artifact) throw new Error(`Artifact ${artifactId} not found`);

      let parsedContent: Record<string, unknown>;
      try {
        parsedContent = JSON.parse(artifact.content) as Record<string, unknown>;
      } catch {
        return;
      }

      const prompts = getEffectivePromptsFromContent(
        artifact.platform,
        artifact.templateType,
        parsedContent
      );
      if (!prompts.some((p) => p?.trim())) return; // no images needed — step 3 handles no-image case

      // Read slots from last completed version
      const currentVersion = artifact.currentVersion ?? 0;
      const lastVersionRow = currentVersion > 0
        ? await db
            .select({ mediaAssets: adArtifactVersions.mediaAssets })
            .from(adArtifactVersions)
            .where(and(
              eq(adArtifactVersions.artifactId, artifactId),
              eq(adArtifactVersions.version, currentVersion)
            ))
            .get()
        : null;

      const slots = parseMediaAssetsToSlots(lastVersionRow?.mediaAssets ?? null);
      while (slots.length < prompts.length) {
        slots.push({ currentIndex: 0, versions: [] } as MediaSlot);
      }

      for (let i = 0; i < prompts.length; i++) {
        const slot = slots[i]!;
        const prompt = (prompts[i] ?? "").trim();
        const currentSlotVersion = slot.versions[slot.currentIndex];
        const currentPrompt = (currentSlotVersion?.prompt ?? "").trim();
        // Only append a new version when the prompt changed or slot is empty
        if (prompt && prompt !== currentPrompt) {
          slot.versions.push({ prompt });
          slot.currentIndex = slot.versions.length - 1;
        }
      }

      // Insert or update pending version row at currentVersion + 1
      const newVersion = currentVersion + 1;
      const existingPending = await db
        .select({ id: adArtifactVersions.id })
        .from(adArtifactVersions)
        .where(and(
          eq(adArtifactVersions.artifactId, artifactId),
          eq(adArtifactVersions.version, newVersion)
        ))
        .get();

      if (existingPending) {
        await db
          .update(adArtifactVersions)
          .set({ mediaAssets: JSON.stringify(slots), content: artifact.content })
          .where(eq(adArtifactVersions.id, existingPending.id));
      } else {
        await db.insert(adArtifactVersions).values({
          artifactId,
          version: newVersion,
          content: artifact.content,
          mediaAssets: JSON.stringify(slots),
        });
      }
    });

    // Step 2: Generate all images in parallel, update pending version row
    await step.run("generate-images", async () => {
      const artifact = await db
        .select()
        .from(adArtifacts)
        .where(eq(adArtifacts.id, artifactId))
        .get();
      if (!artifact) throw new Error(`Artifact ${artifactId} not found`);

      const currentVersion = artifact.currentVersion ?? 0;
      const pendingVersionRow = await db
        .select()
        .from(adArtifactVersions)
        .where(and(
          eq(adArtifactVersions.artifactId, artifactId),
          eq(adArtifactVersions.version, currentVersion + 1)
        ))
        .get();

      if (!pendingVersionRow) return; // step 1 returned early (no images needed)

      let parsedContent: Record<string, unknown>;
      try {
        parsedContent = JSON.parse(artifact.content) as Record<string, unknown>;
      } catch {
        return;
      }

      const aspectRatios = getAspectRatiosFromContent(
        artifact.platform,
        artifact.templateType,
        parsedContent
      );
      const slots = parseMediaAssetsToSlots(pendingVersionRow.mediaAssets);

      const generateTasks = slots.map((slot, i) => async () => {
        const ver = slot.versions[slot.currentIndex];
        if (!ver || ver.storageKey || !ver.prompt?.trim()) return null;

        // Check if a previous version has an existing image we can edit
        const prevVer = slot.currentIndex > 0
          ? slot.versions[slot.currentIndex - 1]
          : null;

        if (prevVer?.storageKey) {
          // Previous image exists — localized edit instead of full regeneration
          return await editImage({
            sourceStorageKey: prevVer.storageKey,
            editPrompt: ver.prompt,
            aspectRatio: aspectRatios[i] ?? "1:1",
            workspaceId: artifact.workspaceId,
            artifactId,
            mediaIndex: i,
          });
        }

        // No previous image — generate from scratch
        return await generateImage({
          prompt: ver.prompt,
          aspectRatio: aspectRatios[i] ?? "1:1",
          workspaceId: artifact.workspaceId,
          artifactId,
          mediaIndex: i,
        });
      });

      const results = await Promise.allSettled(generateTasks.map((fn) => fn()));

      // Save successful results first (idempotent on retry — storageKey already set = skipped)
      for (let i = 0; i < results.length; i++) {
        const result = results[i]!;
        if (result.status === "fulfilled" && result.value) {
          const ver = slots[i]!.versions[slots[i]!.currentIndex];
          if (!ver) continue;
          ver.storageKey = result.value.storageKey;
          ver.imageUrl = result.value.downloadUrl;
        } else if (result.status === "rejected") {
          console.error(`[generate-ad-images] Failed to generate image for slot ${i}:`, result.reason);
        }
      }

      // Persist partial progress so retries skip already-completed slots
      await db
        .update(adArtifactVersions)
        .set({ mediaAssets: JSON.stringify(slots) })
        .where(and(
          eq(adArtifactVersions.artifactId, artifactId),
          eq(adArtifactVersions.version, currentVersion + 1)
        ));

      // Throw so Inngest retries step 2 for the failed slots
      const failedCount = results.filter((r) => r.status === "rejected").length;
      if (failedCount > 0) {
        throw new Error(`${failedCount} image(s) failed to generate — retrying`);
      }
    });

    // Step 3: Finalize — verify readiness, increment currentVersion, create attachment
    await step.run("create-attachment", async () => {
      const artifact = await db
        .select()
        .from(adArtifacts)
        .where(eq(adArtifacts.id, artifactId))
        .get();
      if (!artifact) return;

      const currentVersion = artifact.currentVersion ?? 0;
      const newVersion = currentVersion + 1;

      // Look for pending version
      let versionRow = await db
        .select()
        .from(adArtifactVersions)
        .where(and(
          eq(adArtifactVersions.artifactId, artifactId),
          eq(adArtifactVersions.version, newVersion)
        ))
        .get();

      if (!versionRow) {
        // No-image ad (step 1 returned early): insert version row now
        const [inserted] = await db
          .insert(adArtifactVersions)
          .values({
            artifactId,
            version: newVersion,
            content: artifact.content,
            mediaAssets: null,
          })
          .returning();
        versionRow = inserted;
      }

      if (!versionRow) return;

      const slots = parseMediaAssetsToSlots(versionRow.mediaAssets ?? null);
      if (!allCurrentMediaReady(slots)) return;

      // Increment currentVersion on the artifact
      await db
        .update(adArtifacts)
        .set({ currentVersion: newVersion, updatedAt: new Date() })
        .where(eq(adArtifacts.id, artifactId));

      // Workspace chat: save JSON snapshot to workspaceChatAttachments
      if (artifact.chatId && !artifact.issueId) {
        const exportPayload = {
          id: artifact.id,
          name: artifact.name,
          platform: artifact.platform,
          templateType: artifact.templateType,
          content: versionRow.content,
          mediaAssets: versionRow.mediaAssets,
          brandId: artifact.brandId,
          createdAt: artifact.createdAt,
          updatedAt: new Date(),
        };
        const jsonContent = JSON.stringify(exportPayload, null, 2);
        const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9-_ ]/g, "").trim();
        const filename = `${sanitize(artifact.name)} - ${sanitize(artifact.platform)} v${newVersion}.json`;
        await db.insert(workspaceChatAttachments).values({
          id: crypto.randomUUID(),
          chatId: artifact.chatId,
          messageId: artifact.messageId ?? null,
          filename,
          content: jsonContent,
          mimeType: "application/json",
          size: Buffer.byteLength(jsonContent, "utf-8"),
          createdAt: new Date(),
        });
        return;
      }

      // Only create HTML attachment for issue-linked artifacts
      if (!artifact.issueId) return;

      const dataUrls = await resolveMediaToBase64DataUrls(versionRow.mediaAssets ?? null);
      const resolvedMediaBySlot = dataUrls.map((url) => ({
        currentImageUrl: url || null,
      }));

      let parsedContent: unknown;
      try {
        parsedContent = JSON.parse(versionRow.content);
      } catch {
        parsedContent = versionRow.content;
      }

      const { mergedContent, contentMediaBySlot } = mergeProfileMediaIntoContent(
        parsedContent as Record<string, unknown>,
        resolvedMediaBySlot
      );
      const contentOnlySlots = contentMediaBySlot.slice(1);
      const contentMediaUrls = contentOnlySlots
        .map((s) => s.currentImageUrl)
        .filter(Boolean) as string[];

      const html = renderAdToHtml(
        artifact.platform,
        artifact.templateType,
        mergedContent,
        contentMediaUrls
      );
      if (!html) return;

      // Create a new versioned attachment
      const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9-_ ]/g, "").trim();
      const filename = `${sanitize(artifact.name)} - ${sanitize(artifact.platform)} ${sanitize(artifact.templateType)} v${newVersion}.html`;
      const size = Buffer.byteLength(html, "utf-8");
      const now = new Date();

      const storageKey = generateStorageKey(artifact.workspaceId, artifact.issueId, filename);
      await uploadContent(storageKey, html, "text/html");
      const attachmentId = crypto.randomUUID();

      await db.insert(attachments).values({
        id: attachmentId,
        issueId: artifact.issueId,
        filename,
        storageKey,
        mimeType: "text/html",
        size,
        createdAt: now,
      });

      await db
        .update(adArtifacts)
        .set({ issueAttachmentId: attachmentId, updatedAt: new Date() })
        .where(eq(adArtifacts.id, artifactId));

      await db
        .update(adArtifactVersions)
        .set({ issueAttachmentId: attachmentId })
        .where(and(
          eq(adArtifactVersions.artifactId, artifactId),
          eq(adArtifactVersions.version, newVersion)
        ));
    });
  }
);
