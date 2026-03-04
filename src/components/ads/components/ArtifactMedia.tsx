"use client";

import GeneratedImage from '@/components/ads/assets/Image';
import { useArtifactMedia } from '@/components/ads/hooks/useArtifactMedia';
import { type AspectRatio, getSizeForAspectRatio } from '@/components/ads/types/ContentData';

interface ArtifactMediaProps {
  prompt: string;
  altText: string;
  aspectRatio?: AspectRatio;
  mediaIndex?: number;
  mediaType?: 'image' | 'video';
  disableGenerate?: boolean;
}

export const ArtifactMedia = ({
  prompt,
  altText,
  aspectRatio = '1:1',
  mediaIndex = 0,
  mediaType = 'image',
  disableGenerate = false,
}: ArtifactMediaProps) => {
  const {
    mediaUrl,
    artifact,
    enableGenerate,
    addImageUrl,
    currentIndex,
    currentImageUrl,
    currentPrompt,
    isGeneratingVideo,
    isRegenerating,
  } = useArtifactMedia(mediaIndex);

  const size = getSizeForAspectRatio(aspectRatio);
  const effectivePrompt = (currentPrompt ?? prompt).trim() || prompt;

  return (
    <div className="w-full h-full">
      {mediaUrl.showVideo && (
        <div className="w-full h-full relative">
          <video
            src={mediaUrl.videoUrls[currentIndex]}
            className="w-full h-full object-cover"
            autoPlay
            muted
            loop
            controls={false}
          />
          {isRegenerating && (
            <div className="absolute inset-0 w-full h-full bg-black/50 flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
      )}
      {mediaType === 'image' && !mediaUrl.showVideo && (
        <GeneratedImage
          prompt={effectivePrompt}
          alt={altText}
          className="w-full h-full object-cover"
          data-image-type="ad-image"
          enableGenerate={enableGenerate && !disableGenerate}
          artifactId={artifact.id}
          mediaIndex={mediaIndex}
          aspectRatio={aspectRatio}
          size={size}
          imageUrl={currentImageUrl ?? undefined}
          loading={isGeneratingVideo}
          onImageGenerated={(url) => addImageUrl(url, 'main-ad-image')}
          enableRegenerate={isRegenerating}
        />
      )}
    </div>
  );
};
