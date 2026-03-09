import React from 'react';
import { TiktokAdCTAEnum } from '../types';
import { TiktokAdTag } from './TiktokAdTag';
import { TiktokAdButton } from './TiktokAdButton';
import { ArtifactMedia } from '@/components/ads/components/ArtifactMedia';
import { cn } from '@/lib/utils';
import { tiktokAdLayout, tiktokColors, tiktokText } from '../config';
import { ICON_NAMES, TiktokAdIcons } from './TiktokAdIcons';

interface TiktokAdFooterCTAProps {
  cta: { text: TiktokAdCTAEnum; url?: string; color?: string };
  ctaImage: { prompt: string; altText: string };
  caption: string;
  username: string;
  className?: string;
  style?: React.CSSProperties;
}

export const TiktokAdFooterCTA = ({ cta, ctaImage, caption, username, className, style }: TiktokAdFooterCTAProps) => {
  return (
    <div
      className={cn('flex flex-col', className)}
      style={{
        padding: tiktokAdLayout.spacing.lg,
        paddingRight: tiktokAdLayout.spacing.xxl,
        gap: tiktokAdLayout.spacing.md,
        ...style,
      }}
    >
      <TiktokAdTag />
      <div
        className="flex flex-col items-center justify-center overflow-hidden"
        style={{ borderRadius: tiktokAdLayout.spacing.xxs }}
      >
        <div
          className="flex w-full relative"
          style={{
            backgroundColor: tiktokColors.ctaBackground,
            padding: tiktokAdLayout.spacing.s,
            gap: tiktokAdLayout.spacing.md,
            paddingRight: tiktokAdLayout.spacing.xxl,
          }}
        >
          <div className="absolute top-2 right-2 opacity-50">
            <TiktokAdIcons name={ICON_NAMES.CLOSE} width={16} height={16} />
          </div>
          <div
            className="overflow-hidden flex-shrink-0"
            style={{
              width: tiktokAdLayout.ctaImage.width,
              height: tiktokAdLayout.ctaImage.height,
              borderRadius: tiktokAdLayout.spacing.xxs,
            }}
          >
            <ArtifactMedia prompt={ctaImage.prompt} altText={ctaImage.altText} aspectRatio="1:1" mediaIndex={1} />
          </div>
          <div className="flex flex-col">
            <span
              style={{
                fontSize: tiktokText.fontSize.sm,
                fontWeight: tiktokText.fontWeight.medium,
                color: tiktokColors.text,
              }}
            >
              {username}
            </span>
            <span
              className="line-clamp-2"
              style={{
                fontSize: tiktokText.fontSize.xs,
                fontWeight: tiktokText.fontWeight.normal,
                color: tiktokColors.text,
              }}
            >
              {caption}
            </span>
          </div>
        </div>
        <TiktokAdButton label={cta.text} color={cta.color} className="w-full" style={{ borderRadius: 0 }} />
      </div>
    </div>
  );
};
