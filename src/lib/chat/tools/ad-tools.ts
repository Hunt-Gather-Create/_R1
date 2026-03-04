import { tool, jsonSchema } from "ai";
import { z } from "zod";
import {
  createAdArtifact,
  refreshAdAttachmentIfMediaReady,
  updateAdArtifactContent,
  updateAdArtifactWithNewImageVersion,
} from "@/lib/actions/ad-artifacts";
import { getPromptsFromContent } from "@/lib/actions/ad-artifacts-utils";
import { getWorkspaceBrand } from "@/lib/actions/brand";
import { getBrandForAdContent } from "@/lib/ads/merge-workspace-brand";

// Import schemas from each platform's template files
import { InstagramFeedPostSchema } from "@/components/ads/templates/instagram/InstagramFeedPost";
import { InstagramCarouselSchema } from "@/components/ads/templates/instagram/tools";
import { InstagramStorySchema } from "@/components/ads/templates/instagram/InstagramStory";
import { InstagramReelSchema } from "@/components/ads/templates/instagram/tools";
import { TiktokAdStorySchema } from "@/components/ads/templates/tiktok/TiktokAdStory";
import { TiktokAdCTAToolSchema } from "@/components/ads/templates/tiktok/TiktokAdCTA";
import { LinkedInSingleImageAdSchema } from "@/components/ads/templates/linkedin/LinkedInSingleImageAd";
import { LinkedInCarouselAdSchema } from "@/components/ads/templates/linkedin/tools";
import { GoogleSearchAdSchema } from "@/components/ads/templates/google/GoogleSearchAd";
import { FacebookInStreamVideoTool } from "@/components/ads/templates/facebook/tools";

/** Max ad tool invocations per request. Each API request creates a fresh counter (createAdTools is called per request in chat routes). */
const MAX_AD_TOOL_USES = 5;

interface AdToolsContext {
  workspaceId: string;
  /** Only set when chat is a workspace chat (workspace_chats.id). Omit for issue chat to avoid FK violation. */
  chatId?: string;
  brandId?: string;
  /** When set, ads are automatically attached to this issue on creation. */
  issueId?: string;
}

/** Shared usage counter for the current request only. Reset when the user sends a new message. */
interface AdToolUsage {
  count: number;
}

/**
 * Maps a template type string (e.g., "ad-template:instagram-feed-post")
 * to { platform, templateType } for the database.
 */
function parseTemplateType(type: string): { platform: string; templateType: string } {
  const parts = type.replace("ad-template:", "").split("-");
  // Platform is the first segment, rest is the template type
  const platformMap: Record<string, string> = {
    instagram: "instagram",
    tiktok: "tiktok",
    linkedin: "linkedin",
    google: "google",
    facebook: "facebook",
  };

  for (const [key, platform] of Object.entries(platformMap)) {
    if (type.includes(key)) {
      const templateType = type.replace(`ad-template:${key}-`, "");
      return { platform, templateType };
    }
  }

  return { platform: "unknown", templateType: type };
}

/**
 * Creates a single ad tool from a schema definition.
 * Defers Zod→JSON Schema conversion to API request time via jsonSchema(() => ...),
 * matching the AI SDK's own zod4Schema pattern. This avoids crashes when
 * schema.inputSchema is undefined at module load time (Next.js bundling issue).
 */
function createAdTool(
  schema: { description: string; inputSchema: z.ZodType },
  context: AdToolsContext,
  usage: AdToolUsage,
) {
  return tool({
    description: schema.description,
    inputSchema: jsonSchema<{ name: string; type: string; content: unknown }>(
      () => {
        if (!schema.inputSchema) {
          console.error(
            "Ad tool schema missing inputSchema:",
            schema.description,
          );
          return { type: "object" as const, properties: {} };
        }
        const raw = z.toJSONSchema(schema.inputSchema, {
          target: "draft-7",
          io: "input",
          reused: "inline",
        }) as Record<string, unknown>;
        const { $schema, ...clean } = raw;
        return {
          ...clean,
          properties: {
            ...((clean.properties as Record<string, unknown>) ?? {}),
            existingArtifactId: {
              type: "string",
              description: "ID of an existing ad artifact to update in place. Pass this when the user wants to change the same ad: for text/copy changes (e.g. 'change the headline', 'update the CTA') OR for image changes ('try a different image', 'regenerate the image', 'another image') — in both cases update this artifact instead of creating a new one. Only create a new artifact when the user explicitly asks for 'another ad' or 'a new ad'.",
            },
          },
        };
      },
    ),
    execute: async (input: { name: string; type: string; content: unknown; existingArtifactId?: string }) => {
      usage.count += 1;
      if (usage.count > MAX_AD_TOOL_USES) {
        return {
          success: false,
          error: `Ad tool use limit reached (${MAX_AD_TOOL_USES} per message). Send a new message to create more ads.`,
        };
      }

      const { platform, templateType } = parseTemplateType(input.type);

      try {

        // UPDATE existing artifact in place (text and/or new image version)
        if (input.existingArtifactId) {
          const contentStr = JSON.stringify(input.content);
          const contentObj = input.content as Record<string, unknown>;
          const updatedContent = await updateAdArtifactContent(
            input.existingArtifactId,
            contentStr
          );
          if (!updatedContent) {
            return { success: false, error: "Artifact not found or update failed" };
          }
          // Add new image version(s) from content so the client auto-generates with new prompt(s)
          const prompts = getPromptsFromContent(
            updatedContent.platform,
            updatedContent.templateType,
            contentObj
          );
          if (prompts.some((p) => p?.trim())) {
            await updateAdArtifactWithNewImageVersion(input.existingArtifactId, contentStr);
          }
          return {
            success: true,
            updated: true,
            artifactId: updatedContent.id,
            name: updatedContent.name,
            platform: updatedContent.platform,
            templateType: updatedContent.templateType,
            type: input.type,
          };
        }

        // CREATE new artifact
        const contentObj = input.content as Record<string, unknown>;
        const artifact = await createAdArtifact({
          workspaceId: context.workspaceId,
          chatId: context.chatId,
          platform,
          templateType,
          name: input.name,
          content: JSON.stringify(contentObj),
          brandId: context.brandId,
          issueId: context.issueId,
        });

        // Auto-create attachment immediately (no-media ads like Google Search) or
        // once all images are ready (media ads). Fire-and-forget.
        if (context.issueId) {
          refreshAdAttachmentIfMediaReady(artifact.id).catch(() => {});
        }

        return {
          success: true,
          artifactId: artifact.id,
          name: input.name,
          platform,
          templateType,
          type: input.type,
        };
      } catch (error) {
        console.error("Ad tool execution failed:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error creating ad artifact",
        };
      }
    },
  });
}

/**
 * Tool for the agent to fetch workspace brand and get profile/company structure
 * for each ad platform. By default the agent should use this and fill ad content
 * with the returned forPlatform[platform]; if the user asks for a custom profile/company
 * image, the agent can override the image URL (e.g. with a generated image).
 */
function createGetWorkspaceBrandTool(context: AdToolsContext) {
  return tool({
    description:
      "Get the workspace brand (name, logo URL, website, primary color) and ready-to-use profile/company structures for each ad platform. Call this before creating ads to fill profile and company fields from the brand by default. Use forPlatform[platform] when building content for create_ad_* tools. If the user asks for a custom or generated profile/company image, use that image URL instead of the brand logo.",
    inputSchema: z.object({}),
    execute: async () => {
      const brand = await getWorkspaceBrand(context.workspaceId);
      if (!brand) {
        return {
          brand: null,
          profileImagePlaceholder:
            "Omit profile/company image URL and set imagePrompt instead; the profile image will be generated when the ad is rendered.",
        };
      }
      const snapshot = {
        name: brand.name,
        resolvedLogoUrl: brand.resolvedLogoUrl ?? null,
        websiteUrl: brand.websiteUrl ?? null,
        primaryColor: brand.primaryColor ?? null,
      };
      return {
        brand: getBrandForAdContent(snapshot),
      };
    },
  });
}

/**
 * Creates all ad generation tools for the chat.
 * One tool per template type, each persisting the artifact to the database.
 * Limit: MAX_AD_TOOL_USES total ad tool calls per request (new counter each time the user sends a message).
 */
export function createAdTools(context: AdToolsContext) {
  const usage: AdToolUsage = { count: 0 }; // fresh per request (createAdTools is invoked per API request)
  return {
    get_workspace_brand: createGetWorkspaceBrandTool(context),
    create_ad_instagram_feed_post: createAdTool(InstagramFeedPostSchema, context, usage),
    create_ad_instagram_carousel: createAdTool(InstagramCarouselSchema, context, usage),
    create_ad_instagram_story: createAdTool(InstagramStorySchema, context, usage),
    create_ad_instagram_reel: createAdTool(InstagramReelSchema, context, usage),
    create_ad_tiktok_story: createAdTool(TiktokAdStorySchema, context, usage),
    create_ad_tiktok_cta: createAdTool(TiktokAdCTAToolSchema, context, usage),
    create_ad_linkedin_single_image: createAdTool(LinkedInSingleImageAdSchema, context, usage),
    create_ad_linkedin_carousel: createAdTool(LinkedInCarouselAdSchema, context, usage),
    create_ad_google_search_ad: createAdTool(GoogleSearchAdSchema, context, usage),
    create_ad_facebook_in_stream_video: createAdTool(FacebookInStreamVideoTool, context, usage),
  };
}
