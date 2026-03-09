import React from 'react';
import type { InstagramAdCTAEnum } from '../types';
import { instagramColors, instagramFonts, instagramLayout } from '../config';
import { InstagramAdIcon } from './InstagramAdIcon';

interface InstagramAdCTAProps {
  type?: 'button' | 'strip' | 'round-button';
  text: InstagramAdCTAEnum;
  url?: string;
}

export function InstagramAdCTA({ type = 'strip', text }: InstagramAdCTAProps) {
  if (type === 'button') {
    return (
      <div
        className="w-full text-center"
        style={{
          padding: instagramLayout.spacingXXSmall,
          backgroundColor: instagramColors.background,
          fontSize: instagramFonts.sizes.small,
          fontWeight: instagramFonts.weights.semibold,
          color: instagramColors.background,
          borderRadius: instagramLayout.borderRadius,
          background: instagramColors.backgroundCTA,
        }}
      >
        {text}
      </div>
    );
  }

  if (type === 'round-button') {
    return (
      <div className="flex flex-col items-center justify-center" style={{ gap: instagramLayout.spacingSmall }}>
        <InstagramAdIcon name="chevron-up" color={instagramColors.background} width={28} height={28} />
        <div
          className="rounded-full"
          style={{
            paddingLeft: instagramLayout.spacingXXLarge,
            paddingRight: instagramLayout.spacingXXLarge,
            paddingTop: instagramLayout.spacing,
            paddingBottom: instagramLayout.spacing,
            backgroundColor: instagramColors.background,
            color: instagramColors.text,
            fontSize: instagramFonts.sizes.small,
            lineHeight: instagramFonts.sizes.small,
            fontWeight: instagramFonts.weights.regular,
          }}
        >
          {text}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        paddingLeft: instagramLayout.spacing,
        paddingRight: instagramLayout.spacingXLarge,
      }}
    >
      <div
        className="flex items-center justify-between"
        style={{
          borderBottom: `1px solid ${instagramColors.border}`,
          paddingTop: instagramLayout.spacingLarge,
          paddingBottom: instagramLayout.spacingLarge,
        }}
      >
        <span
          style={{
            fontSize: instagramFonts.sizes.small,
            fontWeight: instagramFonts.weights.semibold,
            color: instagramColors.text,
          }}
        >
          {text}
        </span>
        <InstagramAdIcon name="chevron" width={28} height={28} />
      </div>
    </div>
  );
}
