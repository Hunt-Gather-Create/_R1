import React from 'react';
import {
  MoreHorizontal,
  Send,
  Heart,
  MessageCircle,
  Bookmark,
  ChevronRight,
  X,
  ChevronUp,
} from 'lucide-react';
import { instagramColors } from '../config';

interface IconProps {
  color?: string;
  width?: number;
  height?: number;
}

const ICON_COMPONENTS = {
  meatball: MoreHorizontal,
  share: Send,
  heart: Heart,
  comment: MessageCircle,
  ribbon: Bookmark,
  chevron: ChevronRight,
  close: X,
  'chevron-up': ChevronUp,
} as const;

export function InstagramAdIcon({
  name,
  color = instagramColors.text,
  width = 24,
  height = 24,
}: { name: keyof typeof ICON_COMPONENTS } & IconProps) {
  const IconComponent = ICON_COMPONENTS[name];
  if (!IconComponent) return null;

  return <IconComponent width={width} height={height} style={{ color }} />;
}
