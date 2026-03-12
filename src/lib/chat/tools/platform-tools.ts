import { tool } from "ai";
import { z } from "zod";
import type { ToolSet } from "ai";
import {
  getUserPlatformConnections,
  connectPlatform,
} from "@/lib/actions/platforms";
import { SOCIAL_PLATFORMS } from "@/lib/mcp/platforms";

const platformKeys = Object.keys(SOCIAL_PLATFORMS) as [string, ...string[]];

const connectPlatformSchema = z.object({
  platform: z
    .enum(platformKeys)
    .describe("The platform to connect"),
});

const emptySchema = z.object({});

/**
 * Create tools for managing social media platform connections.
 * Only used in marketing workspaces.
 */
export function createPlatformTools(workspaceId?: string): ToolSet {
  if (!workspaceId) return {};

  return {
    get_platform_connections: tool({
      description:
        "Get the current user's social media platform connection status. Use this to check which platforms are connected before attempting to use platform-specific tools or suggesting the user connect.",
      inputSchema: emptySchema,
      execute: async () => {
        const connections = await getUserPlatformConnections(workspaceId);
        return JSON.stringify({
          platforms: connections.map((c) => ({
            platform: c.platform,
            name: c.name,
            status: c.status,
            displayName: c.displayName,
          })),
        });
      },
    }),

    connect_platform: tool({
      description:
        "Initiate connecting a social media platform. Returns an authorization URL if OAuth is needed. The user's browser will open the authorization page. Available platforms: instagram, linkedin, twitter, facebook.",
      inputSchema: connectPlatformSchema,
      execute: async ({ platform }) => {
        const result = await connectPlatform(workspaceId, platform);

        if (!result.success) {
          return JSON.stringify({
            success: false,
            error: result.error,
          });
        }

        if (result.authorizationUrl) {
          return JSON.stringify({
            success: true,
            action: "authorize",
            authorizationUrl: result.authorizationUrl,
            platform,
            message: `Please authorize access to your ${SOCIAL_PLATFORMS[platform as keyof typeof SOCIAL_PLATFORMS]?.name} account in the popup window.`,
          });
        }

        return JSON.stringify({
          success: true,
          action: "connected",
          platform,
          message: `Successfully connected to ${SOCIAL_PLATFORMS[platform as keyof typeof SOCIAL_PLATFORMS]?.name}.`,
        });
      },
    }),
  };
}
