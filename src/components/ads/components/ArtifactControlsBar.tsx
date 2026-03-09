"use client";

import React from 'react';
import { Loader2, Paperclip } from 'lucide-react';
import { useArtifact } from '@/components/ads/hooks/useArtifact';
// import { ArtifactControlsRegenerate } from './ArtifactControlsRegenerate';
// import { ArtifactControlsImageToVideo } from './ArtifactControlsImageToVideo';
import { ArtifactControlsAssets } from './ArtifactControlsAssets';

const headerButtonClass =
  "p-1.5 rounded-md hover:bg-muted transition-colors disabled:opacity-50 disabled:pointer-events-none";

type ArtifactControlsBarProps = {
  showMediaCount?: boolean;
  /** When true, show title (artifact name) in the bar. Set false when title is in parent (e.g. side panel header). */
  showTitle?: boolean;
  /** 'bar' = full bar above template, 'header' = compact inline row for panel headers */
  variant?: "bar" | "header";
  /** Optional save/attach action (e.g. in side panel header). When set, a button is shown in header variant. */
  onSaveAsAttachment?: () => void;
  isSavingAsAttachment?: boolean;
  saveAttachmentDisabled?: boolean;
  saveAttachmentTitle?: string;
};

const ArtifactControlsBar: React.FC<ArtifactControlsBarProps> = ({
  showMediaCount = true,
  showTitle = true,
  variant = "bar",
  onSaveAsAttachment,
  isSavingAsAttachment = false,
  saveAttachmentDisabled = false,
  saveAttachmentTitle,
}) => {
  const { name, imageCount, videoCount } = useArtifact();
  const isHeader = variant === "header";

  return (
    <div className={isHeader ? "flex items-center gap-2" : undefined}>
      <div
        className={
          isHeader
            ? "flex items-center gap-2"
            : "flex justify-between items-center p-2 gap-4 w-full"
        }
      >
        {(!isHeader || showTitle) && (
          <div className={isHeader ? "min-w-0" : "flex-1 truncate"} title={name}>
            <span
              className={
                isHeader
                  ? "text-sm text-muted-foreground truncate font-medium"
                  : "text-sm text-muted-foreground truncate px-2 font-medium"
              }
            >
              {name}
            </span>
            {/* Temporarily hidden — restore to re-enable */}
            {/* {showMediaCount && (imageCount > 0 || videoCount > 0) && (
              <span
                className={
                  isHeader
                    ? "text-xs text-muted-foreground ml-1.5 bg-muted px-1.5 py-0.5 rounded"
                    : "text-xs text-muted-foreground ml-2 bg-muted px-2 py-1 rounded"
                }
              >
                {imageCount} images, {videoCount} videos
              </span>
            )} */}
          </div>
        )}
        {/* Temporarily hidden — restore to re-enable */}
        {/* {isHeader && !showTitle && showMediaCount && (imageCount > 0 || videoCount > 0) && (
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded whitespace-nowrap">
            {imageCount} images, {videoCount} videos
          </span>
        )} */}
        <div className={isHeader ? "flex items-center gap-1" : "flex items-center gap-3"}>
          {/* <ArtifactControlsRegenerate compact={isHeader} />
          <ArtifactControlsImageToVideo compact={isHeader} /> */}
          {isHeader && onSaveAsAttachment != null && (
            <button
            type="button"
            onClick={onSaveAsAttachment}
            disabled={saveAttachmentDisabled || isSavingAsAttachment}
            className={headerButtonClass}
            title={saveAttachmentTitle}
            >
              {isSavingAsAttachment ? (
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              ) : (
                <Paperclip className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
          )}
          {/* Temporarily hidden — restore to re-enable */}
          {/* <ArtifactControlsAssets compact={isHeader} /> */}
        </div>
      </div>
    </div>
  );
};

export default ArtifactControlsBar;
