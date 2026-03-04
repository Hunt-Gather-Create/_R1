export interface ArtifactMediaUrls {
  imageUrls: string[];
  videoUrls: string[];
  currentIndex: number;
  currentImageUrl: string | null;
  generatedAt: Date;
  showVideo: boolean;
  /** Prompt for the current version (for client-side generation when url is missing) */
  currentPrompt?: string;
}

/** Per-slot versioned media: each version = one generated image for this slot */
export interface MediaVersion {
  prompt?: string;
  storageKey?: string;
  imageUrl?: string;
}

/** One slot = one media asset (e.g. profile image, or one content image). currentIndex is per slot. */
export interface MediaSlot {
  /** Which version is displayed for this media asset (0-based index into versions). */
  currentIndex: number;
  versions: MediaVersion[];
}

export interface ArtifactSaveData {
  artifact: Artifact;
  mediaUrls: ArtifactMediaUrls[];
  metadata: {
    name: string;
    type: string;
    artifactId: string;
    lastModified: Date;
  };
}

export interface MediaTrackingCallbacks {
  onImageGenerated?: (url: string, context?: string) => void;
  onVideoGenerated?: (url: string, context?: string) => void;
  onMediaUrlsUpdated?: (urls: ArtifactMediaUrls) => void;
  onCurrentImageUrlUpdated?: (url: string) => void;
}

// Artifact type used throughout the ad system
export interface Artifact {
  id: string;
  name: string;
  format: string;
  content: string;
  type: string;
  mediaUrls?: ArtifactMediaUrls[];
}
