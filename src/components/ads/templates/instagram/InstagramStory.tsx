import React from 'react';
import { InstagramAdCTAEnum, type InstagramAdStory } from './types';
import { InstagramAdCard } from './components/InstagramAdCard';
import { InstagramAdContent } from './components/IntagramAdContent';
import { instagramBranding, instagramColors, instagramLayout } from './config';
import { InstagramAdProfile } from './components/InstagramAdProfile';
import { InstagramAdIcon } from './components/InstagramAdIcon';
import { InstagramAdProgress } from './components/InstagramAdProgress';
import { InstagramAdCTA } from './components/InstagramAdCTA';
import { InstagramAdGradient } from './components/InstagramAdGradient';
import { z } from 'zod';
import { InstagramAdProfileSchema, InstagramAdCTASchema, InstagramAdContentSchema } from './schema';

export const InstagramStoryContentSchema = z.object({
  profile: InstagramAdProfileSchema,
  cta: InstagramAdCTASchema,
  content: InstagramAdContentSchema,
});

// Tool Schema
export const InstagramStorySchema = {
  description: 'Generate a single image Instagram Story',
  inputSchema: z.object({
    name: z.string().describe('Name of the Instagram Story'),
    type: z.enum(['ad-template:instagram-story']).describe('Type identifier for this ad format'),
    content: InstagramStoryContentSchema,
  }),
};

interface InstagramStoryProps {
  content: InstagramAdStory;
  artifactId?: string;
}

export const InstagramStory = ({ content: adContent, artifactId }: InstagramStoryProps) => {
  const {
    content = {
      prompt: 'A beautiful image of a sunset over a calm ocean',
      altText: 'A beautiful image of a sunset over a calm ocean',
    },
    profile = { username: 'Your Brand' },
    cta = {
      text: InstagramAdCTAEnum.LEARN_MORE,
    },
    aspectRatio = '9:16',
  } = adContent;

  const profileImageRaw = (profile as { image?: string }).image?.trim();
  const profileImagePrompt = (profile as { imagePrompt?: string }).imagePrompt?.trim();
  const profileImage =
    profileImageRaw || (profileImagePrompt ? "" : instagramBranding.logoPlaceholder);
  const profileUsername = (profile as { username?: string }).username ?? 'Your Brand';
  const profileBgColor = (profile as { imageBackgroundColor?: string | null }).imageBackgroundColor;
  const profileAltText = (profile as { imageAltText?: string | null }).imageAltText;

  return (
    <InstagramAdCard className="relative">
      <div
        className="absolute top-0 left-0 z-[2] w-full"
        style={{
          paddingLeft: instagramLayout.spacingMedium,
          paddingRight: instagramLayout.spacingMedium,
          paddingTop: instagramLayout.spacingSmall,
          paddingBottom: instagramLayout.spacingSmall,
        }}
      >
        <InstagramAdProgress style={{ marginBottom: instagramLayout.spacingSmall }} />
        <div className="flex items-center justify-between">
          <InstagramAdProfile
            image={profileImage}
            imagePrompt={profileImagePrompt || undefined}
            username={profileUsername}
            style={{ color: instagramColors.background }}
            imageBackgroundColor={profileBgColor}
            imageAltText={profileAltText}
            artifactId={artifactId}
          />
          <div className="flex items-center" style={{ gap: instagramLayout.spacing }}>
            <InstagramAdIcon name="meatball" color={instagramColors.background} />
            <InstagramAdIcon name="close" color={instagramColors.background} />
          </div>
        </div>
        <InstagramAdGradient direction="top" className="opacity-25 z-[-1]" />
      </div>

      <div
        className="absolute left-0 right-0 bottom-0 z-[2] w-full flex justify-center"
        style={{
          paddingLeft: instagramLayout.spacingMedium,
          paddingRight: instagramLayout.spacingMedium,
          paddingBottom: instagramLayout.spacing,
        }}
      >
        <InstagramAdCTA text={cta.text} type="round-button" />
        <div
          className="absolute"
          style={{
            right: instagramLayout.spacingXLarge,
            bottom: instagramLayout.spacingSmall,
            paddingBottom: instagramLayout.spacing,
          }}
        >
          <InstagramAdIcon name="share" color={instagramColors.background} width={36} height={36} />
        </div>
        <InstagramAdGradient direction="bottom" className="opacity-25 z-[-1]" />
      </div>

      <InstagramAdContent content={content} aspectRatio={aspectRatio} mediaIndex={1} />
    </InstagramAdCard>
  );
};
