import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { linkedInColors, linkedInLayout, linkedInFonts } from '../config';

interface LinkedInAdCardProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export default function LinkedInAdCard({
  children,
  className,
  style,
}: LinkedInAdCardProps) {
  return (
    <Card
      className={className}
      style={{
        maxWidth: linkedInLayout.maxWidth,
        margin: 'auto',
        backgroundColor: linkedInColors.backgroundLight,
        color: linkedInColors.textPrimary,
        fontFamily: linkedInFonts.primary,
        borderRadius: linkedInLayout.borderRadius, // Ensure card itself has the border radius
        ...style,
      }}
    >
      <CardContent
        style={{
            padding: linkedInLayout.cardPadding,
        }}
      >
        {children}
      </CardContent>
    </Card>
  );
}
