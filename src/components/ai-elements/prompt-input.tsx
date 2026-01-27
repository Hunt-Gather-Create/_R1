"use client";

import * as React from "react";
import TextareaAutosize from "react-textarea-autosize";
import { ArrowUp, Loader2, Paperclip, X, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

interface PromptInputContextValue {
  value: string;
  setValue: (value: string) => void;
  isLoading: boolean;
  onSubmit: () => void;
  files: File[];
  setFiles: (files: File[]) => void;
}

const PromptInputContext = React.createContext<PromptInputContextValue | null>(
  null
);

function usePromptInput() {
  const context = React.useContext(PromptInputContext);
  if (!context) {
    throw new Error("usePromptInput must be used within PromptInput");
  }
  return context;
}

interface PromptInputProps extends React.FormHTMLAttributes<HTMLFormElement> {
  value: string;
  onValueChange: (value: string) => void;
  isLoading?: boolean;
  onSubmit: () => void;
  files?: File[];
  onFilesChange?: (files: File[]) => void;
}

export function PromptInput({
  value,
  onValueChange,
  isLoading = false,
  onSubmit,
  files = [],
  onFilesChange,
  className,
  children,
  ...props
}: PromptInputProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((value.trim() || files.length > 0) && !isLoading) {
      onSubmit();
    }
  };

  const handleSetFiles = React.useCallback(
    (newFiles: File[]) => {
      onFilesChange?.(newFiles);
    },
    [onFilesChange]
  );

  return (
    <PromptInputContext.Provider
      value={{
        value,
        setValue: onValueChange,
        isLoading,
        onSubmit,
        files,
        setFiles: handleSetFiles,
      }}
    >
      <form
        onSubmit={handleSubmit}
        className={cn(
          "flex flex-col gap-2 rounded-lg border border-border bg-muted/50 p-2",
          className
        )}
        {...props}
      >
        {children}
      </form>
    </PromptInputContext.Provider>
  );
}

interface PromptInputTextareaProps {
  placeholder?: string;
  rows?: number;
  className?: string;
}

export const PromptInputTextarea = React.forwardRef<
  HTMLTextAreaElement,
  PromptInputTextareaProps
>(({ className, placeholder, rows = 1 }, ref) => {
  const { value, setValue, isLoading, onSubmit } = usePromptInput();

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !isLoading) {
        onSubmit();
      }
    }
  };

  return (
    <TextareaAutosize
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      disabled={isLoading}
      placeholder={placeholder}
      minRows={rows}
      className={cn(
        "flex-1 resize-none bg-transparent text-sm",
        "placeholder:text-muted-foreground",
        "focus:outline-none",
        "disabled:opacity-50",
        "min-h-[40px] max-h-[200px] py-2 px-2",
        className
      )}
    />
  );
});

PromptInputTextarea.displayName = "PromptInputTextarea";

type PromptInputSubmitProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export function PromptInputSubmit({
  className,
  children,
  ...props
}: PromptInputSubmitProps) {
  const { value, isLoading, files } = usePromptInput();
  const canSubmit = (value.trim() || files.length > 0) && !isLoading;

  return (
    <button
      type="submit"
      disabled={!canSubmit}
      className={cn(
        "flex items-center justify-center",
        "h-8 w-8 rounded-md",
        "bg-primary text-primary-foreground",
        "hover:bg-primary/90",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        "transition-colors",
        className
      )}
      {...props}
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        children || <ArrowUp className="h-4 w-4" />
      )}
    </button>
  );
}

interface PromptInputAttachmentButtonProps {
  className?: string;
  accept?: string;
}

export function PromptInputAttachmentButton({
  className,
  accept = "image/*,text/*,.pdf,.md,.json,.csv",
}: PromptInputAttachmentButtonProps) {
  const { files, setFiles, isLoading } = usePromptInput();
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (selectedFiles) {
      setFiles([...files, ...Array.from(selectedFiles)]);
    }
    // Reset input so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={isLoading}
        className={cn(
          "flex items-center justify-center",
          "h-8 w-8 rounded-md",
          "text-muted-foreground hover:text-foreground hover:bg-muted",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          "transition-colors",
          files.length > 0 && "text-primary",
          className
        )}
        title="Attach files"
      >
        <Paperclip className="h-4 w-4" />
      </button>
    </>
  );
}

export function PromptInputFilePreviews({ className }: { className?: string }) {
  const { files, setFiles } = usePromptInput();

  const removeFile = (index: number) => {
    setFiles(files.filter((_, i) => i !== index));
  };

  const getFilePreview = (file: File) => {
    if (file.type.startsWith("image/")) {
      return URL.createObjectURL(file);
    }
    return null;
  };

  if (files.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {files.map((file, index) => {
        const imagePreview = getFilePreview(file);
        const isImage = file.type.startsWith("image/");

        return (
          <div
            key={`${file.name}-${index}`}
            className="relative group flex items-center gap-2 px-2 py-1.5 rounded-md bg-background border border-border"
          >
            {isImage && imagePreview ? (
              <img
                src={imagePreview}
                alt={file.name}
                className="w-10 h-10 object-cover rounded"
                onLoad={() => URL.revokeObjectURL(imagePreview)}
              />
            ) : (
              <div className="flex items-center justify-center w-10 h-10 rounded bg-muted">
                <FileText className="w-5 h-5 text-muted-foreground" />
              </div>
            )}
            <span className="text-xs text-muted-foreground max-w-[100px] truncate">
              {file.name}
            </span>
            <button
              type="button"
              onClick={() => removeFile(index)}
              className="p-0.5 rounded-full bg-muted hover:bg-destructive hover:text-destructive-foreground transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

interface PromptInputActionsProps {
  children: React.ReactNode;
  className?: string;
}

export function PromptInputActions({ children, className }: PromptInputActionsProps) {
  return (
    <div className={cn("flex items-center justify-between", className)}>
      {children}
    </div>
  );
}
