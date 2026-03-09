"use client";

import React from 'react';
import { tiktokAdLayout, tiktokColors } from '../config';
import { ProfileImageOrGenerate } from '@/components/ads/components/ProfileImageOrGenerate';
export interface TiktokAdProfileProps {
  image?: string | null;
  imagePrompt?: string | null;
  /** Background color for the profile image (e.g. workspace brand primary color) */
  imageBackgroundColor?: string | null;
  /** Alt text for the profile image (accessibility). Defaults to "profile". */
  imageAltText?: string | null;
  /** When set, profile image can be generated on render if image is empty. */
  artifactId?: string;
}

export const TiktokAdProfile = ({
  image,
  imagePrompt,
  imageBackgroundColor,
  imageAltText,
  artifactId,
}: TiktokAdProfileProps) => {
  const containerStyle = {
    width: tiktokAdLayout.profile.width,
    height: tiktokAdLayout.profile.height,
    borderColor: tiktokColors.border,
    backgroundColor: imageBackgroundColor ?? tiktokColors.backgroundGray,
  };

  return (
    <div
      className="flex items-center gap-2 rounded-full border overflow-hidden"
      style={containerStyle}
    >
      <ProfileImageOrGenerate
        imageUrl={image}
        imagePrompt={imagePrompt}
        alt={imageAltText ?? 'profile'}
        artifactId={artifactId}
        className="w-full h-full rounded-full object-cover object-center"
        style={containerStyle}
        imageBackgroundColor={imageBackgroundColor}
      />
    </div>
  );
};
