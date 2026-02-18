"use client";

import { useArtifact } from "@/components/ads/hooks/useArtifact";
import { LinkedInCarouselAd } from "./LinkedInCarouselAd";

export const LinkedInCarouselArtifact = () => {
  const { content, name } = useArtifact();
  return (
    <LinkedInCarouselAd name={name} type="ad-template:linkedin-carousel" content={content} />
  );
};
