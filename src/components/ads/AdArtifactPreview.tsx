"use client";

import { cn } from "@/lib/utils";
import { Instagram, Video, Linkedin, Search, Facebook } from "lucide-react";

interface AdArtifactPreviewProps {
  name: string;
  platform: string;
  templateType: string;
  onView?: () => void;
}

const PLATFORM_CONFIG: Record<string, { icon: typeof Instagram; label: string; color: string }> = {
  instagram: { icon: Instagram, label: "Instagram", color: "text-pink-500" },
  tiktok: { icon: Video, label: "TikTok", color: "text-cyan-500" },
  linkedin: { icon: Linkedin, label: "LinkedIn", color: "text-blue-600" },
  google: { icon: Search, label: "Google", color: "text-yellow-500" },
  facebook: { icon: Facebook, label: "Facebook", color: "text-blue-500" },
};

export function AdArtifactPreview({ name, platform, templateType, onView }: AdArtifactPreviewProps) {
  const config = PLATFORM_CONFIG[platform] || PLATFORM_CONFIG.instagram;
  const PlatformIcon = config.icon;

  return (
    <button
      onClick={onView}
      className={cn(
        "flex items-center gap-3 w-full max-w-sm mt-3 p-3 rounded-lg",
        "bg-background/50 hover:bg-background border border-border/50",
        "transition-colors text-left"
      )}
    >
      <div className={cn(
        "flex items-center justify-center w-9 h-9 rounded-lg bg-muted border border-border",
        config.color
      )}>
        <PlatformIcon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{name}</p>
        <p className="text-xs text-muted-foreground">
          {config.label} &middot; {templateType.replace(/-/g, " ")}
        </p>
      </div>
    </button>
  );
}
