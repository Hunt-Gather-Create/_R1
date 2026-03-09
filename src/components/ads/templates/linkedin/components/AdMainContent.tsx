import React from 'react';
import { linkedInColors, linkedInFonts, linkedInLayout } from '../config';
import { ArtifactMedia } from '@/components/ads/components/ArtifactMedia';

interface AdMainContentProps {
  copy: string;
  imagePrompt: string;
  imageAlt?: string;
  aspectRatio?: '1:1' | '16:9'; // e.g., '16/9', '1/1' for different ad formats
  mediaType?: 'image' | 'video' | 'carousel' | 'document'; // To potentially adapt styling or components later
  children?: React.ReactNode; // For additional elements like video players or carousel controls
  style?: React.CSSProperties;
}

export default function AdMainContent({
  copy,
  imagePrompt,
  imageAlt = 'Advertisement Image',
  aspectRatio = '1:1', // Common for LinkedIn single image ads
  mediaType = 'image',
  children,
  style = {},
}: AdMainContentProps) {
  let height = '300px';

    if (aspectRatio) {
      const parts = aspectRatio.split('/');
      const w = parseFloat(parts[0]);
      const h = parseFloat(parts[1]);
      if (!isNaN(w) && !isNaN(h) && w > 0 && h > 0) {
        height = `${(h / w) * 100}%`;
      }
    }

  return (
    <div style={{ fontFamily: linkedInFonts.primary, ...style }}>
      {copy && (
        <p
          style={{
            fontSize: linkedInFonts.sizes.small,
            color: linkedInColors.textPrimary,
            marginBottom: linkedInLayout.spacingMedium,
            whiteSpace: 'pre-line',
          }}
        >
          {copy}
        </p>
      )}

      <div className="-mx-4">
        <div
          className={`relative w-full h-full overflow-hidden bg-gray-100 rounded-lg bg-[${linkedInColors.backgroundMuted}]`}
        >
          {mediaType === 'image' && (
            <ArtifactMedia
              mediaIndex={0}
              prompt={imagePrompt}
              altText={imageAlt}
              aspectRatio={aspectRatio}
              mediaType="image"
            />
          )}
          {/* Children will be used for Video player, Carousel slides, Document preview etc. */}
          {(mediaType === 'video' || mediaType === 'carousel' || mediaType === 'document') && children}
        </div>

        {mediaType === 'image' && children}
      </div>
    </div>
  );
}
