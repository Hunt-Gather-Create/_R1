"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useColorMode } from "@/lib/hooks";
import { commands, ICommand } from "@uiw/react-md-editor";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import "@uiw/react-md-editor/markdown-editor.css";

// Dynamically import to avoid SSR issues
const MDEditor = dynamic(() => import("@uiw/react-md-editor"), { ssr: false });
const MDPreview = dynamic(
  () => import("@uiw/react-md-editor").then((mod) => mod.default.Markdown),
  { ssr: false }
);

// Slack-style toolbar commands (subset of full markdown)
const TOOLBAR_COMMANDS = [
  commands.bold,
  commands.italic,
  commands.strikethrough,
  commands.divider,
  commands.code,
  commands.codeBlock,
  commands.divider,
  commands.link,
  commands.divider,
  commands.unorderedListCommand,
  commands.orderedListCommand,
  commands.divider,
  commands.quote,
];

const createExpandCommand = (onExpand: () => void): ICommand => ({
  name: "expand",
  keyCommand: "expand",
  buttonProps: { "aria-label": "Expand to fullscreen", title: "Expand" },
  icon: <Maximize2 className="w-3.5 h-3.5" />,
  execute: onExpand,
});

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  minHeight?: number;
  className?: string;
  compact?: boolean;
  previewMode?: "edit" | "live" | "preview";
}

export function MarkdownEditor({
  value,
  onChange,
  onBlur,
  placeholder = "Add a description...",
  minHeight = 120,
  className,
  compact = false,
  previewMode = "edit",
}: MarkdownEditorProps) {
  const colorMode = useColorMode();
  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleExpand = useCallback(() => setIsFullscreen(true), []);
  const handleClose = useCallback(() => {
    setIsFullscreen(false);
    onBlur?.();
  }, [onBlur]);

  const handleChange = useCallback(
    (val: string | undefined) => onChange(val || ""),
    [onChange]
  );

  const toolbarCommands = compact
    ? []
    : [...TOOLBAR_COMMANDS, commands.divider, createExpandCommand(handleExpand)];

  return (
    <>
      <div
        data-color-mode={colorMode}
        className={cn(
          "markdown-editor-wrapper",
          compact && "markdown-editor-compact",
          className
        )}
      >
        <MDEditor
          value={value}
          onChange={handleChange}
          onBlur={onBlur}
          preview={previewMode}
          hideToolbar={compact}
          commands={toolbarCommands}
          extraCommands={[]}
          textareaProps={{ placeholder }}
          height={minHeight}
          visibleDragbar={false}
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
          <div
            data-color-mode={colorMode}
            className="markdown-editor-wrapper markdown-editor-fullscreen flex-1 min-h-0"
          >
            <MDEditor
              value={value}
              onChange={handleChange}
              preview="live"
              commands={TOOLBAR_COMMANDS}
              extraCommands={[]}
              textareaProps={{ placeholder, autoFocus: true }}
              height="100%"
              visibleDragbar={false}
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
  const colorMode = useColorMode();

  if (!content) return null;

  return (
    <div
      data-color-mode={colorMode}
      className={cn("markdown-preview-wrapper", className)}
    >
      <MDPreview source={content} />
    </div>
  );
}
