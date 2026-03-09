"use client";

import { useArtifact } from "@/components/ads/hooks/useArtifact";
import {
  LinkedInSingleImageAd,
  LinkedInSingleImageAdSchema,
} from "./LinkedInSingleImageAd";
import { z } from "zod";

type LinkedInSingleImageContent = z.infer<
  (typeof LinkedInSingleImageAdSchema)["inputSchema"]
>["content"];

export const LinkedInSingleImageArtifact = () => {
  const { content, name } = useArtifact();
  return (
    <LinkedInSingleImageAd
      name={name}
      type="ad-template:linkedin-single-image"
      content={content as LinkedInSingleImageContent}
    />
  );
};
