import React from 'react';
import {
  Heart,
  MessageCircle,
  Share2,
  Home,
  Search,
  Mail,
  User,
  Music,
  ChevronRight,
  X,
} from 'lucide-react';
import { tiktokColors } from '../config';

interface IconProps {
  color?: string;
  width?: number;
  height?: number;
}

export const ICON_NAMES = {
  HEART: 'heart',
  COMMENT: 'comment',
  SHARE: 'share',
  HOME: 'home',
  SEARCH: 'search',
  INBOX: 'inbox',
  USER: 'user',
  MUSIC: 'music',
  CHEVRON_RIGHT: 'chevron-right',
  CLOSE: 'close',
} as const;

const ICON_COMPONENTS = {
  [ICON_NAMES.HEART]: Heart,
  [ICON_NAMES.COMMENT]: MessageCircle,
  [ICON_NAMES.SHARE]: Share2,
  [ICON_NAMES.HOME]: Home,
  [ICON_NAMES.SEARCH]: Search,
  [ICON_NAMES.INBOX]: Mail,
  [ICON_NAMES.USER]: User,
  [ICON_NAMES.MUSIC]: Music,
  [ICON_NAMES.CHEVRON_RIGHT]: ChevronRight,
  [ICON_NAMES.CLOSE]: X,
} as const;

export function TiktokAdIcons({
  name,
  color = tiktokColors.text,
  width = 44,
  height = 44,
}: { name: keyof typeof ICON_COMPONENTS } & IconProps) {
  const IconComponent = ICON_COMPONENTS[name];
  if (!IconComponent) return null;

  return <IconComponent width={width} height={height} style={{ color }} />;
}
