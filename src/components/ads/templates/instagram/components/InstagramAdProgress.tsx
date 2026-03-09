"use client";

import React, { useEffect, useState } from 'react';
import { instagramColors } from '../config';
import { cn } from '@/lib/utils';

interface InstagramAdProgressProps {
  duration?: number; // Duration in milliseconds
  onComplete?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

export const InstagramAdProgress: React.FC<InstagramAdProgressProps> = ({
  duration = 5000,
  onComplete,
  className,
  style,
}) => {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const newProgress = Math.min((elapsed / duration) * 100, 100);

      setProgress(newProgress);

      if (newProgress >= 100) {
        clearInterval(interval);
        onComplete?.();
      }
    }, 10);

    return () => clearInterval(interval);
  }, [duration, onComplete]);

  return (
    <div
      className={cn('w-full h-[2px] rounded-full overflow-hidden', className)}
      style={{ backgroundColor: instagramColors.backgroundCTA, ...style }}
    >
      <div
        className="h-full rounded-full"
        style={{
          width: `${progress}%`,
          backgroundColor: instagramColors.background,
          transition: 'width 0.1s linear',
        }}
      />
    </div>
  );
};
