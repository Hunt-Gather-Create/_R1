"use client";

import { useCallback } from "react";
import { Minimize2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useColorMode } from "@/lib/hooks";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Dynamically import markdown editor to avoid SSR issues
const MDEditor = dynamic(() => import("@uiw/react-md-editor"), { ssr: false });
import "@uiw/react-md-editor/markdown-editor.css";

interface DescriptionEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onChange: (value: string) => void;
  /** Called when dialog closes - use for persisting changes */
  onClose?: () => void;
  placeholder?: string;
}

export function DescriptionEditorDialog({
  open,
  onOpenChange,
  value,
  onChange,
  onClose,
  placeholder = "Add a description...",
}: DescriptionEditorDialogProps) {
  const colorMode = useColorMode();

  const handleClose = useCallback(() => {
    onClose?.();
    onOpenChange(false);
  }, [onClose, onOpenChange]);

  const handleChange = useCallback(
    (val: string | undefined) => {
      onChange(val || "");
    },
    [onChange]
  );

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
        <div
          data-color-mode={colorMode}
          className="markdown-editor-wrapper markdown-editor-fullscreen flex-1 min-h-0"
        >
          <MDEditor
            value={value}
            onChange={handleChange}
            preview="live"
            textareaProps={{ placeholder, autoFocus: true }}
            height="100%"
            visibleDragbar={false}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
