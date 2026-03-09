/**
 * Pure helpers for ad artifact media (parsing, prompts, readiness).
 * Kept in a separate file so they are not treated as Server Actions ("use server" modules require async exports).
 */
import type { MediaSlot } from "@/components/ads/types/ArtifactData";

/** Legacy shape stored in DB before versioned media */
type LegacyMediaAsset = { storageKey?: string; imageUrls?: string[] };

/** Client save shape (ArtifactMediaUrls) */
type ClientMediaSlot = { imageUrls?: string[]; currentIndex?: number };

/**
 * Parse mediaAssets JSON into MediaSlot[]. Supports:
 * - New versioned format: array of { currentIndex, versions: [{ prompt?, storageKey?, imageUrl? }] }
 * - Client save shape: array of { imageUrls: string[], currentIndex }
 * - Legacy format: array of { storageKey?, imageUrls? } (one version per slot)
 */
export function parseMediaAssetsToSlots(mediaAssets: string | null): MediaSlot[] {
  if (!mediaAssets?.trim()) return [];
  try {
    const parsed = JSON.parse(mediaAssets) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.map((item) => {
      // New versioned format
      if (
        item &&
        typeof item === "object" &&
        "versions" in item &&
        Array.isArray((item as MediaSlot).versions)
      ) {
        const slot = item as MediaSlot;
        return {
          currentIndex: Math.max(0, Math.min(slot.currentIndex ?? 0, Math.max(0, slot.versions.length - 1))),
          versions: slot.versions,
        };
      }
      // Legacy format: single version per slot (storageKey and/or imageUrls; no "versions")
      if (item && typeof item === "object" && "storageKey" in item) {
        const legacy = item as LegacyMediaAsset;
        const imageUrl = legacy.imageUrls?.[0];
        return {
          currentIndex: 0,
          versions: [
            {
              ...(legacy.storageKey && { storageKey: legacy.storageKey }),
              ...(imageUrl && { imageUrl }),
            },
          ],
        };
      }
      // Client save shape: imageUrls array + currentIndex (from ArtifactMediaUrls)
      if (item && typeof item === "object" && "imageUrls" in item && Array.isArray((item as ClientMediaSlot).imageUrls)) {
        const client = item as ClientMediaSlot;
        const imageUrls = client.imageUrls ?? [];
        const currentIndex = Math.max(0, Math.min(client.currentIndex ?? 0, Math.max(0, imageUrls.length - 1)));
        return {
          currentIndex,
          versions: imageUrls.map((imageUrl) => (imageUrl ? { imageUrl } : {})),
        };
      }
      // Legacy without storageKey (imageUrls only)
      const legacy = item as LegacyMediaAsset;
      const imageUrl = legacy.imageUrls?.[0];
      return {
        currentIndex: 0,
        versions: [
          {
            ...(legacy.storageKey && { storageKey: legacy.storageKey }),
            ...(imageUrl && { imageUrl }),
          },
        ],
      };
    });
  } catch {
    return [];
  }
}

/**
 * Extract image prompts from template content by platform/templateType.
 * Returns prompts in slot order: [profilePrompt, ...contentPrompts].
 * Used when appending a new image version from chat (updateAdArtifactWithNewImageVersion).
 */
export function getPromptsFromContent(
  platform: string,
  templateType: string,
  content: Record<string, unknown>
): string[] {
  const prompts: string[] = [];
  const isFacebookInStream = platform === "facebook" && templateType === "in-stream-video";
  const profile = content.profile && typeof content.profile === "object" ? (content.profile as Record<string, unknown>) : null;
  const company = content.company && typeof content.company === "object" ? (content.company as Record<string, unknown>) : null;

  // Slot 0: profile or company image prompt (skip for Facebook in-stream; that template uses slot 0 = secondary ad image)
  if (!isFacebookInStream) {
    const profilePrompt = (profile?.imagePrompt as string)?.trim() || (company?.imagePrompt as string)?.trim() || "";
    prompts.push(profilePrompt || "");
  }

  // Content slots (platform-specific)
  if (platform === "instagram") {
    if (templateType === "feed-post" || templateType === "story" || templateType === "reel") {
      const c = content.content as { prompt?: string } | undefined;
      prompts.push((c?.prompt as string)?.trim() || "");
    } else if (templateType === "carousel") {
      const slides = content.content as Array<{ prompt?: string }> | undefined;
      if (Array.isArray(slides)) {
        for (const s of slides) prompts.push((s?.prompt as string)?.trim() || "");
      }
    }
  } else if (platform === "tiktok") {
    const c = content.content as { prompt?: string } | undefined;
    prompts.push((c?.prompt as string)?.trim() || "");
  } else if (platform === "linkedin") {
    if (templateType === "single-image") {
      prompts.push((content.imagePrompt as string)?.trim() || "");
    } else if (templateType === "carousel") {
      const slides = content.slides as Array<{ imagePrompt?: string }> | undefined;
      if (Array.isArray(slides)) {
        for (const s of slides) prompts.push((s?.imagePrompt as string)?.trim() || "");
      }
    }
  } else if (platform === "facebook" && templateType === "in-stream-video") {
    // Slot 0 = secondary ad image, slot 1 = primary ad image (no profile slot in this template)
    const secondary = content.secondaryAd && typeof content.secondaryAd === "object"
      ? (content.secondaryAd as { image?: string }).image
      : undefined;
    const primary = (content as { image?: string }).image;
    prompts.push((secondary as string)?.trim() || "");
    prompts.push((primary as string)?.trim() || "");
  }
  return prompts;
}

/** Check if every slot has media for its current version (storageKey or imageUrl). */
export function allCurrentMediaReady(slots: MediaSlot[]): boolean {
  for (const slot of slots) {
    if (slot.versions.length === 0) continue; // slot unused (e.g. profile URL provided by brand)
    const v = slot.versions[slot.currentIndex];
    if (!v) return false;
    const hasMedia = !!(v.storageKey || (v.imageUrl && v.imageUrl.trim()));
    if (!hasMedia) return false;
  }
  return true;
}

/** Client payload: one entry per slot, with imageUrls and currentIndex (ArtifactMediaUrls-like). */
export type ClientMediaPayload = Array<{ imageUrls?: string[]; currentIndex?: number }>;

/**
 * Merge client-saved media (imageUrls per slot) into existing versioned slots.
 * Preserves storageKey and prompt for every existing version so profile/content URLs stay persisted.
 */
export function mergeClientMediaIntoSlots(
  existingSlots: MediaSlot[],
  clientMedia: ClientMediaPayload
): MediaSlot[] {
  const merged: MediaSlot[] = [];
  const maxSlot = Math.max(existingSlots.length, clientMedia.length, 1);
  for (let i = 0; i < maxSlot; i++) {
    const existing = existingSlots[i];
    const client = clientMedia[i];
    const clientUrls = client?.imageUrls ?? [];
    const clientCurrentIndex = Math.max(
      0,
      Math.min(client?.currentIndex ?? 0, Math.max(0, clientUrls.length - 1))
    );
    const existingVersions = existing?.versions ?? [];
    const versions = [];
    const maxVersions = Math.max(existingVersions.length, clientUrls.length);
    for (let j = 0; j < maxVersions; j++) {
      const existingVer = existingVersions[j] ?? {};
      const clientUrl = clientUrls[j];
      versions.push({
        ...existingVer,
        ...(clientUrl != null && clientUrl !== "" && { imageUrl: clientUrl }),
      });
    }
    merged.push({
      currentIndex: clientCurrentIndex,
      versions: versions.length ? versions : [{ ...(existingVersions[0] ?? {}) }],
    });
  }
  return merged;
}

/** Default prompt used when profile has no image URL and no explicit imagePrompt. */
const DEFAULT_PROFILE_PROMPT =
  "Professional minimalist company logo icon, simple and modern, suitable for social media profile picture, neutral background";

/**
 * Like getPromptsFromContent but fills the profile slot with a default prompt when:
 * - Not Facebook in-stream
 * - Profile/company section exists with no image URL
 * - No explicit imagePrompt was provided
 * Mirrors the client-side fallback in ProfileImageOrGenerate.tsx.
 */
export function getEffectivePromptsFromContent(
  platform: string,
  templateType: string,
  content: Record<string, unknown>
): string[] {
  const prompts = getPromptsFromContent(platform, templateType, content);
  const isFacebookInStream = platform === "facebook" && templateType === "in-stream-video";

  if (!isFacebookInStream && prompts.length > 0 && !prompts[0]?.trim()) {
    const profile =
      content.profile && typeof content.profile === "object"
        ? (content.profile as Record<string, unknown>)
        : null;
    const company =
      content.company && typeof content.company === "object"
        ? (content.company as Record<string, unknown>)
        : null;

    if (profile || company) {
      const hasUrl = !!(
        (profile?.image && typeof profile.image === "string" && profile.image.trim()) ||
        (profile?.profileImageUrl &&
          typeof profile.profileImageUrl === "string" &&
          profile.profileImageUrl.trim()) ||
        (profile?.imageUrl &&
          typeof profile.imageUrl === "string" &&
          profile.imageUrl.trim()) ||
        (company?.logo && typeof company.logo === "string" && company.logo.trim())
      );
      if (!hasUrl) {
        prompts[0] = DEFAULT_PROFILE_PROMPT;
      }
    }
  }

  return prompts;
}

/**
 * Get aspect ratios for each media slot, parallel to getPromptsFromContent.
 * Returns ratios in slot order: [profileRatio, ...contentRatios].
 */
export function getAspectRatiosFromContent(
  platform: string,
  templateType: string,
  content: Record<string, unknown>
): string[] {
  const ratios: string[] = [];
  const isFacebookInStream = platform === "facebook" && templateType === "in-stream-video";

  if (!isFacebookInStream) {
    ratios.push("1:1"); // slot 0: profile
  }

  if (platform === "instagram") {
    if (templateType === "feed-post") {
      ratios.push((content.aspectRatio as string) || "1:1");
    } else if (templateType === "story" || templateType === "reel") {
      ratios.push("9:16");
    } else if (templateType === "carousel") {
      const slides = content.content as Array<unknown> | undefined;
      const count = Array.isArray(slides) ? slides.length : 1;
      for (let i = 0; i < count; i++) ratios.push("1:1");
    }
  } else if (platform === "tiktok") {
    ratios.push("9:16");
  } else if (platform === "linkedin") {
    if (templateType === "single-image") {
      ratios.push((content.imageAspectRatio as string) || "1:1");
    } else if (templateType === "carousel") {
      const slides = content.slides as Array<unknown> | undefined;
      const count = Array.isArray(slides) ? slides.length : 1;
      for (let i = 0; i < count; i++) ratios.push("1:1");
    }
  } else if (platform === "facebook" && templateType === "in-stream-video") {
    ratios.push("1:1"); // slot 0: secondary ad image
    ratios.push("1:1"); // slot 1: primary ad image
  }

  return ratios;
}

/**
 * Detect if mediaAssets JSON is client-save shape (imageUrls per slot) rather than versioned (versions array).
 */
export function isClientMediaShape(mediaAssets: string | null): boolean {
  if (!mediaAssets?.trim()) return false;
  try {
    const parsed = JSON.parse(mediaAssets) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return false;
    const first = parsed[0];
    return (
      first != null &&
      typeof first === "object" &&
      "imageUrls" in first &&
      !("versions" in first)
    );
  } catch {
    return false;
  }
}
