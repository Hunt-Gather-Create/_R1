/**
 * Template Registry
 *
 * Maps ad template type strings to their schema, platform,
 * and component paths for lazy loading.
 */

import type { ComponentType } from "react";

export interface TemplateRegistryEntry {
  platform: "instagram" | "tiktok" | "linkedin" | "google" | "facebook";
  templateType: string;
  label: string;
  needsImageGeneration: boolean;
  /** Lazy-loaded artifact component */
  component: () => Promise<{ default: ComponentType }>;
}

export const TEMPLATE_REGISTRY: Record<string, TemplateRegistryEntry> = {
  "ad-template:instagram-feed-post": {
    platform: "instagram",
    templateType: "feed-post",
    label: "Instagram Feed Post",
    needsImageGeneration: true,
    component: () =>
      import("../templates/instagram/InstagramFeedPostArtifact").then((m) => ({
        default: m.InstagramFeedPostArtifact,
      })),
  },
  "ad-template:instagram-carousel": {
    platform: "instagram",
    templateType: "carousel",
    label: "Instagram Carousel",
    needsImageGeneration: true,
    component: () =>
      import("../templates/instagram/InstagramCarouselArtifact").then((m) => ({
        default: m.InstagramCarouselArtifact,
      })),
  },
  "ad-template:instagram-story": {
    platform: "instagram",
    templateType: "story",
    label: "Instagram Story",
    needsImageGeneration: true,
    component: () =>
      import("../templates/instagram/InstagramStoryArtifact").then((m) => ({
        default: m.InstagramStoryArtifact,
      })),
  },
  "ad-template:instagram-reel": {
    platform: "instagram",
    templateType: "reel",
    label: "Instagram Reel",
    needsImageGeneration: true,
    component: () =>
      import("../templates/instagram/InstagramReelArtifact").then((m) => ({
        default: m.InstagramReelArtifact,
      })),
  },
  "ad-template:tiktok-story": {
    platform: "tiktok",
    templateType: "story",
    label: "TikTok Story",
    needsImageGeneration: true,
    component: () =>
      import("../templates/tiktok/TiktokStoryArtifact").then((m) => ({
        default: m.TiktokStoryArtifact,
      })),
  },
  "ad-template:tiktok-cta": {
    platform: "tiktok",
    templateType: "cta",
    label: "TikTok CTA",
    needsImageGeneration: true,
    component: () =>
      import("../templates/tiktok/TiktokCTAArtifact").then((m) => ({
        default: m.TiktokCTAArtifact,
      })),
  },
  "ad-template:linkedin-single-image": {
    platform: "linkedin",
    templateType: "single-image",
    label: "LinkedIn Single Image",
    needsImageGeneration: true,
    component: () =>
      import("../templates/linkedin/LinkedInSingleImageArtifact").then((m) => ({
        default: m.LinkedInSingleImageArtifact,
      })),
  },
  "ad-template:linkedin-carousel": {
    platform: "linkedin",
    templateType: "carousel",
    label: "LinkedIn Carousel",
    needsImageGeneration: true,
    component: () =>
      import("../templates/linkedin/LinkedInCarouselArtifact").then((m) => ({
        default: m.LinkedInCarouselArtifact,
      })),
  },
  "ad-template:google-search-ad": {
    platform: "google",
    templateType: "search-ad",
    label: "Google Search Ad",
    needsImageGeneration: false,
    component: () =>
      import("../templates/google/GoogleSearchArtifact").then((m) => ({
        default: m.GoogleSearchArtifact,
      })),
  },
  "ad-template:facebook-in-stream-video": {
    platform: "facebook",
    templateType: "in-stream-video",
    label: "Facebook In-Stream Video",
    needsImageGeneration: true,
    component: () =>
      import("../templates/facebook/FacebookInStreamVideoArtifact").then((m) => ({
        default: m.FacebookInStreamVideoArtifact,
      })),
  },
};

/**
 * Get the registry entry for a given ad template type.
 */
export function getTemplateEntry(
  type: string
): TemplateRegistryEntry | undefined {
  return TEMPLATE_REGISTRY[type];
}

/**
 * Get all available template types.
 */
export function getTemplateTypes(): string[] {
  return Object.keys(TEMPLATE_REGISTRY);
}
