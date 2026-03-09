import { z } from 'zod';

export type MetaDefaultProps<Content = object> = {
  content: Content & {
    company: string;
    image: string;
    url: string;
    followerCount: number;
    companyAbbreviation: string;
    primaryText: string;
    headline: string;
    hashtags: string[];
    callToAction: string;
  };
};

export const metaDefaultToolParams = {
  callToAction: z
    .enum([
      'Learn more',
      'Apply now',
      'Book now',
      'Contact us',
      'Shop now',
      'Download',
      'Get directions',
      'Get quote',
      'Send message',
      'Order now',
      'Sign up',
      'Watch More',
      'Try in Camera',
      'Subscribe',
      'Listen now',
      'See menu',
      'Request time',
      'Call now',
    ])
    .describe('Call to action'),
};
