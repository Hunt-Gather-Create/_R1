"use client";

import React, { useState } from 'react';
import { instagramColors, instagramFonts, instagramLayout } from '../config';
import { cn } from '@/lib/utils';

interface InstagramAdCaptionProps {
  name: string;
  content: string;
  likes?: number;
  showLikes?: boolean;
  showUsername?: boolean;
  style?: React.CSSProperties;
  expanded?: boolean;
  onExpand?: (expanded: boolean) => void;
}

export function InstagramAdCaption({
  name,
  content,
  likes = 100,
  showLikes = true,
  showUsername = true,
  style,
  expanded = false,
  onExpand,
}: InstagramAdCaptionProps) {
  const [isExpanded, setIsExpanded] = useState(expanded);

  const handleExpand = () => {
    setIsExpanded(!isExpanded);
    onExpand?.(!isExpanded);
  };

  return (
    <div
      className="flex flex-col"
      style={{
        color: instagramColors.text,
        gap: instagramLayout.spacingXXSmall,
        ...style,
      }}
    >
      {showLikes && (
        <span style={{ fontSize: instagramFonts.sizes.small, fontWeight: instagramFonts.weights.semibold }}>
          {likes} like{likes === 1 ? '' : 's'}
        </span>
      )}
      <div
        className={cn(
          'relative overflow-hidden cursor-pointer',
          isExpanded && 'line-clamp-none',
          !isExpanded && 'line-clamp-2',
        )}
        onClick={handleExpand}
        style={{
          fontSize: instagramFonts.sizes.small,
          lineHeight: instagramFonts.sizes.large,
        }}
      >
        {showUsername && <span style={{ fontWeight: instagramFonts.weights.semibold }}>{name}</span>} {content}
      </div>
    </div>
  );
}
