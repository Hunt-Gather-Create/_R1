"use client";

import { useState } from 'react';
import { InstagramAdActions } from './components/InstagramAdActions';
import { InstagramAdCaption } from './components/InstagramAdCaption';
import { InstagramAdCard } from './components/InstagramAdCard';
import { InstagramAdCTA } from './components/InstagramAdCTA';
import { InstagramAdGradient } from './components/InstagramAdGradient';
import { InstagramAdIcon } from './components/InstagramAdIcon';
import { InstagramAdProfile } from './components/InstagramAdProfile';
import { instagramBranding, instagramColors, instagramLayout } from './config';
import { useArtifact } from '@/components/ads/hooks/useArtifact';
import { useArtifactMedia } from '@/components/ads/hooks/useArtifactMedia';
import { ArtifactMedia } from '@/components/ads/components/ArtifactMedia';
import type { InstagramAdReel } from './types';

interface InstagramReelArtifactProps {
  className?: string;
}

export function InstagramReelArtifact({ className }: InstagramReelArtifactProps) {
  const { content, artifact } = useArtifact();
  const { mediaUrl } = useArtifactMedia(1);
  const adContent = content as InstagramAdReel;
  const { profile, cta, caption, likes, comments, content: reelContent } = adContent;

  const [expanded, setExpanded] = useState(false);

  const profileImageRaw = (profile as { image?: string })?.image?.trim();
  const profileImagePrompt = (profile as { imagePrompt?: string })?.imagePrompt?.trim();
  const profileImage =
    profileImageRaw || (profileImagePrompt ? "" : instagramBranding.logoPlaceholder);
  const profileUsername = (profile as { username?: string })?.username ?? 'Your Brand';
  const profileBgColor = (profile as { imageBackgroundColor?: string | null })?.imageBackgroundColor;
  const profileAltText = (profile as { imageAltText?: string | null })?.imageAltText;

  const reelContentData = (reelContent as { prompt?: string; altText?: string }) ?? {};
  const prompt = reelContentData.prompt ?? '';
  const altText = reelContentData.altText ?? 'Reel image';

  return (
    <div className="h-full w-full">
      <InstagramAdCard className={`border-none p-0 relative h-full min-h-[700px] max-h-[800px] w-[450px] ${className}`}>
        <div
          className="absolute left-0 right-0 bottom-0 flex flex-row justify-end z-[2]"
          style={{
            gap: instagramLayout.spacingXXLarge,
            padding: instagramLayout.spacing,
          }}
        >
          <div className="flex flex-col justify-end flex-1" style={{ gap: instagramLayout.spacing }}>
            <InstagramAdProfile
              image={profileImage}
              imagePrompt={profileImagePrompt || undefined}
              username={profileUsername}
              style={{ color: instagramColors.background }}
              imageBackgroundColor={profileBgColor}
              imageAltText={profileAltText}
              artifactId={artifact?.id}
            />
            <InstagramAdCaption
              name={profileUsername}
              content={caption}
              showLikes={false}
              showUsername={false}
              style={{ color: instagramColors.background }}
              expanded={expanded}
              onExpand={setExpanded}
            />
            <InstagramAdCTA text={cta.text} url={cta.url} type="button" />
          </div>
          <div
            className="flex flex-col justify-end items-center"
            style={{ gap: instagramLayout.spacingXLarge, marginBottom: instagramLayout.spacingLarge }}
          >
            <InstagramAdActions
              className="flex-col"
              style={{ gap: instagramLayout.spacingXLarge }}
              showNumbers
              likes={likes}
              comments={comments}
              color={instagramColors.background}
            />
            <InstagramAdIcon name="meatball" color={instagramColors.background} />
          </div>
        </div>

        <div className="absolute left-0 right-0 bottom-0 top-0 rounded-[5px] overflow-hidden bg-black">
          {mediaUrl.showVideo && mediaUrl.videoUrls[mediaUrl.currentIndex] ? (
            <video
              src={mediaUrl.videoUrls[mediaUrl.currentIndex]}
              className="w-full h-full object-cover rounded-[5px]"
              autoPlay
              muted
              loop
            />
          ) : (
            <ArtifactMedia
              prompt={prompt}
              altText={altText}
              aspectRatio="9:16"
              mediaIndex={1}
            />
          )}
        </div>
        <InstagramAdGradient direction="bottom" className="opacity-50" />
      </InstagramAdCard>
    </div>
  );
}
