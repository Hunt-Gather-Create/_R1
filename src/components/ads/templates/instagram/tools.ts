// Add the schemas from each template to ad them to the tool registry

import { z } from "zod";
import { InstagramFeedPostSchema } from "./InstagramFeedPost";
import { InstagramStorySchema } from "./InstagramStory";
import { InstagramCarouselContentSchema, InstagramReelContentSchema } from "./schema";

export const InstagramCarouselSchema = {
  description: 'Generate a Instagram Carousel Ad',
  inputSchema: z.object({
    name: z.string().describe('Name of the Instagram Carousel Ad'),
    type: z.enum(['ad-template:instagram-carousel']).describe('Type identifier for this ad format'),
    content: InstagramCarouselContentSchema,
  }),
};

export const InstagramReelSchema = {
  description: 'Generate a Instagram Reel Ad',
  inputSchema: z.object({
    name: z.string().describe('Name of the Instagram Reel Ad'),
    type: z.enum(['ad-template:instagram-reel']).describe('Type identifier for this ad format'),
    content: InstagramReelContentSchema,
  }),
};

export const instagramAdTools = {
    InstagramReelSchema,
    InstagramFeedPostSchema,
    InstagramStorySchema,
    InstagramCarouselSchema
};
