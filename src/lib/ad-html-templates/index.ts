/**
 * HTML Template Registry
 *
 * Generates self-contained HTML documents for ad previews.
 * Each renderer produces a complete <!DOCTYPE html> string
 * with inline styles matching the React template's visual design.
 */

import { renderInstagramFeedPost } from "./instagram-feed-post";
import { renderInstagramCarousel } from "./instagram-carousel";
import { renderInstagramStory } from "./instagram-story";
import { renderInstagramReel } from "./instagram-reel";
import { renderGoogleSearchAd } from "./google-search-ad";
import { renderTiktokStory } from "./tiktok-story";
import { renderTiktokCta } from "./tiktok-cta";
import { renderLinkedInSingleImage } from "./linkedin-single-image";
import { renderLinkedInCarousel } from "./linkedin-carousel";
import { renderFacebookInStreamVideo } from "./facebook-in-stream-video";

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Renders profile/company image HTML from content (workspace brand when present).
 * Uses profileImageUrl when available, otherwise a placeholder div with optional background color.
 */
export function profileImageHtml(
  profileImageUrl: string | null | undefined,
  imageBackgroundColor: string | null | undefined,
  sizePx: number,
  alt: string,
  round = true
): string {
  const safeColor =
    imageBackgroundColor &&
    typeof imageBackgroundColor === "string" &&
    imageBackgroundColor.length <= 64 &&
    !/[;"'<>]/.test(imageBackgroundColor);
  const bgStyle = safeColor
    ? `background:${escapeHtml(imageBackgroundColor)};`
    : "background:#e0e0e0;";
  const size = `${sizePx}px`;
  const shape = round ? "50%" : "4px";
  if (profileImageUrl && profileImageUrl.trim()) {
    return `<img src="${escapeHtml(profileImageUrl.trim())}" alt="${escapeHtml(alt)}" width="${size}" height="${size}" style="width:${size};height:${size};border-radius:${shape};object-fit:cover;flex-shrink:0;" />`;
  }
  return `<div style="width:${size};height:${size};border-radius:${shape};${bgStyle}flex-shrink:0;"></div>`;
}

export function htmlWrapper(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; display: flex; justify-content: center; padding: 24px; }
  img { max-width: 100%; display: block; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

type Renderer = (content: unknown, mediaUrls?: string[]) => string;

const RENDERERS: Record<string, Renderer> = {
  "instagram-feed-post": renderInstagramFeedPost,
  "instagram-carousel": renderInstagramCarousel,
  "instagram-story": renderInstagramStory,
  "instagram-reel": renderInstagramReel,
  "google-search-ad": renderGoogleSearchAd,
  "tiktok-story": renderTiktokStory,
  "tiktok-cta": renderTiktokCta,
  "linkedin-single-image": renderLinkedInSingleImage,
  "linkedin-carousel": renderLinkedInCarousel,
  "facebook-in-stream-video": renderFacebookInStreamVideo,
};

/**
 * Render an ad to a self-contained HTML document string.
 *
 * @param platform - e.g. "instagram"
 * @param templateType - e.g. "feed-post"
 * @param contentJson - The raw content JSON (parsed or string)
 * @param mediaUrls - Resolved media URLs (R2 signed URLs)
 */
export function renderAdToHtml(
  platform: string,
  templateType: string,
  contentJson: unknown,
  mediaUrls?: string[]
): string | null {
  const key = `${platform}-${templateType}`;
  const renderer = RENDERERS[key];
  if (!renderer) return null;

  const content =
    typeof contentJson === "string" ? JSON.parse(contentJson) : contentJson;

  return renderer(content, mediaUrls);
}
