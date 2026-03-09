import { defaultMediaUrl, useArtifactContext } from '../context/ArtifactProvider';

/**
 * Hook to access media-related functionality
 */
export const useArtifactMedia = (mediaIndex: number = 0) => {
  const {
    artifact,
    mediaUrls,
    enableGenerate,
    isGeneratingVideo,
    isRegenerating,
    isSaving,
    addImageUrl,
    addVideoUrl,
    removeImageUrl,
    removeVideoUrl,
    clearAllUrls,
    getUrlContext,
    imageToVideo,
    regenerate,
    updateMediaUrl,
  } = useArtifactContext();

  const mediaUrl = mediaUrls[mediaIndex] || { ...defaultMediaUrl };

  const updateCurrentIndex = (index: number, showVideo: boolean = false) => {
    const newMediaUrl = { ...mediaUrl, currentIndex: index, showVideo };
    if (!showVideo) newMediaUrl.currentImageUrl = mediaUrl.imageUrls[index];
    updateMediaUrl(mediaIndex)(newMediaUrl);
  };

  return {
    // Artifact
    artifact,
    enableGenerate,

    // Media state
    mediaUrl,
    hasMediaUrls: mediaUrl.imageUrls.length > 0 || mediaUrl.videoUrls.length > 0,
    imageUrls: mediaUrl.imageUrls,
    videoUrls: mediaUrl.videoUrls,
    currentImageUrl: mediaUrl.currentImageUrl,
    currentPrompt: mediaUrl.currentPrompt,
    showVideo: mediaUrl.showVideo,
    generatedAt: mediaUrl.generatedAt,
    currentIndex: mediaUrl.showVideo ? Math.min(mediaUrl.videoUrls.length - 1, mediaUrl.currentIndex) : Math.min(mediaUrl.imageUrls.length - 1, mediaUrl.currentIndex),

    // Media actions
    addImageUrl: addImageUrl(mediaIndex),
    addVideoUrl: addVideoUrl(mediaIndex),
    removeImageUrl: removeImageUrl(mediaIndex),
    removeVideoUrl: removeVideoUrl(mediaIndex),
    clearAllUrls: clearAllUrls(mediaIndex),
    getUrlContext: getUrlContext(mediaIndex),
    imageToVideo: imageToVideo(mediaIndex),
    regenerate: regenerate(mediaIndex),
    updateCurrentIndex,

    // Computed values
    totalMediaCount: mediaUrl.imageUrls.length + mediaUrl.videoUrls.length,
    imageCount: mediaUrl.imageUrls.length,
    videoCount: mediaUrl.videoUrls.length,

    // Loading states
    isGeneratingVideo: typeof isGeneratingVideo === 'number' && isGeneratingVideo === mediaIndex,
    isRegenerating: typeof isRegenerating === 'number' && isRegenerating === mediaIndex,
    isSaving: isSaving,
  };
};
