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
