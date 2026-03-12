/**
 * Social media platform definitions for Smithery Connect.
 * Each platform maps to a Smithery-hosted MCP server that handles
 * OAuth and API access.
 */

export const SOCIAL_PLATFORMS = {
  instagram: {
    key: "instagram" as const,
    name: "Instagram",
    description: "Photos, stories, and engagement",
    smitheryServer: "instagram",
    icon: "Instagram",
  },
  linkedin: {
    key: "linkedin" as const,
    name: "LinkedIn",
    description: "Posts, articles, and company pages",
    smitheryServer: "linkedin",
    icon: "Linkedin",
  },
  twitter: {
    key: "twitter" as const,
    name: "X (Twitter)",
    description: "Tweets, threads, and mentions",
    smitheryServer: "twitter",
    icon: "Twitter",
  },
  facebook: {
    key: "facebook" as const,
    name: "Facebook",
    description: "Page posts, comments, and albums",
    smitheryServer: "facebook",
    icon: "Facebook",
  },
} as const;

export type PlatformKey = keyof typeof SOCIAL_PLATFORMS;
export type PlatformDefinition = (typeof SOCIAL_PLATFORMS)[PlatformKey];

/**
 * Get the Smithery MCP server URL for a platform.
 */
export function getPlatformMcpUrl(platform: PlatformKey): string {
  const def = SOCIAL_PLATFORMS[platform];
  return `https://server.smithery.ai/${def.smitheryServer}/mcp`;
}

/**
 * Check if a string is a valid platform key.
 */
export function isValidPlatform(value: string): value is PlatformKey {
  return value in SOCIAL_PLATFORMS;
}

/**
 * Get all available platform definitions.
 */
export function getAllPlatforms(): PlatformDefinition[] {
  return Object.values(SOCIAL_PLATFORMS);
}
