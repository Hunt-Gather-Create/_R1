/** Slot 0 is reserved for profile/company image when generated on render. */
export const PROFILE_MEDIA_SLOT_INDEX = 0;

export interface ProfileMediaSlot {
  currentImageUrl: string | null;
}

function isEmptyUrl(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value !== "string") return true;
  return value.trim() === "";
}

/**
 * Resolve profile/company image in content for display.
 * When the profile/company image URL is empty and we have a generated image in slot 0,
 * substitute it so the UI shows the generated image.
 */
export function resolveProfileMediaInContent<T>(content: T, mediaSlots: ProfileMediaSlot[]): T {
  if (content === null || typeof content !== "object") return content;
  const raw = content as Record<string, unknown>;
  const profileUrl = mediaSlots[PROFILE_MEDIA_SLOT_INDEX]?.currentImageUrl ?? "";
  if (!profileUrl) return content;

  const profile = raw.profile && typeof raw.profile === "object" ? (raw.profile as Record<string, unknown>) : null;
  const company = raw.company && typeof raw.company === "object" ? (raw.company as Record<string, unknown>) : null;
  const needsFill =
    (profile && (isEmptyUrl(profile.image) || isEmptyUrl(profile.profileImageUrl) || isEmptyUrl(profile.imageUrl))) ||
    (company && isEmptyUrl(company.logo)) ||
    isEmptyUrl(raw.profileImageUrl);
  if (!needsFill) return content;

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
  return merged as T;
}
