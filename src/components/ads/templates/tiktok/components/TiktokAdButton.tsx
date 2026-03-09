import React from 'react';
import { cn } from '@/lib/utils';
import { TiktokAdIcons, ICON_NAMES } from './TiktokAdIcons';
import { tiktokAdLayout, tiktokColors, tiktokText } from '../config';

export interface TiktokAdButtonProps {
  label: string;
  className?: string;
  style?: React.CSSProperties;
  color?: string;
}

export const TiktokAdButton = ({ label, className, style, color }: TiktokAdButtonProps) => {
  return (
    <div
      className={cn('flex items-center justify-center', className)}
      style={{
        gap: tiktokAdLayout.spacing.s,
        backgroundColor: color || tiktokColors.black,
        borderRadius: tiktokAdLayout.spacing.xs / 2,
        height: tiktokAdLayout.button.height,
        fontSize: tiktokText.fontSize.sm,
        letterSpacing: tiktokText.spacing.sm,
        fontWeight: tiktokText.fontWeight.medium,
        ...style,
      }}
    >
      {label}
      <TiktokAdIcons name={ICON_NAMES.CHEVRON_RIGHT} width={20} height={20} />
    </div>
  );
};
