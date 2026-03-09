import React from 'react';
import { tiktokAdLayout, tiktokColors, tiktokText } from '../config';
import { cn } from '@/lib/utils';

export interface TiktokAdHeaderProps {
  className?: string;
  style?: React.CSSProperties;
}

export const TiktokAdHeader = ({ className, style }: TiktokAdHeaderProps) => {
  return (
    <div
      className={cn('flex items-center justify-center', className)}
      style={{
        gap: tiktokAdLayout.spacing.xxl,
        fontSize: tiktokText.fontSize.md,
        paddingTop: tiktokAdLayout.spacing.l,
        ...style,
      }}
    >
      <div className="opacity-60" style={{ fontWeight: tiktokText.fontWeight.normal }}>
        Following
      </div>
      <div className="flex items-center relative" style={{ fontWeight: tiktokText.fontWeight.bold }}>
        For You
        <div
          className="w-6/12 h-1 rounded-full absolute left-1/2 -translate-x-1/2"
          style={{
            bottom: -tiktokAdLayout.spacing.sm,
            backgroundColor: tiktokColors.background,
          }}
        />
      </div>
    </div>
  );
};
