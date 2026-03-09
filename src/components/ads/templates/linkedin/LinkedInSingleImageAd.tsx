import React from 'react';
import { z } from 'zod';
import AdFooter from './components/AdFooter';
import AdHeader from './components/AdHeader';
import AdMainContent from './components/AdMainContent';
import LinkedInAdCard from './components/LinkedInAdCard';
import AdCallToActionDisplay from './components/AdCallToActionDisplay';
import AdSocialCounts from './components/AdSocialCounts';
import { linkedInBranding } from './config';
import { LinkedInCTA } from './types';

const profileImageUrlDescription =
  'Company logo URL (optional). Omit and set imagePrompt in profile to generate when the ad is rendered.';

export const LinkedInSingleImageAdSchema = {
  description: 'Generate a LinkedIn Single Image Ad',
  inputSchema: z.object({
    name: z.string().describe('Name of the LinkedIn Single Image Ad'),
    type: z.enum(['ad-template:linkedin-single-image']).describe('Type identifier for this ad format'),
    content: z.object({
      companyName: z.string().describe('Company name appearing in the ad header. When workspace has a brand, use the brand name.'),
      followerCount: z.number().optional().describe('Number of followers, displayed in the header'),
      adCopy: z.string().describe('Main text content of the ad (the post body)'),
      imagePrompt: z.string().describe('Prompt for generating the main ad image'),
      imageAltText: z.string().optional().describe('Alternative text for the ad image'),
      imageAspectRatio: z.enum(['1:1', '16:9']).optional().describe('Aspect ratio of the ad image'),
      headline: z.string().describe('Headline displayed below the image'),
      ctaButtonText: z.nativeEnum(LinkedInCTA).describe('Text for the call-to-action button'),
      profile: z.object({
        profileImageUrl: z.string().optional().describe(profileImageUrlDescription),
        imageBackgroundColor: z.string().nullable().optional().describe('Background color for the company logo area.'),
      }).optional().describe('Company profile (logo). Omit profileImageUrl to generate from prompt when the ad is rendered.'),
    }),
  }),
};

type Props = z.infer<typeof LinkedInSingleImageAdSchema.inputSchema>;

export const LinkedInSingleImageAd: React.FC<Props> = ({ content }) => {
  const {
    companyName,
    followerCount,
    adCopy,
    imagePrompt,
    imageAltText,
    headline,
    ctaButtonText,
    imageAspectRatio = '1:1',
  } = content;

  const socialCounts = React.useMemo(
    () => ({
      reactionCount: Math.floor(Math.random() * 100),
      commentCount: Math.floor(Math.random() * 100),
      shareCount: Math.floor(Math.random() * 100),
    }),
    [],
  );

  const headerTitle = companyName;
  const profile = content && typeof (content as { profile?: unknown }).profile === "object" ? (content as unknown as { profile: { profileImageUrl?: string; imageBackgroundColor?: string | null } }).profile : undefined;
  const companyLogo = profile?.profileImageUrl ?? linkedInBranding.logoPlaceholder;
  const profileImageBg = profile?.imageBackgroundColor;

  return (
    <LinkedInAdCard>
      <AdHeader
        title={headerTitle}
        profileImageUrl={companyLogo}
        metadataText={followerCount ? `${followerCount.toLocaleString()} followers` : undefined}
        imageBackgroundColor={profileImageBg}
      />
      <AdMainContent
        imagePrompt={imagePrompt}
        imageAlt={imageAltText || `Ad image for ${companyName}`}
        aspectRatio={imageAspectRatio}
        mediaType="image"
        copy={adCopy}
      >
        <AdCallToActionDisplay headline={headline} companyName={headerTitle} ctaButtonText={ctaButtonText} />
        <AdSocialCounts
          reactionCount={socialCounts.reactionCount}
          commentText={`${socialCounts.commentCount} comments`}
          shareText={`${socialCounts.shareCount} shares`}
        />
      </AdMainContent>
      <AdFooter />
    </LinkedInAdCard>
  );
};
