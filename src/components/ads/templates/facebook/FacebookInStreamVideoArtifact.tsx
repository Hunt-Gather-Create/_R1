"use client";

import { useArtifact } from "@/components/ads/hooks/useArtifact";
import FacebookInStreamVideo, {
  type FacebookInStreamVideoToolProps,
} from "./FacebookInStreamVideo";

export const FacebookInStreamVideoArtifact = () => {
  const { content } = useArtifact();
  return (
    <FacebookInStreamVideo
      content={content as FacebookInStreamVideoToolProps["content"]}
    />
  );
};
