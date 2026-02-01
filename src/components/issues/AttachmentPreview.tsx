"use client";

import { useState, useEffect } from "react";
import {
  X,
  Download,
  ZoomIn,
  ZoomOut,
  RotateCw,
  File,
} from "lucide-react";
import { stripCiteTags } from "@/lib/utils";
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
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AttachmentWithUrl } from "@/lib/types";

function isMarkdownType(mimeType: string, filename: string): boolean {
  return (
    mimeType === "text/markdown" ||
    mimeType === "text/x-markdown" ||
    filename.endsWith(".md") ||
    filename.endsWith(".markdown")
  );
}

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
  const [markdownContent, setMarkdownContent] = useState<string | null>(null);

  const isImage = attachment ? isImageType(attachment.mimeType) : false;
  const isPdf = attachment ? isPdfType(attachment.mimeType) : false;
  const isMarkdown = attachment
    ? isMarkdownType(attachment.mimeType, attachment.filename)
    : false;

  // Derive loading state: we're loading if we should show markdown but don't have content yet
  const isLoadingMarkdown = open && isMarkdown && markdownContent === null;

  // Fetch markdown content when opening a markdown file
  useEffect(() => {
    // Only fetch when dialog is open with a markdown file
    if (!open || !attachment || !isMarkdown) {
      return;
    }

    // Skip if we already have content for this attachment
    if (markdownContent !== null) {
      return;
    }

    fetch(attachment.url)
      .then((res) => res.text())
      .then((text) => {
        setMarkdownContent(text);
      })
      .catch((err) => {
        console.error("Failed to load markdown:", err);
        setMarkdownContent("*Failed to load markdown content*");
      });
  }, [open, attachment, isMarkdown, markdownContent]);

  if (!attachment) return null;

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
    setMarkdownContent(null);
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

          {isMarkdown && (
            <div className="w-full h-full overflow-auto p-6">
              {isLoadingMarkdown ? (
                <div className="flex items-center justify-center h-full">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm">Loading markdown...</span>
                  </div>
                </div>
              ) : (
                <div className="max-w-4xl mx-auto bg-background rounded-lg border border-border p-8">
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {stripCiteTags(markdownContent || "")}
                    </ReactMarkdown>
                  </div>
                </div>
              )}
            </div>
          )}

          {!isImage && !isPdf && !isMarkdown && (
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
