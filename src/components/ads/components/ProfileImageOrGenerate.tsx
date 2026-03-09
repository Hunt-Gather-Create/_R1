"use client";

import React from "react";
import GeneratedImage from "@/components/ads/assets/Image";
import { RetryImage } from "@/components/ads/components/RetryImage";
import { useArtifactMedia } from "@/components/ads/hooks/useArtifactMedia";
import { PROFILE_MEDIA_SLOT_INDEX } from "@/lib/ads/profile-media";

const DEFAULT_PROFILE_PROMPT =
  "Professional minimalist company logo icon, simple and modern, suitable for social media profile picture, neutral background";

interface ProfileImageOrGenerateProps {
  imageUrl: string | null | undefined;
  imagePrompt?: string | null;
  alt: string;
  artifactId: string | undefined;
  className?: string;
  style?: React.CSSProperties;
  imageBackgroundColor?: string | null;
}

/**
 * Renders profile image: shows URL when present, or generates on render when imagePrompt is set and URL is empty.
 * Uses media slot 0 (profile slot) for the generated image.
 */
export function ProfileImageOrGenerate({
  imageUrl,
  imagePrompt,
  alt,
  artifactId,
  className,
  style,
  imageBackgroundColor,
}: ProfileImageOrGenerateProps) {
  const { currentImageUrl, addImageUrl, enableGenerate } = useArtifactMedia(PROFILE_MEDIA_SLOT_INDEX);
  const resolvedUrl = imageUrl?.trim() || currentImageUrl;
  const prompt = (imagePrompt?.trim() || DEFAULT_PROFILE_PROMPT).trim();
  const shouldGenerate = !resolvedUrl && !!prompt && !!artifactId && enableGenerate;

  if (resolvedUrl) {
    return (
      <RetryImage
        src={resolvedUrl}
        alt={alt}
        className={className}
        style={{
          ...style,
          backgroundColor: imageBackgroundColor ?? undefined,
          objectFit: "contain",
        }}
      />
    );
  }

  if (shouldGenerate) {
    return (
      <div className={className} style={{ ...style, overflow: "hidden", borderRadius: "50%" }}>
        <GeneratedImage
          prompt={prompt}
          alt={alt}
          aspectRatio="1:1"
          artifactId={artifactId}
          mediaIndex={PROFILE_MEDIA_SLOT_INDEX}
          imageUrl={currentImageUrl ?? undefined}
          enableGenerate={true}
          onImageGenerated={(url) => addImageUrl(url, "profile")}
        />
      </div>
    );
  }

  return (
    <div
      role="img"
      aria-label={alt}
      className={className}
      style={{
        ...style,
        backgroundColor: imageBackgroundColor ?? "var(--muted, #e5e7eb)",
      }}
    />
  );
}
