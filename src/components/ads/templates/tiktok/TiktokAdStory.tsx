import React from 'react';
import { tiktokAdLayout, tiktokBranding, tiktokColors, tiktokText } from './config';
import { TiktokAdMenu } from './components/TiktokAdMenu';
import { getAspectRatioValue } from '../../types/ContentData';
import { TiktokAdActions } from './components/TiktokAdActions';
import { TiktokAdHeader } from './components/TiktokAdHeader';
import { TiktokAdGradient } from './components/TiktokAdGradient';
import { TiktokAdFooter } from './components/TiktokAdFooter';
import { TiktokAdCTAEnum, type TiktokAdContent } from './types';
import { z } from 'zod';
import { TiktokAdSchema } from './schema';
import { ArtifactMedia } from '../../components/ArtifactMedia';

export const TiktokAdStorySchema = {
  description: 'Generate a Tiktok Ad Story',
  inputSchema: z.object({
    name: z.string().describe('Name of the Tiktok Ad Story'),
    type: z.enum(['ad-template:tiktok-story']).describe('Type identifier for this ad format'),
    content: TiktokAdSchema,
  }),
};

interface TiktokAdStoryProps {
  content: TiktokAdContent;
  artifactId?: string;
}

export const TiktokAdStory = ({ content: adContent, artifactId }: TiktokAdStoryProps) => {
  const {
    profile = { image: '', username: 'BrandName' },
    content = { prompt: '', altText: '' },
    caption = 'This is caption that will display on the final mockup. You can write anything.',
    sound = { name: 'Cheryl', author: 'Yung Gravy' },
    cta = { text: TiktokAdCTAEnum.LEARN_MORE },
  } = adContent;

  const aspectRatio = '9:16';
  const randomLikes = Math.floor(Math.random() * 100);
  const profileImageRaw = (profile as { image?: string }).image?.trim();
  const profileImagePrompt = (profile as { imagePrompt?: string }).imagePrompt?.trim();
  const profileImage =
    profileImageRaw || (profileImagePrompt ? "" : tiktokBranding.logoPlaceholder);
  const profileUsername = (profile as { username?: string }).username ?? 'Your Brand';
  const profileBgColor = (profile as { imageBackgroundColor?: string | null }).imageBackgroundColor;
  const profileAltText = (profile as { imageAltText?: string | null }).imageAltText;
  const companyProfile = {
    image: profileImage,
    imagePrompt: profileImagePrompt || undefined,
    username: profileUsername,
    imageBackgroundColor: profileBgColor,
    imageAltText: profileAltText,
    artifactId,
  };

  return (
    <div
      className="flex flex-col items-stretch w-full overflow-hidden"
      style={{
        maxWidth: tiktokAdLayout.maxWidth,
        borderRadius: tiktokAdLayout.spacing.md,
        fontFamily: tiktokText.fontFamily,
        color: tiktokColors.text,
      }}
    >
      <div
        className="relative"
        style={{
          aspectRatio: getAspectRatioValue(aspectRatio),
          backgroundColor: tiktokColors.backgroundSecondary,
        }}
      >
        <ArtifactMedia prompt={content.prompt} altText={content.altText} aspectRatio={aspectRatio} mediaIndex={1} />
        <TiktokAdFooter
          className="absolute bottom-0 left-0 right-[62px] z-[2]"
          username={companyProfile.username}
          caption={caption}
          soundName={sound.name}
          soundAuthor={sound.author}
          cta={cta}
        />
        <TiktokAdHeader className="absolute top-0 right-0 left-0 z-[2]" />
        <TiktokAdActions profile={companyProfile} likes={randomLikes} className="absolute bottom-0 right-0 z-[2]" />
        <TiktokAdGradient direction="top" className="absolute bottom-auto h-20 z-[1] opacity-30" />
        <TiktokAdGradient direction="bottom" className="absolute bottom-0 top-auto h-30 z-[1] opacity-30" />
      </div>
      <TiktokAdMenu />
    </div>
  );
};
