import { z } from "zod";
import { LinkedInSingleImageAdSchema } from "./LinkedInSingleImageAd";
import { LinkedInCTA } from "./types";

const CarouselItemSchema = z.object({
  imagePrompt: z.string().describe('Prompt for the carousel card image'),
  imageAltText: z.string().optional().describe('Alt text for the carousel card image'),
  headline: z.string().describe('Headline for the carousel card'),
  destinationUrl: z.string().url().describe('Landing page URL for this specific card'),
});

const profileImageUrlDescription =
  'Company/profile image URL (optional). Omit to generate from prompt when the ad is rendered.';

const CarouselContentSchema = z.object({
  companyName: z.string().describe('Company name in ad header. When workspace has a brand, use the brand name.'),
  profileImageUrl: z.string().optional().describe(profileImageUrlDescription),
  followerCount: z.number().optional().describe('Number of followers'),
  adCopy: z.string().describe('Main text content of the ad (appears above the carousel)'),
  carouselItems: z.array(CarouselItemSchema).min(2).max(10).describe('Array of items for the carousel (2-10 items)'),
  overallCtaButtonText: z.nativeEnum(LinkedInCTA).optional().describe('Overall CTA for the ad unit'),
  overallDestinationUrl: z.string().url().optional().describe('Overall destination URL for the ad unit CTA'),
});

export const LinkedInCarouselAdSchema = {
  description: 'Generate a LinkedIn Carousel Ad',
  inputSchema: z.object({
    name: z.string().describe('Name of the LinkedIn Carousel Ad'),
    type: z.enum(['ad-template:linkedin-carousel']).describe('Type identifier for this ad format'),
    content: CarouselContentSchema,
  }),
};

export { CarouselItemSchema, CarouselContentSchema };

export const linkedinAdTools = {
  LinkedInSingleImageAdSchema,
  LinkedInCarouselAdSchema,
};
