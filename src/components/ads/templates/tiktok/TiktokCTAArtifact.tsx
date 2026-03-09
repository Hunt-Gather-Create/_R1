"use client";

import { useArtifact } from "@/components/ads/hooks/useArtifact";
import { TiktokAdCTA } from "./TiktokAdCTA";
import type { TiktokAdContent } from "./types";

export const TiktokCTAArtifact = () => {
  const { content, artifact } = useArtifact();
  return (
    <TiktokAdCTA
      content={content as TiktokAdContent}
      artifactId={artifact?.id}
    />
  );
};
