"use client";

import { useCallback } from "react";
import { Minimize2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LexicalMarkdownEditor } from "@/components/ui/lexical-markdown-editor";

interface DescriptionEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onChange: (value: string) => void;
  /** Called when dialog closes - use for persisting changes */
  onClose?: () => void;
  placeholder?: string;
  onUploadImage?: (file: File) => Promise<string>;
}

export function DescriptionEditorDialog({
  open,
  onOpenChange,
  value,
  onChange,
  onClose,
  placeholder = "Add a description...",
  onUploadImage,
}: DescriptionEditorDialogProps) {
  const handleClose = useCallback(() => {
    onClose?.();
    onOpenChange(false);
  }, [onClose, onOpenChange]);

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) handleClose();
        else onOpenChange(true);
      }}
    >
      <DialogContent
        className="min-w-[90vw] w-[90vw] h-[90vh] flex flex-col p-0 gap-0"
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
              aria-label="Close"
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
  );
}
