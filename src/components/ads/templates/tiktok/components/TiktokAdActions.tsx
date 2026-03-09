import React from 'react';
import { TiktokAdIcons } from './TiktokAdIcons';
import { TiktokAdProfile, type TiktokAdProfileProps } from './TiktokAdProfile';
import { tiktokAdLayout, tiktokColors, tiktokGradients, tiktokText } from '../config';
import { cn } from '@/lib/utils';

interface TiktokAdActionsProps {
  className?: string;
  style?: React.CSSProperties;
  profile: TiktokAdProfileProps;
  likes: number;
}

export const TiktokAdActions = ({ profile, likes = 15, className, style = {} }: TiktokAdActionsProps) => {
  return (
    <div
      className={cn('flex flex-col items-center', className)}
      style={{
        paddingRight: tiktokAdLayout.spacing.g,
        paddingBottom: tiktokAdLayout.spacing.g,
        gap: tiktokAdLayout.spacing.xxl,
        ...style,
      }}
    >
      <TiktokAdProfile {...profile} />
      <div className="flex flex-col items-center justify-center gap-2">
        <TiktokAdIcons name="heart" />
        <span
          style={{
            fontSize: tiktokText.fontSize.md,
            textShadow: tiktokText.shadow,
          }}
        >
          {likes}
        </span>
      </div>
      <TiktokAdIcons name="comment" width={40} height={40} />
      <TiktokAdIcons name="share" width={36} height={36} />
      <div
        className="flex items-center gap-2 rounded-full"
        style={{
          background: tiktokGradients.conicGradient,
          width: tiktokAdLayout.musicDisk.width,
          height: tiktokAdLayout.musicDisk.height,
          padding: tiktokAdLayout.musicDisk.spacing,
        }}
      >
        <div className="w-full h-full rounded-full opacity-80" style={{ background: tiktokColors.black }} />
      </div>
    </div>
  );
};
