import React from 'react';
import { InstagramAdCard } from './components/InstagramAdCard';
import { InstagramAdHeader } from './components/InstagramAdHeader';
import { InstagramAdContent } from './components/IntagramAdContent';
import { InstagramAdCTA } from './components/InstagramAdCTA';
import { InstagramAdActions } from './components/InstagramAdActions';
import { instagramBranding, instagramLayout } from './config';
import { InstagramAdIcon } from './components/InstagramAdIcon';
import { InstagramAdCaption } from './components/InstagramAdCaption';
import {
  InstagramAdCaptionSchema,
  InstagramAdContentSchema,
  InstagramAdCTASchema,
  InstagramAdProfileSchema,
} from './schema';
import { z } from 'zod';
import { InstagramAdCTAEnum, type InstagramAdFeedPost } from './types';

export const InstagramFeedPostContentSchema = z.object({
  profile: InstagramAdProfileSchema,
  cta: InstagramAdCTASchema,
  caption: InstagramAdCaptionSchema,
  content: InstagramAdContentSchema,
  aspectRatio: z.enum(['1:1', '4:5', '16:9']).describe('Aspect ratio of the content image or video').default('1:1'),
});

export const InstagramFeedPostSchema = {
  description: 'Generate a Instagram Feed Post Ad',
  inputSchema: z.object({
    name: z.string().describe('Name of the Instagram Feed Post Ad'),
    type: z.enum(['ad-template:instagram-feed-post']).describe('Type identifier for this ad format'),
    content: InstagramFeedPostContentSchema,
  }),
};

export function InstagramFeedPost({ content: adContent }: { content: InstagramAdFeedPost }) {
  const {
    content = {
      prompt: 'A beautiful image of a sunset over a calm ocean',
      altText: 'A beautiful image of a sunset over a calm ocean',
    },
    profile = {
      image: 'https://via.placeholder.com/40',
      username: 'Your Brand',
    },
    cta = {
      text: InstagramAdCTAEnum.LEARN_MORE,
    },
    caption = 'This is a caption',
    aspectRatio = '1:1',
    likes = 15,
  } = adContent;

  const profileImage = (profile as { image?: string }).image ?? instagramBranding.logoPlaceholder;
  const profileUsername = (profile as { username?: string }).username ?? 'Your Brand';
  const profileBgColor = (profile as { imageBackgroundColor?: string | null }).imageBackgroundColor;
  const companyProfile = { image: profileImage, username: profileUsername };

  return (
    <InstagramAdCard>
      <InstagramAdHeader
        image={companyProfile.image}
        username={companyProfile.username}
        imageBackgroundColor={profileBgColor}
      />
      <InstagramAdContent content={content} aspectRatio={aspectRatio} />
      <InstagramAdCTA text={cta.text} url={cta.url} type="strip" />
      <div
        className="flex justify-between"
        style={{ padding: instagramLayout.spacing, paddingRight: instagramLayout.spacingXLarge }}
      >
        <InstagramAdActions likes={likes} size={36} />
        <InstagramAdIcon name="ribbon" width={36} height={36} />
      </div>

      <div
        style={{
          paddingLeft: instagramLayout.spacing,
          paddingBottom: instagramLayout.spacing,
          paddingRight: instagramLayout.spacingXLarge,
        }}
      >
        <InstagramAdCaption name={companyProfile.username} content={caption} likes={likes} />
      </div>
    </InstagramAdCard>
  );
}
