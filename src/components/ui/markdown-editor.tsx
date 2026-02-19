"use client";

import { useState, useCallback } from "react";
import { Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LexicalMarkdownEditor } from "./lexical-markdown-editor";
import { LexicalMarkdownPreview } from "./lexical";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  minHeight?: number;
  className?: string;
  compact?: boolean;
  previewMode?: "edit" | "live" | "preview";
  onUploadImage?: (file: File) => Promise<string>;
}

export function MarkdownEditor({
  value,
  onChange,
  onBlur,
  placeholder = "Add a description...",
  minHeight = 120,
  className,
  compact = false,
  onUploadImage,
}: MarkdownEditorProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleClose = useCallback(() => {
    setIsFullscreen(false);
    onBlur?.();
  }, [onBlur]);

  return (
    <>
      <div className={cn(className)}>
        <LexicalMarkdownEditor
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          compact={compact}
          onBlur={onBlur}
          minHeight={minHeight}
          onUploadImage={onUploadImage}
        />
      </div>

      <Dialog open={isFullscreen} onOpenChange={setIsFullscreen}>
        <DialogContent
          className="min-w-[98vw] w-[90vw] h-[98vh] flex flex-col p-0 gap-0"
          showCloseButton={false}
        >
          <DialogHeader className="px-4 py-3 border-b border-border shrink-0">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-sm font-medium">
                Edit Description
              </DialogTitle>
              <button
                onClick={handleClose}
                className="p-1.5 hover:bg-accent rounded-md text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Exit fullscreen"
              >
                <Minimize2 className="w-4 h-4" />
              </button>
            </div>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            <LexicalMarkdownEditor
              value={value}
              onChange={onChange}
              placeholder={placeholder}
              className="h-full border-0 rounded-none"
              onUploadImage={onUploadImage}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface MarkdownPreviewProps {
  content: string;
  className?: string;
}

export function MarkdownPreview({ content, className }: MarkdownPreviewProps) {
  if (!content) return null;

  return <LexicalMarkdownPreview content={content} className={className} />;
}
