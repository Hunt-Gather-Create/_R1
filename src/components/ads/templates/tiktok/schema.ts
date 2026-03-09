import { z } from 'zod';
import { TiktokAdCTAEnum } from "./types";

export const TiktokAdContentSchema = z.object({
    prompt: z.string().describe('Prompt for generating the main ad image using Round One\'s image generator (similar to DALL-E). You always should use one strong image instead of a panel of images, unless the users asks for it. Avoid using text in the image.'),
    altText: z.string().optional().describe('Alternative text for the ad image'),
});

const profileImageDescription =
  'Profile image URL (optional). Omit or leave empty and set imagePrompt to generate the profile image when the ad is rendered.';

export const TiktokAdProfileSchema = z.object({
    image: z.string().optional().describe(profileImageDescription),
    imagePrompt: z.string().optional().describe('Prompt for generating the profile image when image is omitted. E.g. "Professional minimalist company logo, simple and modern". Used when the ad is rendered.'),
    username: z.string().describe('Profile username (e.g. brand/company name). When workspace has a brand, use the brand name.'),
    imageBackgroundColor: z.string().nullable().optional().describe('Background color for the profile image (e.g. brand primary color).'),
    imageAltText: z.string().optional().describe('Alt text for the profile image (accessibility). Defaults to username if omitted.'),
});

export const TiktokAdCaptionSchema = z.string()
    .min(1, 'Caption cannot be empty')
    // .max(90, 'Caption cannot exceed 90 characters') // TODO: fix this, the validation doesn't work and it prevents the image from being generated
    .describe('Caption. This is the text that will be displayed in the ad. It should not exceed 90 characters.');

export const TiktokAdSoundSchema = z.object({
    name: z.string().describe('Sound name. This is a short name of the sound that will be displayed in the ad.'),
    author: z.string().describe('Sound author. This is the author of the sound that will be displayed in the ad.'),
});

export const TiktokAdCTASchema = z.object({
    text: z.enum(Object.values(TiktokAdCTAEnum) as [string, ...string[]]).describe('CTA text'),
    url: z.string().describe('CTA URL').optional(),
    color: z.string().describe('CTA color. This is the color of the CTA button. It can be any valid CSS color value.').optional().default('#000000'),
});

export const TiktokAdCTAImageSchema = z.object({
    prompt: z.string().describe('Prompt for generating the CTA image using Round One\'s image generator (similar to DALL-E). You always should use one strong image instead of a panel of images, unless the users asks for it. Avoid using text in the image.'),
    altText: z.string().optional().describe('Alternative text for the CTA image'),
});

export const TiktokAdSchema = z.object({
    profile: TiktokAdProfileSchema,
    content: TiktokAdContentSchema,
    caption: TiktokAdCaptionSchema,
    sound: TiktokAdSoundSchema,
    cta: TiktokAdCTASchema,
});

export const TiktokCTAAdSchema = z.object({
    profile: TiktokAdProfileSchema,
    content: TiktokAdCTAImageSchema,
    caption: TiktokAdCaptionSchema,
    sound: TiktokAdSoundSchema,
    cta: TiktokAdCTASchema,
    ctaImage: TiktokAdCTAImageSchema,
});
