"use client";

import { useState } from "react";
import {
  X,
  Download,
  ZoomIn,
  ZoomOut,
  RotateCw,
  File,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  isImageType,
  isPdfType,
  formatFileSize,
} from "@/lib/storage/file-validation";
import type { AttachmentWithUrl } from "@/lib/types";

interface AttachmentPreviewProps {
  attachment: AttachmentWithUrl | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AttachmentPreview({
  attachment,
  open,
  onOpenChange,
}: AttachmentPreviewProps) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  if (!attachment) return null;

  const isImage = isImageType(attachment.mimeType);
  const isPdf = isPdfType(attachment.mimeType);

  const handleDownload = () => {
    window.open(attachment.url, "_blank");
  };

  const handleZoomIn = () => {
    setZoom((prev) => Math.min(prev + 0.25, 3));
  };

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(prev - 0.25, 0.5));
  };

  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  const handleClose = () => {
    setZoom(1);
    setRotation(0);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="min-w-[98vw] w-[90vw] h-[98vh] flex flex-col p-0 gap-0"
        showCloseButton={false}
      >
        <DialogHeader className="px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-sm font-medium truncate max-w-[50%]">
              {attachment.filename}
            </DialogTitle>
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground mr-2">
                {formatFileSize(attachment.size)}
              </span>

              {isImage && (
                <>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={handleZoomOut}
                    disabled={zoom <= 0.5}
                    title="Zoom out"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </Button>
                  <span className="text-xs text-muted-foreground w-12 text-center">
                    {Math.round(zoom * 100)}%
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={handleZoomIn}
                    disabled={zoom >= 3}
                    title="Zoom in"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={handleRotate}
                    title="Rotate"
                  >
                    <RotateCw className="w-4 h-4" />
                  </Button>
                  <div className="w-px h-4 bg-border mx-1" />
                </>
              )}

              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleDownload}
                title="Download"
              >
                <Download className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleClose}
                title="Close"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-auto bg-muted/30 flex items-center justify-center">
          {isImage && (
            <div
              className="transition-transform duration-200"
              style={{
                transform: `scale(${zoom}) rotate(${rotation}deg)`,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={attachment.url}
                alt={attachment.filename}
                className="max-w-full max-h-[calc(98vh-4rem)] object-contain"
              />
            </div>
          )}

          {isPdf && (
            <iframe
              src={attachment.url}
              title={attachment.filename}
              className="w-full h-full border-0"
            />
          )}

          {!isImage && !isPdf && (
            <div className="flex flex-col items-center justify-center gap-4 text-muted-foreground">
              <File className="w-16 h-16" />
              <div className="text-center">
                <p className="font-medium">{attachment.filename}</p>
                <p className="text-sm">{formatFileSize(attachment.size)}</p>
              </div>
              <Button onClick={handleDownload}>
                <Download className="w-4 h-4 mr-2" />
                Download File
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
