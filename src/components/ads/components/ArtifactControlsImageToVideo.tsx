"use client";

import React from 'react';
import { useArtifact } from '@/components/ads/hooks/useArtifact';
import { useArtifactMedia } from '@/components/ads/hooks/useArtifactMedia';
import { Button } from '@/components/ui/button';
import { Video } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** Matches attach/close in side panel header */
const compactTriggerClass =
  "p-1.5 rounded-md hover:bg-muted transition-colors disabled:opacity-50 disabled:pointer-events-none";

const ArtifactControlsImageToVideoComponent = ({
  mediaIndex = 0,
  type = 'button',
  compact = false,
}: {
  mediaIndex?: number;
  type?: 'button' | 'dropdown';
  compact?: boolean;
}) => {
  const { imageToVideo, isGeneratingVideo, imageUrls, showVideo, currentIndex, currentImageUrl } =
    useArtifactMedia(mediaIndex);

  if (type === 'button') {
    if (compact) {
      return (
        <button
          type="button"
          onClick={imageToVideo}
          disabled={isGeneratingVideo}
          title="Convert Image to Video"
          className={compactTriggerClass}
        >
          <Video className="w-4 h-4 text-muted-foreground" />
        </button>
      );
    }
    return (
      <Button
        variant="ghost"
        size="icon"
        onClick={imageToVideo}
        disabled={isGeneratingVideo}
        title="Convert Image to Video"
      >
        <Video className="w-4 h-4" />
      </Button>
    );
  }
  const image = showVideo ? currentImageUrl : imageUrls?.[currentIndex] ?? null;
  return (
    <DropdownMenuItem onClick={imageToVideo} disabled={isGeneratingVideo}>
      {image && <img src={image} alt="Image" className="w-8 h-8 rounded" />}
      <span className="text-sm truncate font-medium">Slide #{mediaIndex + 1}</span>
    </DropdownMenuItem>
  );
};

export const ArtifactControlsImageToVideo = ({ compact = false }: { compact?: boolean }) => {
  const { mediaCount } = useArtifact();

  if (mediaCount === 1) return <ArtifactControlsImageToVideoComponent compact={compact} />;
  if (mediaCount > 1) {
    const trigger = compact ? (
      <button type="button" title="Convert Image to Video" className={compactTriggerClass}>
        <Video className="w-4 h-4 text-muted-foreground" />
      </button>
    ) : (
      <Button variant="ghost" size="icon" title="Convert Image to Video">
        <Video className="w-4 h-4" />
      </Button>
    );
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {trigger}
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56" align="start">
          {Array.from({ length: mediaCount }).map((_, mediaIndex) => (
            <ArtifactControlsImageToVideoComponent mediaIndex={mediaIndex} type="dropdown" key={mediaIndex} />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return null;
};
