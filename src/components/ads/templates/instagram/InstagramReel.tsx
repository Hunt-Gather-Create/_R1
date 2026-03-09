"use client";

import React, { useState } from 'react';
import { InstagramAdCard } from './components/InstagramAdCard';
import { InstagramAdContent } from './components/IntagramAdContent';
import { InstagramAdCTA } from './components/InstagramAdCTA';
import { InstagramAdActions } from './components/InstagramAdActions';
import { instagramBranding, instagramColors, instagramLayout } from './config';
import { InstagramAdIcon } from './components/InstagramAdIcon';
import { InstagramAdCaption } from './components/InstagramAdCaption';
import { InstagramAdProfile } from './components/InstagramAdProfile';
import { InstagramAdCTAEnum, type InstagramAdReel } from './types';
import { InstagramAdGradient } from './components/InstagramAdGradient';

export function InstagramReel({
  content: adContent,
  artifactId,
}: {
  content: InstagramAdReel;
  artifactId?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const {
    content = {
      prompt: 'A beautiful image of a sunset over a calm ocean',
      altText: 'A beautiful image of a sunset over a calm ocean',
    },
    profile = { username: 'Your Brand' },
    cta = {
      text: InstagramAdCTAEnum.LEARN_MORE,
    },
    caption = 'This is a caption',
    aspectRatio = '9:16',
    likes = 15,
    comments = 34,
  } = adContent;

  const profileImageRaw = (profile as { image?: string }).image?.trim();
  const profileImagePrompt = (profile as { imagePrompt?: string }).imagePrompt?.trim();
  const profileImage =
    profileImageRaw || (profileImagePrompt ? "" : instagramBranding.logoPlaceholder);
  const profileUsername = (profile as { username?: string }).username ?? 'Your Brand';
  const profileBgColor = (profile as { imageBackgroundColor?: string | null }).imageBackgroundColor;
  const profileAltText = (profile as { imageAltText?: string | null }).imageAltText;

  return (
    <InstagramAdCard style={{ position: 'relative', border: 'none' }}>
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
            artifactId={artifactId}
          />
          <InstagramAdCaption
            name={profile.username}
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
      {expanded && <InstagramAdGradient direction="bottom" className="opacity-50" />}
      <InstagramAdContent aspectRatio={aspectRatio} content={content} mediaIndex={1} />
    </InstagramAdCard>
  );
}
