"use client";

import { createElement } from "react";
import {
  FileText,
  File,
  Image as ImageIcon,
  FileSpreadsheet,
  FileCode,
  MoreHorizontal,
  Download,
  Trash2,
  Eye,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  isImageType,
  isPdfType,
  formatFileSize,
} from "@/lib/storage/file-validation";
import type { AttachmentWithUrl } from "@/lib/types";

interface AttachmentItemProps {
  attachment: AttachmentWithUrl;
  onPreview: () => void;
  onDelete: () => void;
  isDeleting?: boolean;
}

function isMarkdownType(mimeType: string): boolean {
  return mimeType === "text/markdown" || mimeType === "text/x-markdown";
}

// Get icon component for file type (returns component, not element)
function getFileIcon(mimeType: string): LucideIcon {
  if (isImageType(mimeType)) return ImageIcon;
  if (isPdfType(mimeType)) return FileText;
  if (isMarkdownType(mimeType)) return FileCode;
  if (
    mimeType.includes("spreadsheet") ||
    mimeType.includes("excel") ||
    mimeType.includes("ms-excel")
  ) {
    return FileSpreadsheet;
  }
  return File;
}

function getIconColor(mimeType: string): string {
  if (isImageType(mimeType)) return "text-blue-500";
  if (isPdfType(mimeType)) return "text-red-500";
  if (isMarkdownType(mimeType)) return "text-purple-500";
  if (
    mimeType.includes("spreadsheet") ||
    mimeType.includes("excel") ||
    mimeType.includes("ms-excel")
  ) {
    return "text-green-500";
  }
  return "text-muted-foreground";
}

export function AttachmentItem({
  attachment,
  onPreview,
  onDelete,
  isDeleting = false,
}: AttachmentItemProps) {
  const isImage = isImageType(attachment.mimeType);
  const IconComponent = getFileIcon(attachment.mimeType);
  const iconColor = getIconColor(attachment.mimeType);

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.open(attachment.url, "_blank");
  };

  return (
    <div
      className={cn(
        "group relative flex flex-col rounded-md border border-border overflow-hidden",
        "hover:border-primary/50 transition-colors cursor-pointer",
        isDeleting && "opacity-50 pointer-events-none"
      )}
      onClick={onPreview}
    >
      {/* Thumbnail / Icon */}
      <div className="aspect-square bg-muted/50 flex items-center justify-center overflow-hidden">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={attachment.url}
            alt={attachment.filename}
            className="w-full h-full object-cover"
          />
        ) : (
          // Use createElement to render icon (avoids "component created during render" lint error)
          createElement(IconComponent, { className: cn("w-10 h-10", iconColor) })
        )}
      </div>

      {/* File info */}
      <div className="p-2 border-t border-border">
        <p className="text-xs font-medium truncate" title={attachment.filename}>
          {attachment.filename}
        </p>
        <p className="text-[10px] text-muted-foreground">
          {formatFileSize(attachment.size)}
        </p>
      </div>

      {/* Actions dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "absolute top-1 right-1 p-1 rounded bg-background/80 backdrop-blur-sm",
              "opacity-0 group-hover:opacity-100 transition-opacity",
              "hover:bg-accent"
            )}
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={() => onPreview()}>
            <Eye className="w-4 h-4 mr-2" />
            Preview
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleDownload}>
            <Download className="w-4 h-4 mr-2" />
            Download
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
