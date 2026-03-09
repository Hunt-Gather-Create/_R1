"use client";

import { z } from "zod";
import { useArtifact } from "@/components/ads/hooks/useArtifact";
import { LinkedInCarouselAd } from "./LinkedInCarouselAd";
import { CarouselContentSchema } from "./tools";

type LinkedInCarouselContent = z.infer<typeof CarouselContentSchema>;

export const LinkedInCarouselArtifact = () => {
  const { content, name } = useArtifact();
  return (
    <LinkedInCarouselAd
      name={name}
      type="ad-template:linkedin-carousel"
      content={content as LinkedInCarouselContent}
    />
  );
};
