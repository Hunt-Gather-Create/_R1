import React from 'react';
import { tiktokAdLayout, tiktokColors } from '../config';
import { RetryImage } from '@/components/ads/components/RetryImage';

export interface TiktokAdProfileProps {
  image: string;
  /** Background color for the profile image (e.g. workspace brand primary color) */
  imageBackgroundColor?: string | null;
}

export const TiktokAdProfile = ({ image, imageBackgroundColor }: TiktokAdProfileProps) => {
  return (
    <div
      className="flex items-center gap-2 rounded-full border"
      style={{
        width: tiktokAdLayout.profile.width,
        height: tiktokAdLayout.profile.height,
        borderColor: tiktokColors.border,
        backgroundColor: imageBackgroundColor ?? tiktokColors.backgroundGray,
      }}
    >
      <RetryImage src={image} alt="profile" className="w-full h-full rounded-full object-cover object-center" />
    </div>
  );
};
