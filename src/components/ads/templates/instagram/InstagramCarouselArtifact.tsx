"use client";

import React from "react";
import { useArtifact } from "@/components/ads/hooks/useArtifact";
import { InstagramCarousel } from "./InstagramCarousel";
import type { InstagramAdCarousel } from "./types";
import { DataPoint } from "@/components/data-point";
import dayjs from "dayjs";

export const InstagramCarouselArtifact = () => {
  const { content, id } = useArtifact();
  return (
    <InstagramCarousel
      content={content as InstagramAdCarousel}
      enableGenerate={false}
      artifactId={id!}
    />
  );
};

type ArtifactWithCarouselContent = { created_at?: string; content: InstagramAdCarousel };

export const InstagramCarouselArtifactData = () => {
  const { artifact } = useArtifact();
  const a = artifact as unknown as ArtifactWithCarouselContent;
  return (
    <div className="space-y-4">
      <DataPoint
        label="Created on"
        value={dayjs(a.created_at).format("MMM D, YYYY [at] h:mm A")}
      />
      <DataPoint label="Caption" value={a.content.caption} copyable />
      <DataPoint label="CTA" value={a.content.cta.text} />
    </div>
  );
};
