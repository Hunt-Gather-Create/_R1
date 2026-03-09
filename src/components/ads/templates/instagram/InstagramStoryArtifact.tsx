"use client";

import React from "react";
import { useArtifact } from "@/components/ads/hooks/useArtifact";
import { InstagramStory } from "./InstagramStory";
import type { InstagramAdStory } from "./types";
import { DataPoint } from "@/components/data-point";
import dayjs from "dayjs";

export const InstagramStoryArtifact = () => {
  const { content, artifact } = useArtifact();
  return (
    <InstagramStory
      content={content as InstagramAdStory}
      artifactId={artifact?.id}
    />
  );
};

type ArtifactWithStoryContent = { created_at?: string; content: InstagramAdStory };

export const InstagramStoryArtifactData = () => {
  const { artifact } = useArtifact();
  const a = artifact as unknown as ArtifactWithStoryContent;
  return (
    <div className="space-y-4">
      <DataPoint
        label="Created on"
        value={dayjs(a.created_at).format("MMM D, YYYY [at] h:mm A")}
      />
      <DataPoint label="CTA" value={a.content.cta.text} />
    </div>
  );
};
