"use client";

import React from 'react';
import type { InstagramAdProfile } from '../types';
import { instagramColors, instagramFonts, instagramLayout } from '../config';
import { ProfileImageOrGenerate } from '@/components/ads/components/ProfileImageOrGenerate';

interface InstagramAdProfileProps extends InstagramAdProfile {
  image?: string | null;
  imagePrompt?: string | null;
  metadataText?: string;
  style?: React.CSSProperties;
  /** Background color for the profile image (e.g. workspace brand primary color) */
  imageBackgroundColor?: string | null;
  /** Alt text for the profile image (accessibility). Defaults to username. */
  imageAltText?: string | null;
  /** When set, profile image can be generated on render if image is empty. */
  artifactId?: string;
}

export function InstagramAdProfile({
  image,
  imagePrompt,
  username,
  metadataText = 'Sponsored',
  style,
  imageBackgroundColor,
  imageAltText,
  artifactId,
}: InstagramAdProfileProps) {
  const profileImageStyle = {
    width: instagramLayout.profileImageSize,
    height: instagramLayout.profileImageSize,
    border: `1px solid ${instagramColors.border}`,
    backgroundColor: imageBackgroundColor ?? instagramColors.backgroundSecondary,
    flexShrink: 0,
  };

  return (
    <div
      className="flex items-center"
      style={{
        gap: instagramLayout.spacingXSmall,
        color: instagramColors.text,
        ...style,
      }}
    >
      <ProfileImageOrGenerate
        imageUrl={image}
        imagePrompt={imagePrompt}
        alt={imageAltText ?? username}
        artifactId={artifactId}
        className="w-8 h-8 rounded-full object-contain object-center"
        style={profileImageStyle}
        imageBackgroundColor={imageBackgroundColor}
      />
      <div className="flex flex-col gap-1" style={{ gap: instagramLayout.spacingXXXSmall }}>
        <span
          style={{
            fontSize: instagramFonts.sizes.small,
            fontWeight: instagramFonts.weights.semibold,
            lineHeight: instagramFonts.sizes.small,
          }}
        >
          {username}
        </span>
        <span
          style={{
            fontSize: instagramFonts.sizes.xsmall,
            fontWeight: instagramFonts.weights.thin,
            lineHeight: instagramFonts.sizes.xsmall,
          }}
        >
          {metadataText}
        </span>
      </div>
    </div>
  );
}
