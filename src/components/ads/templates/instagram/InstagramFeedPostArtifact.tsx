"use client";

import dayjs from "dayjs";
import { useArtifact } from "@/components/ads/hooks/useArtifact";
import { InstagramFeedPost } from "./InstagramFeedPost";
import type { InstagramAdFeedPost } from "./types";
import { DataPoint } from "@/components/data-point";

export const InstagramFeedPostArtifact = () => {
  const { content, artifact } = useArtifact();
  return (
    <InstagramFeedPost
      content={content as InstagramAdFeedPost}
      artifactId={artifact?.id}
    />
  );
};

type ArtifactWithFeedPostContent = { created_at?: string; content: InstagramAdFeedPost };

export const InstagramFeedPostArtifactData = () => {
  const { artifact } = useArtifact();
  const a = artifact as unknown as ArtifactWithFeedPostContent;
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
