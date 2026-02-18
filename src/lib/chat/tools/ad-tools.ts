import { tool, jsonSchema } from "ai";
import { z } from "zod";
import { createAdArtifact } from "@/lib/actions/ad-artifacts";
import { getWorkspaceBrand } from "@/lib/actions/brand";
import { mergeWorkspaceBrandIntoContent } from "@/lib/ads/merge-workspace-brand";

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

interface AdToolsContext {
  workspaceId: string;
  /** Only set when chat is a workspace chat (workspace_chats.id). Omit for issue chat to avoid FK violation. */
  chatId?: string;
  brandId?: string;
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
        return clean;
      },
    ),
    execute: async (input: { name: string; type: string; content: unknown }) => {
      const { platform, templateType } = parseTemplateType(input.type);

      try {
        // Resolve workspace brand into content on the backend so the frontend only renders content
        let contentToSave = input.content as Record<string, unknown>;
        const brand = await getWorkspaceBrand(context.workspaceId);
        if (brand) {
          contentToSave = mergeWorkspaceBrandIntoContent(
            contentToSave,
            {
              name: brand.name,
              resolvedLogoUrl: brand.resolvedLogoUrl ?? null,
              websiteUrl: brand.websiteUrl ?? null,
              primaryColor: brand.primaryColor ?? null,
            },
            platform,
            templateType
          );
        }

        const artifact = await createAdArtifact({
          workspaceId: context.workspaceId,
          chatId: context.chatId, // only set for workspace chat; omit for issue chat (FK references workspace_chats.id)
          platform,
          templateType,
          name: input.name,
          content: JSON.stringify(contentToSave),
          brandId: context.brandId,
        });

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
 * Creates all ad generation tools for the chat.
 * One tool per template type, each persisting the artifact to the database.
 */
export function createAdTools(context: AdToolsContext) {
  return {
    create_ad_instagram_feed_post: createAdTool(InstagramFeedPostSchema, context),
    create_ad_instagram_carousel: createAdTool(InstagramCarouselSchema, context),
    create_ad_instagram_story: createAdTool(InstagramStorySchema, context),
    create_ad_instagram_reel: createAdTool(InstagramReelSchema, context),
    create_ad_tiktok_story: createAdTool(TiktokAdStorySchema, context),
    create_ad_tiktok_cta: createAdTool(TiktokAdCTAToolSchema, context),
    create_ad_linkedin_single_image: createAdTool(LinkedInSingleImageAdSchema, context),
    create_ad_linkedin_carousel: createAdTool(LinkedInCarouselAdSchema, context),
    create_ad_google_search_ad: createAdTool(GoogleSearchAdSchema, context),
    create_ad_facebook_in_stream_video: createAdTool(FacebookInStreamVideoTool, context),
  };
}
