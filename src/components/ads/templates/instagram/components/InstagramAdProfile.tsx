import React from 'react';
import type { InstagramAdProfile } from '../types';
import { instagramBranding, instagramColors, instagramFonts, instagramLayout } from '../config';
import { RetryImage } from '@/components/ads/components/RetryImage';

interface InstagramAdProfileProps extends InstagramAdProfile {
  image: string;
  metadataText?: string;
  style?: React.CSSProperties;
  /** Background color for the profile image (e.g. workspace brand primary color) */
  imageBackgroundColor?: string | null;
}

export function InstagramAdProfile({
  image,
  username,
  metadataText = 'Sponsored',
  style,
  imageBackgroundColor,
}: InstagramAdProfileProps) {
  return (
    <div
      className="flex items-center"
      style={{
        gap: instagramLayout.spacingXSmall,
        color: instagramColors.text,
        ...style,
      }}
    >
      <RetryImage
        src={image}
        alt={username}
        className="w-8 h-8 rounded-full object-cover object-center "
        style={{
          width: instagramLayout.profileImageSize,
          height: instagramLayout.profileImageSize,
          border: `1px solid ${instagramColors.border}`,
          backgroundColor: imageBackgroundColor ?? instagramColors.backgroundSecondary,
        }}
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
