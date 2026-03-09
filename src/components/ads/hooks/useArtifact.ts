import { useArtifactContext } from '../context/ArtifactProvider';
import { resolveProfileMediaInContent } from '@/lib/ads/profile-media';

/**
 * Hook to access basic artifact information.
 * Content has profile/company image resolved from media slot 0 when the URL is empty and slot 0 has a generated image.
 */
export const useArtifact = () => {
  const { artifact, name, mediaUrls, localContent } = useArtifactContext();

  const rawContent = localContent ?? artifact.content;
  let parsed: unknown = rawContent;
  if (typeof rawContent === "string") {
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      parsed = rawContent;
    }
  }
  const content =
    typeof parsed === "object" && parsed !== null
      ? resolveProfileMediaInContent(parsed, mediaUrls)
      : rawContent;

  const imageCount = mediaUrls.reduce((acc, mediaUrl) => acc + (mediaUrl?.imageUrls?.length ?? 0), 0);
  const videoCount = mediaUrls.reduce((acc, mediaUrl) => acc + (mediaUrl?.videoUrls?.length ?? 0), 0);
  const mediaCount = mediaUrls.length;

  return {
    artifact,
    name,
    id: artifact.id,
    type: artifact.type,
    format: artifact.format,
    content,
    mediaCount,
    imageCount,
    videoCount,
  };
};
