import { useArtifactContext } from '../context/ArtifactProvider';

/**
 * Hook to access artifact control actions
 */
export const useArtifactActions = () => {
  const { save, regenerate, imageToVideo, isSaving, isGeneratingVideo, getArtifactSaveData, downloadMediaAssets, isDownloading } = useArtifactContext();

  return {
    // Actions
    save,
    regenerate,
    imageToVideo,
    downloadMediaAssets,

    // Loading states
    isSaving,
    isGeneratingVideo,
    isLoading: isSaving || isGeneratingVideo,
    isDownloading,

    // Data access
    getArtifactSaveData,
  };
};
