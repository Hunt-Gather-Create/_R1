import React from 'react';
import { instagramColors } from '../config';
import { cn } from '@/lib/utils';

interface InstagramAdGradientProps {
  direction?: 'left' | 'right' | 'top' | 'bottom';
  className?: string;
  style?: React.CSSProperties;
}

export const InstagramAdGradient = ({ direction = 'left', className, style }: InstagramAdGradientProps) => {
  return (
    <div
      className={cn('absolute left-0 top-0 bottom-0 right-0 z-[1] opacity-10', className)}
      style={{
        background: `linear-gradient(to ${direction}, transparent, ${instagramColors.backgroundDark})`,
        ...style,
      }}
    />
  );
};
