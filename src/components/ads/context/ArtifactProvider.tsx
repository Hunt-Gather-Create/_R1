"use client";

import React, { createContext, useContext, useCallback, useState, useRef, useEffect } from 'react';
import type { Artifact, ArtifactMediaUrls, ArtifactSaveData, MediaTrackingCallbacks } from '../types/ArtifactData';
import { ArtifactSaveService } from '../services/ArtifactSaveService';
import { getExtensionFromUrl, sanitizeFileName } from '../utils';

// Context Types
export interface ArtifactContextValue {
  // Artifact data
  artifact: Artifact;
  name: string;

  // Media state
  mediaUrls: ArtifactMediaUrls[];
  enableGenerate: boolean;

  // Media actions
  addImageUrl: (mediaIndex: number) => (url: string, context?: string) => void;
  addVideoUrl: (mediaIndex: number) => (url: string, context?: string) => void;
  removeImageUrl: (mediaIndex: number) => (url: string) => void;
  removeVideoUrl: (mediaIndex: number) => (url: string) => void;
  clearAllUrls: (mediaIndex: number) => () => void;
  getUrlContext: (mediaIndex: number) => (url: string) => string | undefined;
  updateMediaUrl: (mediaIndex: number) => (mediaUrl: ArtifactMediaUrls) => void;
  downloadMediaAssets: () => Promise<void>;

  // Control actions
  save: () => Promise<void>;
  regenerate: (mediaIndex: number) => () => void;
  imageToVideo: (mediaIndex: number) => () => Promise<void>;

  // Loading states
  isSaving: boolean;
  isDownloading: boolean;
  isGeneratingVideo: false | number;
  isRegenerating: false | number;

  // Save data
  getArtifactSaveData: () => ArtifactSaveData;
}

// Provider Props
export interface ArtifactProviderProps {
  children: React.ReactNode;
  artifact?: Artifact;
  name: string;
  artifactId: string;
  workspaceId: string;
  onRegenerate: () => void;
  onSave: (artifactSaveData?: ArtifactSaveData) => void;
  onImageToVideo?: () => void;
  mediaTrackingCallbacks?: MediaTrackingCallbacks;
  enableGenerate?: boolean;
  mediaUrls?: ArtifactMediaUrls[];
}

// Create Context
const ArtifactContext = createContext<ArtifactContextValue | null>(null);

export const defaultMediaUrl: ArtifactMediaUrls = {
  imageUrls: [],
  videoUrls: [],
  currentIndex: 0,
  currentImageUrl: null,
  generatedAt: new Date(),
  showVideo: false,
};

// Provider Component
export const ArtifactProvider: React.FC<ArtifactProviderProps> = ({
  children,
  artifact,
  name,
  artifactId,
  workspaceId,
  onSave,
  onRegenerate,
  onImageToVideo,
  mediaTrackingCallbacks,
  enableGenerate = false,
  mediaUrls: initialMediaUrls = [],
}) => {
  const [currentArtifactId, setCurrentArtifactId] = useState(artifactId);
  // Create default artifact if none provided
  const defaultArtifact: Artifact = artifact || {
    id: currentArtifactId,
    name,
    format: 'ad-template',
    content: '',
    type: 'ad-template',
  };

  // Media state
  const [mediaUrls, setMediaUrls] = useState<ArtifactMediaUrls[]>(initialMediaUrls);

  // Loading states
  const [isSaving, setIsSaving] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState<false | number>(false);
  const [isRegenerating, setIsRegenerating] = useState<false | number>(false);

  // Track contexts for better organization
  const urlContexts = useRef<Map<string, string>[]>([]);
  const updateUrlContext =
    (mediaIndex: number = 0) =>
      (url: string, context?: string) => {
        if (context) {
          if (!urlContexts.current[mediaIndex]) urlContexts.current[mediaIndex] = new Map();
          urlContexts.current[mediaIndex].set(url, context);
        }
      };
  const deleteUrlContext =
    (mediaIndex: number = 0) =>
      (url: string) =>
        urlContexts.current[mediaIndex]?.delete(url);
  const clearUrlContext = (mediaIndex: number = 0) => urlContexts.current[mediaIndex]?.clear();
  const getUrlContext =
    (mediaIndex: number = 0) =>
      (url: string) =>
        urlContexts.current[mediaIndex]?.get(url);

  // Media actions
  const addImageUrl = useCallback(
    (mediaIndex: number = 0) =>
      (url: string, context?: string) => {
        setMediaUrls((prev) => {
          const newMediaUrls = [...prev];
          const mediaUrl = newMediaUrls[mediaIndex] || { ...defaultMediaUrl };
          const newMediaUrl = {
            ...mediaUrl,
            imageUrls: [...mediaUrl.imageUrls.filter((u) => u !== url), url],
            generatedAt: new Date(),
            currentImageUrl: url,
            currentIndex: mediaUrl.imageUrls.length,
            showVideo: false,
          };
          newMediaUrls[mediaIndex] = newMediaUrl;

          updateUrlContext(mediaIndex)(url, context);
          mediaTrackingCallbacks?.onImageGenerated?.(url, context);
          mediaTrackingCallbacks?.onMediaUrlsUpdated?.(newMediaUrl);

          return newMediaUrls;
        });

        setIsRegenerating(false);
      },
    [mediaTrackingCallbacks],
  );

  const addVideoUrl = useCallback(
    (mediaIndex: number = 0) =>
      (url: string, context?: string) => {
        setMediaUrls((prev) => {
          const newMediaUrls = [...prev];
          const mediaUrl = newMediaUrls[mediaIndex] || { ...defaultMediaUrl };
          const newMediaUrl = {
            ...mediaUrl,
            videoUrls: [...mediaUrl.videoUrls.filter((u) => u !== url), url],
            generatedAt: new Date(),
            currentIndex: mediaUrl.videoUrls.length,
            showVideo: true,
          };
          newMediaUrls[mediaIndex] = newMediaUrl;

          updateUrlContext(mediaIndex)(url, context);
          mediaTrackingCallbacks?.onVideoGenerated?.(url, context);
          mediaTrackingCallbacks?.onMediaUrlsUpdated?.(newMediaUrl);

          return newMediaUrls;
        });

        setIsRegenerating(false);
      },
    [mediaTrackingCallbacks],
  );

  const removeImageUrl = useCallback(
    (mediaIndex: number = 0) =>
      (url: string) => {
        setMediaUrls((prev) => {
          const newMediaUrls = [...prev];
          const mediaUrl = newMediaUrls[mediaIndex] || { ...defaultMediaUrl };
          const newMediaUrl = {
            ...mediaUrl,
            imageUrls: mediaUrl.imageUrls.filter((u) => u !== url),
            generatedAt: new Date(),
            currentImageUrl: mediaUrl.imageUrls.length > 0 ? mediaUrl.imageUrls[mediaUrl.imageUrls.length - 1] : null,
          };
          newMediaUrls[mediaIndex] = newMediaUrl;

          deleteUrlContext(mediaIndex)(url);
          mediaTrackingCallbacks?.onMediaUrlsUpdated?.(newMediaUrl);

          return newMediaUrls;
        });
      },
    [mediaTrackingCallbacks],
  );

  const removeVideoUrl = useCallback(
    (mediaIndex: number = 0) =>
      (url: string) => {
        setMediaUrls((prev) => {
          const newMediaUrls = [...prev];
          const mediaUrl = newMediaUrls[mediaIndex] || { ...defaultMediaUrl };
          const newMediaUrl = {
            ...mediaUrl,
            videoUrls: mediaUrl.videoUrls.filter((u) => u !== url),
            generatedAt: new Date(),
          };
          newMediaUrls[mediaIndex] = newMediaUrl;

          deleteUrlContext(mediaIndex)(url);
          mediaTrackingCallbacks?.onMediaUrlsUpdated?.(newMediaUrl);

          return newMediaUrls;
        });
      },
    [mediaTrackingCallbacks],
  );

  const clearAllUrls = useCallback(
    (mediaIndex: number = 0) =>
      () => {
        setMediaUrls((prev) => {
          const newMediaUrls = [...prev];
          const mediaUrl = newMediaUrls[mediaIndex] || { ...defaultMediaUrl };
          newMediaUrls[mediaIndex] = { ...mediaUrl, imageUrls: [], videoUrls: [] };
          return newMediaUrls;
        });
        clearUrlContext(mediaIndex);
      },
    [],
  );

  const updateMediaUrl = useCallback(
    (mediaIndex: number = 0) =>
      (mediaUrl: ArtifactMediaUrls) => {
        setMediaUrls((prev) => {
          const newMediaUrls = [...prev];
          newMediaUrls[mediaIndex] = mediaUrl;
          return newMediaUrls;
        });
      },
    [],
  );

  // Save data preparation
  const getArtifactSaveData = useCallback((): ArtifactSaveData => {
    return {
      artifact: defaultArtifact,
      mediaUrls: mediaUrls,
      metadata: {
        name: defaultArtifact.name,
        type: defaultArtifact.type || 'unknown',
        artifactId: currentArtifactId || 'unknown',
        lastModified: new Date(),
      },
    };
  }, [defaultArtifact, mediaUrls, currentArtifactId]);

  // Control actions
  const save = useCallback(async () => {
    setIsSaving(true);
    try {
      const saveData = getArtifactSaveData();

      try {
        const response = await fetch('/api/ads/artifacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspaceId,
            artifact: { ...saveData.artifact, id: currentArtifactId, mediaUrls: saveData.mediaUrls },
          }),
        });

        if (!response.ok) throw new Error('Failed to save artifact');

        const results = await response.json();
        if (results.artifact?.id) {
          setCurrentArtifactId(results.artifact.id);
        }
      } catch (error) {
        ArtifactSaveService.exportArtifactData(saveData);
        onSave(saveData);
      }
    } finally {
      setIsSaving(false);
    }
  }, [currentArtifactId, getArtifactSaveData, onSave, workspaceId]);

  const imageToVideo = useCallback(
    (mediaIndex: number = 0) =>
      async () => {
        const currentImageUrl = mediaUrls[mediaIndex]?.currentImageUrl;
        if (!currentImageUrl) return;

        setIsGeneratingVideo(mediaIndex);
        try {
          const response = await fetch('/api/ads/generate-video', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              workspaceId,
              artifact: { id: currentArtifactId, name, format: 'video', content: 'This is a video' },
              imageUrl: currentImageUrl,
              type: 'video',
            }),
          });

          if (!response.ok) throw new Error('Failed to generate video');

          const data = await response.json();
          addVideoUrl(mediaIndex)(data.url, 'image-to-video');
          onImageToVideo?.();
        } catch (error) {
          console.error('Error generating video:', error);
        } finally {
          setIsGeneratingVideo(false);
          save();
        }
      },
    [mediaUrls, workspaceId, currentArtifactId, name, addVideoUrl, onImageToVideo, save],
  );

  const regenerate = useCallback(
    (mediaIndex: number) => () => {
      const mediaUrl = mediaUrls[mediaIndex];
      if (!mediaUrl) return;

      if (mediaUrl.showVideo) {
        if (!mediaUrl.currentImageUrl) return;
        imageToVideo(mediaIndex)();
      }

      setIsRegenerating(mediaIndex);
      onRegenerate?.();
    },
    [mediaUrls, imageToVideo, onRegenerate],
  );

  const downloadMediaAssets = useCallback(async () => {
    setIsDownloading(true);

    try {
      const JSZipMod = await import('jszip');
      const JSZip = JSZipMod.default;
      const zip = new JSZip();
      const baseName = sanitizeFileName(name || 'assets');

      const skipped: string[] = [];

      for (let i = 0; i < mediaUrls.length; i += 1) {
        const mediaUrl = mediaUrls[i];
        const imageUrls = mediaUrl.imageUrls || [];
        const videoUrls = mediaUrl.videoUrls || [];
        const allUrls = [...imageUrls, ...videoUrls];
        if (allUrls.length === 0) continue;

        for (let j = 0; j < allUrls.length; j += 1) {
          const url = allUrls[j];
          try {
            const response = await fetch(url, { mode: 'cors' });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const blob = await response.blob();
            const contentType = blob.type || '';
            const isVideo = contentType.startsWith('video/') || url.toLowerCase().includes('.mp4');
            let ext = getExtensionFromUrl(url);

            if (!ext) {
              if (contentType.includes('png')) ext = 'png';
              else if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = 'jpg';
              else if (contentType.includes('webp')) ext = 'webp';
              else if (contentType.includes('gif')) ext = 'gif';

              if (contentType.includes('mp4')) ext = 'mp4';
            }
            const finalExt = ext || (isVideo ? 'mp4' : 'jpg');

            const mediaName = mediaUrls.length > 1 ? `/Slide ${i + 1}` : '';
            const mediaTypeName = isVideo ? 'videos' : 'images';
            const mediaFileName = `${baseName}-${mediaTypeName}-${j + 1}`;
            const filename = `${baseName}${mediaName}/${mediaTypeName}/${mediaFileName}.${finalExt}`;

            zip.file(filename, blob);
          } catch {
            skipped.push(url);
          }
        }

        if (skipped.length > 0) {
          zip.file(
            `${baseName}/SKIPPED.txt`,
            `The following URLs could not be fetched and were not included in the zip.\n\n${skipped.join(
              '\n'
            )}\n`
          );
        }
      }

      const zipBlob = (await zip.generateAsync({ type: 'blob' })) as Blob;
      const objectUrl = URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `${baseName}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);

    } catch (error) {
      console.error('Failed to create zip', error);
    } finally {
      setIsDownloading(false);
    }
  }, [mediaUrls, name]);

  const saveRef = useRef(save);
  saveRef.current = save;
  const prevRegeneratingRef = useRef<false | number>(false);
  useEffect(() => {
    const wasRegenerating = prevRegeneratingRef.current !== false;
    const didJustFinishRegenerating = wasRegenerating && isRegenerating === false;
    prevRegeneratingRef.current = isRegenerating;
    if (enableGenerate && didJustFinishRegenerating) {
      saveRef.current();
    }
  }, [isRegenerating, enableGenerate]);

  const contextValue: ArtifactContextValue = {
    artifact: defaultArtifact,
    name,
    mediaUrls,
    enableGenerate,
    addImageUrl,
    addVideoUrl,
    removeImageUrl,
    removeVideoUrl,
    clearAllUrls,
    getUrlContext,
    updateMediaUrl,
    downloadMediaAssets,
    save,
    regenerate,
    imageToVideo,
    isSaving,
    isGeneratingVideo,
    isRegenerating,
    isDownloading,
    getArtifactSaveData,
  };

  return <ArtifactContext.Provider value={contextValue}>{children}</ArtifactContext.Provider>;
};

// Custom hook to use the context
export const useArtifactContext = (): ArtifactContextValue => {
  const context = useContext(ArtifactContext);
  if (!context) {
    throw new Error('useArtifactContext must be used within an ArtifactProvider');
  }
  return context;
};
