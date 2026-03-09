import React from 'react';
import { cn } from '@/lib/utils';
import { tiktokAdLayout, tiktokText } from '../config';
import { TiktokAdTag } from './TiktokAdTag';
import { ICON_NAMES, TiktokAdIcons } from './TiktokAdIcons';
import { TiktokAdButton } from './TiktokAdButton';
import type { TiktokAdCTAEnum } from '../types';

export interface TiktokAdFooterProps {
  username: string;
  caption: string;
  soundName: string;
  soundAuthor: string;
  cta: { text: TiktokAdCTAEnum; url?: string; color?: string };
  className?: string;
  style?: React.CSSProperties;
}

export const TiktokAdFooter = ({
  username,
  caption,
  soundName,
  soundAuthor,
  cta,
  className,
  style,
}: TiktokAdFooterProps) => {
  return (
    <div
      className={cn('flex flex-col', className)}
      style={{
        padding: tiktokAdLayout.spacing.lg,
        paddingRight: tiktokAdLayout.spacing.xxl,
        ...style,
      }}
    >
      <span
        style={{
          fontSize: tiktokText.fontSize.md,
          fontWeight: tiktokText.fontWeight.bold,
          letterSpacing: tiktokText.spacing.sm,
        }}
      >
        {username}
      </span>
      <p
        className="line-clamp-2"
        style={{
          fontSize: tiktokText.fontSize.sm,
          letterSpacing: tiktokText.spacing.md,
        }}
      >
        {caption}
      </p>
      <TiktokAdTag style={{ marginTop: tiktokAdLayout.spacing.s }} />
      <div
        className="flex items-center"
        style={{ gap: tiktokAdLayout.spacing.md, marginTop: tiktokAdLayout.spacing.s }}
      >
        <TiktokAdIcons name={ICON_NAMES.MUSIC} width={18} height={18} />
        <span style={{ fontSize: tiktokText.fontSize.sm, letterSpacing: tiktokText.spacing.sm }}>
          {soundName} - @{soundAuthor}
        </span>
      </div>

      <TiktokAdButton label={cta.text} color={cta.color} style={{ marginTop: tiktokAdLayout.spacing.s }} />
    </div>
  );
};
