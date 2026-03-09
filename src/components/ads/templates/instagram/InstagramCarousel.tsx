"use client";

import React, { useState } from 'react';
import { InstagramAdCard } from './components/InstagramAdCard';
import { InstagramAdHeader } from './components/InstagramAdHeader';
import { InstagramAdCTAEnum, type InstagramAdCarousel } from './types';
import { instagramBranding, instagramColors, instagramLayout } from './config';
import { InstagramAdContent } from './components/IntagramAdContent';
import { InstagramAdCTA } from './components/InstagramAdCTA';
import { InstagramAdIcon } from './components/InstagramAdIcon';
import { InstagramAdActions } from './components/InstagramAdActions';
import { InstagramAdCaption } from './components/InstagramAdCaption';
import { InstagramAdGradient } from './components/InstagramAdGradient';
interface InstagramCarouselProps {
  content: InstagramAdCarousel;
  enableGenerate: boolean;
  artifactId: string;
}

export function InstagramCarousel({ content: adContent, artifactId }: InstagramCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const {
    content = [
      {
        prompt: 'A beautiful image of a sunset over a calm ocean',
        altText: 'A beautiful image of a sunset over a calm ocean',
      },
    ],
    profile = {
      image: 'https://via.placeholder.com/40',
      username: 'Your Brand',
    },
    cta = {
      text: InstagramAdCTAEnum.LEARN_MORE,
    },
    caption = 'This is a caption',
    aspectRatio = '1:1',
    likes = 17,
  } = adContent;

  const profileImageRaw = (profile as { image?: string }).image?.trim();
  const profileImagePrompt = (profile as { imagePrompt?: string }).imagePrompt?.trim();
  const profileImage =
    profileImageRaw || (profileImagePrompt ? "" : instagramBranding.logoPlaceholder);
  const profileUsername = (profile as { username?: string }).username ?? 'Your Brand';
  const profileBgColor = (profile as { imageBackgroundColor?: string | null }).imageBackgroundColor;
  const profileAltText = (profile as { imageAltText?: string | null }).imageAltText;

  return (
    <InstagramAdCard>
      <InstagramAdHeader
        image={profileImage}
        imagePrompt={profileImagePrompt || undefined}
        username={profileUsername}
        imageBackgroundColor={profileBgColor}
        imageAltText={profileAltText}
        artifactId={artifactId}
      />
      <div className="relative">
        <div
          className="absolute left-0 top-0 bottom-0 z-[1] flex items-center justify-center cursor-pointer opacity-0 hover:opacity-100 transition-all duration-100"
          style={{ padding: instagramLayout.spacingXLarge }}
          onClick={() => setCurrentIndex((currentIndex - 1 + content.length) % content.length)}
        >
          <InstagramAdGradient direction="left" className="opacity-10" />
          <div className="rotate-180">
            <InstagramAdIcon name="chevron" color={instagramColors.text} />
          </div>
        </div>
        <div
          className="absolute right-0 top-0 bottom-0 z-[1] flex items-center justify-center cursor-pointer opacity-0 hover:opacity-100 transition-all duration-100"
          style={{ padding: instagramLayout.spacingXLarge }}
          onClick={() => setCurrentIndex((currentIndex + 1) % content.length)}
        >
          <InstagramAdGradient direction="right" className="opacity-10" />
          <div>
            <InstagramAdIcon name="chevron" color={instagramColors.text} />
          </div>
        </div>

        {content.map((item, index) => (
          <div key={index} style={{ display: index === currentIndex ? 'block' : 'none' }}>
            <InstagramAdContent aspectRatio={aspectRatio} content={item} mediaIndex={index + 1} />
          </div>
        ))}
      </div>
      <InstagramAdCTA text={cta.text} url={cta.url} type="strip" />
      <div
        className="flex justify-between relative"
        style={{ padding: instagramLayout.spacing, paddingRight: instagramLayout.spacingXLarge }}
      >
        <InstagramAdActions likes={likes} size={40} />
        <div
          className="flex items-center justify-center absolute left-0 right-0 bottom-0 top-0 z-[1]"
          style={{ gap: instagramLayout.spacingXXXSmall }}
        >
          {content.map((_, index) => (
            <div
              key={index}
              className="w-[6px] h-[6px] rounded-full cursor-pointer"
              onClick={() => setCurrentIndex(index)}
              style={{
                backgroundColor: index === currentIndex ? instagramColors.active : instagramColors.border,
              }}
            />
          ))}
        </div>
        <InstagramAdIcon name="ribbon" width={36} height={36} />
      </div>

      <div
        style={{
          paddingLeft: instagramLayout.spacing,
          paddingBottom: instagramLayout.spacing,
          paddingRight: instagramLayout.spacingXLarge,
        }}
      >
        <InstagramAdCaption name={profile.username} content={caption} likes={likes} />
      </div>
    </InstagramAdCard>
  );
}
