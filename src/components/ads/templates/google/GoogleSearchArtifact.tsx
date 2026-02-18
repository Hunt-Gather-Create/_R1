"use client";

import { useArtifact } from "@/components/ads/hooks/useArtifact";
import GoogleSearchAd from "./GoogleSearchAd";

export const GoogleSearchArtifact = () => {
  const { content, name } = useArtifact();
  return (
    <GoogleSearchAd name={name} type="ad-template:google-search-ad" content={content} />
  );
};
