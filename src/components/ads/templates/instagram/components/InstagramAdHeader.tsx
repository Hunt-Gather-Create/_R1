import React from 'react';
import { InstagramAdProfile } from './InstagramAdProfile';
import type { InstagramAdProfile as InstagramAdProfileType } from '../types';
import { instagramLayout } from '../config';
import { InstagramAdIcon } from './InstagramAdIcon';

interface InstagramAdHeaderProps extends InstagramAdProfileType {
  metadataText?: string;
  /** Background color for the profile image (e.g. workspace brand primary color) */
  imageBackgroundColor?: string | null;
  /** Alt text for the profile image (accessibility). */
  imageAltText?: string | null;
  /** Prompt for generating profile image when image is empty. */
  imagePrompt?: string | null;
  /** Artifact ID for profile image generation on render. */
  artifactId?: string;
}

export function InstagramAdHeader({
  image,
  username,
  metadataText,
  imageBackgroundColor,
  imageAltText,
  imagePrompt,
  artifactId,
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
        imagePrompt={imagePrompt}
        username={username}
        metadataText={metadataText}
        imageBackgroundColor={imageBackgroundColor}
        imageAltText={imageAltText}
        artifactId={artifactId}
      />
      <InstagramAdIcon name="meatball" width={22} height={22} />
    </div>
  );
}
