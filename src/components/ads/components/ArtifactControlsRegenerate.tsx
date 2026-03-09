"use client";

import React from 'react';
import { useArtifact } from '@/components/ads/hooks/useArtifact';
import { useArtifactMedia } from '@/components/ads/hooks/useArtifactMedia';
import { Button } from '@/components/ui/button';
import { RefreshCcw } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** Matches attach/close in side panel header */
const compactTriggerClass =
  "p-1.5 rounded-md hover:bg-muted transition-colors disabled:opacity-50 disabled:pointer-events-none";

const ArtifactControlsRegenerateComponent = ({
  mediaIndex = 0,
  type = 'button',
  compact = false,
}: {
  mediaIndex?: number;
  type?: 'button' | 'dropdown';
  compact?: boolean;
}) => {
  const { regenerate, isRegenerating, imageUrls, showVideo, currentIndex, currentImageUrl } =
    useArtifactMedia(mediaIndex);

  if (type === 'button') {
    if (compact) {
      return (
        <button
          type="button"
          onClick={regenerate}
          disabled={isRegenerating}
          title="Regenerate"
          className={compactTriggerClass}
        >
          <RefreshCcw className="w-4 h-4 text-muted-foreground" />
        </button>
      );
    }
    return (
      <Button variant="ghost" size="icon" onClick={regenerate} disabled={isRegenerating} title="Regenerate">
        <RefreshCcw className="w-4 h-4" />
      </Button>
    );
  }

  const image = showVideo ? currentImageUrl : imageUrls?.[currentIndex] ?? null;
  return (
    <DropdownMenuItem onClick={regenerate} disabled={isRegenerating}>
      {image && <img src={image} alt="Image" className="w-8 h-8 rounded" />}
      <span className="text-sm truncate font-medium">Slide #{mediaIndex + 1}</span>
    </DropdownMenuItem>
  );
};

export const ArtifactControlsRegenerate = ({ compact = false }: { compact?: boolean }) => {
  const { mediaCount } = useArtifact();

  if (mediaCount === 1) return <ArtifactControlsRegenerateComponent compact={compact} />;
  if (mediaCount > 1) {
    const trigger = compact ? (
      <button type="button" title="Regenerate" className={compactTriggerClass}>
        <RefreshCcw className="w-4 h-4 text-muted-foreground" />
      </button>
    ) : (
      <Button variant="ghost" size="icon" title="Regenerate">
        <RefreshCcw className="w-4 h-4" />
      </Button>
    );
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {trigger}
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56" align="start">
          {Array.from({ length: mediaCount }).map((_, mediaIndex) => (
            <ArtifactControlsRegenerateComponent mediaIndex={mediaIndex} type="dropdown" key={mediaIndex} />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return null;
};
