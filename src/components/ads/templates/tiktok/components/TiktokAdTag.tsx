import React from 'react';
import { cn } from '@/lib/utils';
import { tiktokAdLayout, tiktokColors, tiktokText } from '../config';

interface TiktokAdTagProps {
  className?: string;
  style?: React.CSSProperties;
  label?: string;
}

export const TiktokAdTag = ({ className, style, label = 'Sponsored' }: TiktokAdTagProps) => {
  return (
    <div
      className={cn('w-fit', className)}
      style={{
        fontSize: tiktokText.fontSize.xxs,
        padding: tiktokAdLayout.spacing.xs / 2,
        paddingLeft: tiktokAdLayout.spacing.sm,
        paddingRight: tiktokAdLayout.spacing.sm,
        backgroundColor: tiktokColors.backgroundGray,
        borderRadius: tiktokAdLayout.spacing.xs,
        fontWeight: tiktokText.fontWeight.medium,
        letterSpacing: tiktokText.spacing.sm,
        ...style,
      }}
    >
      {label}
    </div>
  );
};
