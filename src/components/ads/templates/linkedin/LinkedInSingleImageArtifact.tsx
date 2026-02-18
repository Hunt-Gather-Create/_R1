"use client";

import { useArtifact } from "@/components/ads/hooks/useArtifact";
import { LinkedInSingleImageAd } from "./LinkedInSingleImageAd";

export const LinkedInSingleImageArtifact = () => {
  const { content, name } = useArtifact();
  return (
    <LinkedInSingleImageAd name={name} type="ad-template:linkedin-single-image" content={content} />
  );
};
