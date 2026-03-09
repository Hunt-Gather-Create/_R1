import { z } from "zod";
import { metaDefaultToolParams } from "../../metaDefaults";

const profileImageUrlDescription =
  'Company/profile image URL (optional). Omit to generate from prompt when the ad is rendered.';

export const FacebookInStreamVideoTool = {
  description: 'Generate a Facebook in-stream video',
  inputSchema: z.object({
    name: z.string().describe('Name of the Facebook in-stream video ad'),
    type: z.enum(['ad-template:facebook-in-stream-video']),
    content: z.object({
      company: z.string().describe('Company name. When workspace has a brand, use the brand name.'),
      profile: z.object({
        imageUrl: z.string().optional().describe(profileImageUrlDescription),
        imageBackgroundColor: z.string().nullable().optional().describe('Background color for the profile image.'),
      }).optional().describe('Company profile (logo). Omit imageUrl to generate when the ad is rendered.'),
      image: z.string().describe('Image prompt for generating the main image'),
      url: z.string().describe('URL of the Facebook in-stream video'),
      followerCount: z.number().describe('Number of followers'),
      companyAbbreviation: z.string().describe('Company abbreviation 2 characters'),
      primaryText: z.string().describe('Primary text. 125 characters max'),
      headline: z.string().describe('Headline. 40 characters max'),
      hashtags: z.array(z.string()).describe('Hashtags, 30 hashtags max. Try and make it between 1 and 5.'),
      callToAction: metaDefaultToolParams.callToAction,
      secondaryAd: z
        .object({
          title: z.string().describe('Title of the secondary ad'),
          description: z.string().describe('Description of the secondary ad'),
          image: z.string().describe('Image prompt for the secondary ad'),
        })
        .describe('Secondary ad'),
    }),
  }),
};

export const facebookAdTools = {
  FacebookInStreamVideoTool,
};
