import { z } from 'zod';
import { InstagramAdCTAEnum } from "./types";

export const InstagramAdCTASchema = z.object({
    text: z.enum(Object.values(InstagramAdCTAEnum) as [string, ...string[]]).describe('CTA text'),
    url: z.string().describe('CTA URL').optional(),
});

const profileImageDescription =
  'Profile image URL (optional). Omit or leave empty and set imagePrompt to generate the profile image when the ad is rendered.';

export const InstagramAdProfileSchema = z.object({
    image: z.string().optional().describe(profileImageDescription),
    imagePrompt: z.string().optional().describe('Prompt for generating the profile image when image is omitted. E.g. "Professional minimalist company logo, simple and modern". Used when the ad is rendered.'),
    username: z.string().describe('Profile username (e.g. brand/company name). When workspace has a brand, use the brand name.'),
    imageBackgroundColor: z.string().nullable().optional().describe('Background color for the profile image (e.g. brand primary color).'),
    imageAltText: z.string().optional().describe('Alt text for the profile image (accessibility). Defaults to username if omitted.'),
});

export const InstagramAdCaptionSchema = z.string()
    .min(1, 'Caption cannot be empty')
    // .max(90, 'Caption cannot exceed 90 characters') // TODO: fix this, the validation doesn't work and it prevents the image from being generated
    .describe('Caption. This is the text that will be displayed in the ad. It should not exceed 90 characters.');

export const InstagramAdContentSchema = z.object({
    prompt: z.string().describe('Prompt for generating the main ad image using Round One\'s image generator (similar to DALL-E). You always should use one strong image instead of a panel of images, unless the users asks for it. Avoid using text in the image.'),
    altText: z.string().optional().describe('Alternative text for the ad image'),
});

export const InstagramCarouselContentSchema = z.object({
  content: z.array(InstagramAdContentSchema).min(3).max(10),
  profile: InstagramAdProfileSchema,
  cta: InstagramAdCTASchema,
  caption: InstagramAdCaptionSchema,
});

export const InstagramReelContentSchema = z.object({
  profile: InstagramAdProfileSchema,
  cta: InstagramAdCTASchema,
  caption: InstagramAdCaptionSchema,
  content: InstagramAdContentSchema,
});
