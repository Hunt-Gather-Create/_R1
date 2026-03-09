import React from 'react';
import { tiktokColors } from '../config';
import { cn } from '@/lib/utils';

interface TiktokAdGradientProps {
  direction?: 'left' | 'right' | 'top' | 'bottom';
  className?: string;
  style?: React.CSSProperties;
}

export const TiktokAdGradient = ({ direction = 'top', className, style }: TiktokAdGradientProps) => {
  return (
    <div
      className={cn('absolute left-0 top-0 bottom-0 right-0 z-[1] opacity-10', className)}
      style={{
        background: `linear-gradient(to ${direction}, transparent, ${tiktokColors.black})`,
        ...style,
      }}
    />
  );
};
