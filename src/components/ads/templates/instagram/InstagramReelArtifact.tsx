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

interface InstagramReelArtifactProps {
  className?: string;
}

export function InstagramReelArtifact({ className }: InstagramReelArtifactProps) {
  const { artifact } = useArtifact();
  const { mediaUrl } = useArtifactMedia(0);

  const [expanded, setExpanded] = useState(false);
  const { profile, cta, caption, likes, comments } = artifact.content;

  const profileImage = (profile as { image?: string })?.image ?? instagramBranding.logoPlaceholder;
  const profileUsername = (profile as { username?: string })?.username ?? 'Your Brand';
  const profileBgColor = (profile as { imageBackgroundColor?: string | null })?.imageBackgroundColor;

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
              username={profileUsername}
              style={{ color: instagramColors.background }}
              imageBackgroundColor={profileBgColor}
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

        <div
          className="absolute left-0 right-0 bottom-0 top-0 bg-black bg-cover bg-center rounded-[5px]"
          style={{ backgroundImage: `url(${mediaUrl.currentImageUrl})` }}
        >
          {mediaUrl.showVideo && mediaUrl.videoUrls[mediaUrl.currentIndex] && (
            <video
              src={mediaUrl.videoUrls[mediaUrl.currentIndex]}
              className="w-full h-full object-cover rounded-[5px]"
              autoPlay
              muted
              loop
            />
          )}
        </div>
        <InstagramAdGradient direction="bottom" className="opacity-50" />
      </InstagramAdCard>
    </div>
  );
}
