"use client";

import React from 'react';
import { useArtifactMedia } from '@/components/ads/hooks/useArtifactMedia';
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

interface ArtifactControlsAssetsDropdownProps {
  mediaIndex?: number;
}

export const ArtifactControlsAssetsDropdown = ({ mediaIndex = 0 }: ArtifactControlsAssetsDropdownProps) => {
  const { imageUrls, videoUrls, videoCount, currentIndex, showVideo, updateCurrentIndex } =
    useArtifactMedia(mediaIndex);

  return (
    <>
      <div>
        <DropdownMenuLabel className="text-sm font-medium text-primary">Images</DropdownMenuLabel>
        {imageUrls.map((url, index) => (
          <DropdownMenuItem
            onClick={() => updateCurrentIndex(index)}
            className={cn(!showVideo && index === currentIndex && 'text-primary font-bold')}
            key={url}
          >
            <img src={url} alt="Image" className="w-8 h-8 rounded" />
            Version {index + 1}
          </DropdownMenuItem>
        ))}
        {videoCount > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Videos</DropdownMenuLabel>
            {videoUrls.map((url, index) => (
              <DropdownMenuItem
                onClick={() => updateCurrentIndex(index, true)}
                className={cn(showVideo && index === currentIndex && 'text-primary font-bold')}
                key={url}
              >
                Version {index + 1}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </div>
      <DropdownMenuSeparator />
      <DropdownMenuItem>Download All</DropdownMenuItem>
    </>
  );
};
