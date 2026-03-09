/**
 * Merges workspace brand into ad artifact content on the backend when creating/saving.
 * The frontend then uses content.profile / content.company directly with no resolution.
 */

export interface WorkspaceBrandSnapshot {
  name: string;
  resolvedLogoUrl: string | null;
  websiteUrl: string | null;
  primaryColor: string | null;
}

export function mergeWorkspaceBrandIntoContent(
  content: Record<string, unknown>,
  brand: WorkspaceBrandSnapshot,
  platform: string,
  templateType: string
): Record<string, unknown> {
  const out = { ...content };

  const logo = brand.resolvedLogoUrl ?? "";
  const name = brand.name;
  const url = brand.websiteUrl ?? "#";
  const primaryColor = brand.primaryColor ?? null;

  switch (platform) {
    case "google": {
      const existing = typeof content.company === "object" && content.company !== null ? (content.company as Record<string, unknown>) : {};
      out.company = {
        ...existing,
        name,
        logo: logo || (existing.logo as string) || "",
        url: url !== "#" ? url : (existing.url as string) || "#",
        imageBackgroundColor: primaryColor,
      };
      break;
    }

    case "instagram": {
      const existingProfile = typeof content.profile === "object" && content.profile !== null ? (content.profile as Record<string, unknown>) : {};
      out.profile = {
        ...existingProfile,
        username: name || (existingProfile.username as string) || "Your Brand",
        image: logo || (existingProfile.image as string) || "",
        imageBackgroundColor: primaryColor,
      };
      break;
    }

    case "linkedin": {
      const existingProfile = typeof content.profile === "object" && content.profile !== null ? (content.profile as Record<string, unknown>) : {};
      out.companyName = name || (content.companyName as string);
      out.profile = {
        ...existingProfile,
        profileImageUrl: logo || (existingProfile.profileImageUrl as string) || "",
        imageBackgroundColor: primaryColor,
      };
      break;
    }

    case "tiktok": {
      const existingProfile = typeof content.profile === "object" && content.profile !== null ? (content.profile as Record<string, unknown>) : {};
      out.profile = {
        ...existingProfile,
        username: name || (existingProfile.username as string) || "Your Brand",
        image: logo || (existingProfile.image as string) || "",
        imageBackgroundColor: primaryColor,
      };
      break;
    }

    case "facebook": {
      const existingProfile = typeof content.profile === "object" && content.profile !== null ? (content.profile as Record<string, unknown>) : {};
      out.company = name || (content.company as string);
      out.companyAbbreviation = (name || (content.company as string) || "").slice(0, 2).toUpperCase();
      out.profile = {
        ...existingProfile,
        imageUrl: logo || (existingProfile.imageUrl as string) || "",
        imageBackgroundColor: primaryColor,
      };
      break;
    }

    default:
      break;
  }

  return out;
}

const AD_PLATFORMS = ["instagram", "google", "linkedin", "tiktok", "facebook"] as const;

/**
 * Returns the profile/company structure for a given platform so the agent can
 * fill ad artifact content. Use when building ad content from get_workspace_brand.
 */
export function getBrandSnapshotForPlatform(
  brand: WorkspaceBrandSnapshot,
  platform: string
): Record<string, unknown> {
  const logo = brand.resolvedLogoUrl ?? "";
  const name = brand.name;
  const url = brand.websiteUrl ?? "#";
  const primaryColor = brand.primaryColor ?? null;

  switch (platform) {
    case "google":
      return {
        company: {
          name,
          logo,
          url: url !== "#" ? url : "",
          imageBackgroundColor: primaryColor,
        },
      };
    case "instagram":
    case "tiktok":
      return {
        profile: {
          username: name || "Your Brand",
          image: logo,
          imageBackgroundColor: primaryColor,
        },
      };
    case "linkedin":
      return {
        companyName: name,
        profile: {
          profileImageUrl: logo,
          imageBackgroundColor: primaryColor,
        },
      };
    case "facebook":
      return {
        company: name,
        companyAbbreviation: (name || "").slice(0, 2).toUpperCase(),
        profile: {
          imageUrl: logo,
          imageBackgroundColor: primaryColor,
        },
      };
    default:
      return {};
  }
}

/**
 * Returns brand snapshot plus per-platform profile/company shapes for ad content.
 * Used by get_workspace_brand tool so the agent can copy forPlatform[platform] into content.
 */
export function getBrandForAdContent(brand: WorkspaceBrandSnapshot): {
  name: string;
  resolvedLogoUrl: string | null;
  websiteUrl: string | null;
  primaryColor: string | null;
  forPlatform: Record<string, Record<string, unknown>>;
} {
  const forPlatform: Record<string, Record<string, unknown>> = {};
  for (const platform of AD_PLATFORMS) {
    forPlatform[platform] = getBrandSnapshotForPlatform(brand, platform);
  }
  return {
    name: brand.name,
    resolvedLogoUrl: brand.resolvedLogoUrl,
    websiteUrl: brand.websiteUrl,
    primaryColor: brand.primaryColor,
    forPlatform,
  };
}
