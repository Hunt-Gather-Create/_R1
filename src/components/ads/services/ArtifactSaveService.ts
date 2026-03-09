import type { ArtifactSaveData } from '../types/ArtifactData';

export class ArtifactSaveService {
  /**
   * Save artifact data including media URLs to the backend
   */
  static async saveArtifact(saveData: ArtifactSaveData): Promise<{ success: boolean; artifactId?: string; error?: string }> {
    try {
      const payload = {
        artifact: saveData.artifact,
        mediaUrls: saveData.mediaUrls,
        metadata: saveData.metadata,
      };

      const response = await fetch('/api/ads/artifacts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Failed to save artifact: ${response.statusText}`);
      }

      const result = await response.json();

      return {
        success: true,
        artifactId: result.id || saveData.metadata.artifactId,
      };
    } catch (error) {
      console.error('Error saving artifact:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Update existing artifact with new media URLs
   */
  static async updateArtifactMedia(
    artifactId: string,
    mediaUrls: ArtifactSaveData['mediaUrls']
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch('/api/ads/artifacts', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ artifactId, mediaUrls }),
      });

      if (!response.ok) {
        throw new Error(`Failed to update artifact media: ${response.statusText}`);
      }

      return { success: true };
    } catch (error) {
      console.error('Error updating artifact media:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Export artifact data as JSON for download
   */
  static exportArtifactData(saveData: ArtifactSaveData): void {
    const dataStr = JSON.stringify(saveData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });

    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `artifact-${saveData.metadata.name}-${Date.now()}.json`;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  }

  /**
   * Generate a summary of the artifact for logging/debugging
   */
  static generateArtifactSummary(saveData: ArtifactSaveData): string {
    const { mediaUrls, metadata } = saveData;

    return `
Artifact Summary:
- Name: ${metadata.name}
- Type: ${metadata.type}
- ID: ${metadata.artifactId}
${mediaUrls.map((mediaUrl, i) => `
  (${i})
  - Images: ${mediaUrl.imageUrls.length}
  - Videos: ${mediaUrl.videoUrls.length}
  - Generated At: ${mediaUrl.generatedAt.toISOString()}
  - Image URLs: ${mediaUrl.imageUrls.map((url, j) => `  ${j + 1}. ${url}`).join('\n')}
  - Video URLs: ${mediaUrl.videoUrls.map((url, j) => `  ${j + 1}. ${url}`).join('\n')}
`).join('\n\n')}
`;
  }
}
