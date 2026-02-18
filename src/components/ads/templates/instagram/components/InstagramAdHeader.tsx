import React from 'react';
import { InstagramAdProfile } from './InstagramAdProfile';
import type { InstagramAdProfile as InstagramAdProfileType } from '../types';
import { instagramLayout } from '../config';
import { InstagramAdIcon } from './InstagramAdIcon';

interface InstagramAdHeaderProps extends InstagramAdProfileType {
  metadataText?: string;
  /** Background color for the profile image (e.g. workspace brand primary color) */
  imageBackgroundColor?: string | null;
}

export function InstagramAdHeader({
  image,
  username,
  metadataText,
  imageBackgroundColor,
}: InstagramAdHeaderProps) {
  return (
    <div
      className="flex items-center justify-between w-full"
      style={{
        paddingTop: instagramLayout.spacingMedium,
        paddingBottom: instagramLayout.spacingSmall,
        paddingLeft: instagramLayout.spacingXSmall,
        paddingRight: instagramLayout.spacingLarge,
      }}
    >
      <InstagramAdProfile
        image={image}
        username={username}
        metadataText={metadataText}
        imageBackgroundColor={imageBackgroundColor}
      />
      <InstagramAdIcon name="meatball" width={22} height={22} />
    </div>
  );
}
