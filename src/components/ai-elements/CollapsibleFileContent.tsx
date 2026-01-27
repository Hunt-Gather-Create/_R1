"use client";

import { useState } from "react";
import { FileText, ChevronDown, ChevronRight } from "lucide-react";

export interface TextFileSection {
  filename: string;
  content: string;
}

export function parseTextWithFileAttachments(text: string): {
  mainText: string;
  filesSections: TextFileSection[];
} {
  const pattern = /\n\n--- (.+?) ---\n([\s\S]*?)(?=\n\n--- .+? ---\n|$)/g;
  const filesSections: TextFileSection[] = [];

  // Find all file sections
  let match;
  while ((match = pattern.exec(text)) !== null) {
    filesSections.push({
      filename: match[1],
      content: match[2].trim(),
    });
  }

  // Get the main text (everything before the first file section)
  const firstFileIndex = text.indexOf("\n\n--- ");
  const mainText = firstFileIndex !== -1 ? text.substring(0, firstFileIndex).trim() : text.trim();

  return { mainText, filesSections };
}

export function CollapsibleFileContent({ filename, content }: TextFileSection) {
  const [isExpanded, setIsExpanded] = useState(false);
  const ext = filename.split(".").pop()?.toUpperCase() || "";
  const previewLength = 100;
  const hasMoreContent = content.length > previewLength;

  return (
    <div className="mt-2 rounded-lg bg-background/50 border border-border/50 overflow-hidden">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-muted/50 transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
        )}
        <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium truncate flex-1">{filename}</span>
        <span className="text-xs text-muted-foreground">{ext}</span>
      </button>
      {isExpanded && (
        <div className="px-3 pb-2 border-t border-border/50">
          <pre className="text-xs text-muted-foreground whitespace-pre-wrap overflow-x-auto mt-2 max-h-[300px] overflow-y-auto">
            {content}
          </pre>
        </div>
      )}
      {!isExpanded && hasMoreContent && (
        <div className="px-3 pb-2 text-xs text-muted-foreground/70 truncate">
          {content.substring(0, previewLength)}...
        </div>
      )}
    </div>
  );
}
