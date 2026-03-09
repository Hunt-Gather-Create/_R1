import React, { type CSSProperties, type PropsWithChildren } from 'react';
import { cn } from '@/lib/utils';
import { googleAdColors, googleAdFonts, googleAdLayout } from '../config';

interface GoogleAdCardProps extends PropsWithChildren {
  style?: CSSProperties;
  className?: string;
}

export default function GoogleAdCard({ style = {}, className = '', children }: GoogleAdCardProps) {
  return (
    <div
      style={{
        ...style,
        backgroundColor: googleAdColors.white,
        borderColor: googleAdColors.border,
        borderRadius: googleAdLayout.spacing.md,
        padding: googleAdLayout.spacing.lg,
        fontFamily: googleAdFonts.fontFamily,
        fontSize: googleAdFonts.fontSizes.md,
        fontWeight: googleAdFonts.fontWeights.normal,
        color: googleAdColors.black,
      }}
      className={cn('w-full border', className)}
    >
      {children}
    </div>
  );
}
