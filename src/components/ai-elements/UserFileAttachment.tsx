"use client";

import { FileText } from "lucide-react";

interface UserFilePart {
  type: "file";
  mediaType: string;
  url: string;
  filename?: string;
}

interface UserFileAttachmentProps {
  part: UserFilePart;
}

export function UserFileAttachment({ part }: UserFileAttachmentProps) {
  const isImage = part.mediaType?.startsWith("image/");
  const filename = part.filename || "Attachment";

  if (isImage) {
    return (
      <img
        src={part.url}
        alt={filename}
        className="max-w-[300px] max-h-[300px] rounded-lg object-contain mt-2"
      />
    );
  }

  // Text/other files - show as card
  const ext = filename.split(".").pop()?.toUpperCase() || "";

  return (
    <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-lg bg-background/50 border border-border/50 max-w-[200px]">
      <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
      <div className="min-w-0">
        <p className="text-xs font-medium truncate">{filename}</p>
        <p className="text-xs text-muted-foreground">{ext} file</p>
      </div>
    </div>
  );
}

export type { UserFilePart };
