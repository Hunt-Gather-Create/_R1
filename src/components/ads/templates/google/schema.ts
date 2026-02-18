import { z } from 'zod';

export const companySchema = z.object({
  name: z.string().describe('Name of the company (for display). When workspace has a brand, use the brand name.'),
  logo: z.string().describe('URL of the company logo. Filled from workspace brand logo when the ad is saved; provide a placeholder if needed.'),
  url: z.string().describe('Company website URL. Filled from workspace brand website when the ad is saved; provide a placeholder if needed.'),
  imageBackgroundColor: z.string().nullable().optional().describe('Background color for the profile image'),
});

export const suggestedSearchSchema = z.object({
  title: z.string().describe('Title of the suggested search. 1-2 words.'),
  link: z.string().describe('URL of the suggested search'),
});

export const searchSchema = z.object({
  title: z.string().describe('Title of the product. Optimized for SEO. 10-15 words.'),
  description: z.string().describe('Description of the product. Optimized for SEO. 100-150 words.'),
  link: z.string().describe('URL of the product'),
  location: z.string().describe('Location of the store. 1-2 words.').optional(),
  suggestedSearches: z.array(suggestedSearchSchema).min(2).max(8).describe('Suggested searches for the product. 1-2 words.').optional(),
});
