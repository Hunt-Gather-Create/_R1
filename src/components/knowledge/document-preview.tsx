"use client";

import { AlertTriangle, Download, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CsvPreview } from "@/components/knowledge/csv-preview";
import { PdfPreview } from "@/components/knowledge/pdf-preview";
import { TextPreview } from "@/components/knowledge/text-preview";

function normalizeFileExtension(extension: string): string {
  return extension.trim().toLowerCase().replace(/^\./, "");
}

interface DocumentPreviewProps {
  title: string;
  previewUrl: string | null;
  downloadUrl: string;
  fileExtension: string;
  previewStatus: "ready" | "pending" | "failed";
  previewError: string | null;
  onRetryPreview?: () => void;
  isRetryingPreview?: boolean;
}

export function DocumentPreview({
  title,
  previewUrl,
  downloadUrl,
  fileExtension,
  previewStatus,
  previewError,
  onRetryPreview,
  isRetryingPreview = false,
}: DocumentPreviewProps) {
  const normalizedExtension = normalizeFileExtension(fileExtension);
  const isCsv = normalizedExtension === "csv";
  const isText = normalizedExtension === "txt";

  return (
    <div className="h-full min-h-0 rounded-md border border-border bg-background overflow-hidden flex flex-col">
      <div className="h-10 border-b border-border px-3 flex items-center justify-end gap-2">
        <Button asChild size="sm" variant="outline">
          <a href={downloadUrl} target="_blank" rel="noreferrer">
            <ExternalLink className="h-4 w-4 mr-1.5" />
            Open
          </a>
        </Button>
        <Button asChild size="sm" variant="outline">
          <a href={downloadUrl} download={title}>
            <Download className="h-4 w-4 mr-1.5" />
            Download
          </a>
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {previewStatus === "pending" ? (
          <div className="h-full w-full flex items-center justify-center px-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-2 text-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Preparing PDF preview...</span>
            </div>
          </div>
        ) : previewStatus === "failed" || !previewUrl ? (
          <div className="h-full w-full flex items-center justify-center px-4 text-sm text-muted-foreground">
            <div className="flex flex-col items-center gap-3 text-center max-w-xl">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                <span>{previewError || "Preview unavailable"}</span>
              </div>
              {onRetryPreview ? (
                <Button size="sm" variant="outline" onClick={onRetryPreview}>
                  {isRetryingPreview ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1.5 h-4 w-4" />
                  )}
                  Retry preview
                </Button>
              ) : null}
            </div>
          </div>
        ) : isCsv ? (
          <CsvPreview previewUrl={previewUrl} title={title} />
        ) : isText ? (
          <TextPreview previewUrl={previewUrl} title={title} />
        ) : (
          <PdfPreview previewUrl={previewUrl} title={title} />
        )}
      </div>
    </div>
  );
}
