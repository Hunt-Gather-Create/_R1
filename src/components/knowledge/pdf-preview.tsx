"use client";

import { AlertTriangle } from "lucide-react";

interface PdfPreviewProps {
  previewUrl: string;
  title: string;
}

export function PdfPreview({ previewUrl, title }: PdfPreviewProps) {
  return (
    <div className="h-full w-full bg-muted/20">
      <iframe
        title={`${title} preview`}
        src={previewUrl}
        className="h-full w-full border-0"
        loading="lazy"
      />
      <noscript>
        <div className="flex items-center justify-center gap-2 px-4 py-3 text-sm text-muted-foreground">
          <AlertTriangle className="h-4 w-4" />
          Enable JavaScript to view this preview.
        </div>
      </noscript>
    </div>
  );
}
