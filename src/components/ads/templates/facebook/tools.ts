import { z } from "zod";
import { metaDefaultToolParams } from "../../metaDefaults";

export const FacebookInStreamVideoTool = {
  description: 'Generate a Facebook in-stream video',
  inputSchema: z.object({
    name: z.string().describe('Name of the Facebook in-stream video ad'),
    type: z.enum(['ad-template:facebook-in-stream-video']),
    content: z.object({
      company: z.string().describe('Company name. When workspace has a brand, use the brand name. Profile image and URL are filled from the workspace brand when the ad is saved.'),
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
