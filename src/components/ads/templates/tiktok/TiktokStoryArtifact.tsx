"use client";

import { useArtifact } from "@/components/ads/hooks/useArtifact";
import { TiktokAdStory } from "./TiktokAdStory";
import type { TiktokAdContent } from "./types";

export const TiktokStoryArtifact = () => {
  const { content, artifact } = useArtifact();
  return (
    <TiktokAdStory
      content={content as TiktokAdContent}
      artifactId={artifact?.id}
    />
  );
};
