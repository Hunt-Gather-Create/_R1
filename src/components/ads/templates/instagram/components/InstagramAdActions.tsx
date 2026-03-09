import React from 'react';
import { InstagramAdIcon } from './InstagramAdIcon';
import { instagramColors, instagramFonts, instagramLayout } from '../config';

interface InstagramAdActionsProps {
  likes?: number;
  comments?: number;
  showNumbers?: boolean;
  showLikes?: boolean;
  showComments?: boolean;
  showShare?: boolean;
  className?: string;
  style?: React.CSSProperties;
  color?: string;
  size?: number;
}

export function InstagramAdActions({
  className,
  style,
  likes = 15,
  comments = 34,
  showNumbers = false,
  showLikes = true,
  showComments = true,
  showShare = true,
  color = instagramColors.text,
  size = 42,
}: InstagramAdActionsProps) {
  return (
    <div
      className={className}
      style={{ display: 'flex', alignItems: 'center', gap: instagramLayout.spacing, color, ...style }}
    >
      {showLikes && (
        <div className="flex flex-col items-center justify-center" style={{ gap: instagramLayout.spacingSmall }}>
          <InstagramAdIcon name="heart" color={color} width={size} height={size} />
          {showNumbers && <span style={{ fontSize: instagramFonts.sizes.xsmall }}>{likes}</span>}
        </div>
      )}
      {showComments && (
        <div className="flex flex-col items-center justify-center " style={{ gap: instagramLayout.spacingMedium }}>
          <InstagramAdIcon name="comment" color={color} width={size * (36 / 46)} height={size * (36 / 46)} />
          {showNumbers && <span style={{ fontSize: instagramFonts.sizes.xsmall }}>{comments}</span>}
        </div>
      )}
      {showShare && (
        <div className="flex flex-col items-center" style={{ gap: instagramLayout.spacingSmall }}>
          <InstagramAdIcon name="share" color={color} width={size * (36 / 46)} height={size * (36 / 46)} />
        </div>
      )}
    </div>
  );
}
