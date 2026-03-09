import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { instagramColors, instagramLayout } from '../config';
import { cn } from '@/lib/utils';

interface InstagramAdCardProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function InstagramAdCard({ children, className, style }: InstagramAdCardProps) {
  return (
    <Card
      className={cn('w-full m-auto', className)}
      style={{
        maxWidth: instagramLayout.maxWidth,
        borderRadius: instagramLayout.borderRadius,
        backgroundColor: instagramColors.background,
        border: `1px solid ${instagramColors.border}`,
        ...style,
      }}
    >
      <CardContent style={{ padding: 0 }}>{children}</CardContent>
    </Card>
  );
}
