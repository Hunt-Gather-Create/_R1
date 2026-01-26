"use client";

import { useState, useRef, useCallback } from "react";
import { Upload, Plus, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { AttachmentItem } from "./AttachmentItem";
import { AttachmentPreview } from "./AttachmentPreview";
import {
  useIssueAttachments,
  useUploadAttachment,
  useDeleteAttachment,
} from "@/lib/hooks";
import {
  validateFile,
  getAllowedExtensions,
  getAllowedMimeTypesString,
} from "@/lib/storage/file-validation";
import type { AttachmentWithUrl, IssueWithLabels } from "@/lib/types";

interface AttachmentListProps {
  issue: IssueWithLabels;
  className?: string;
}

export function AttachmentList({ issue, className }: AttachmentListProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewAttachment, setPreviewAttachment] =
    useState<AttachmentWithUrl | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: attachments = [], isLoading } = useIssueAttachments(issue.id);
  const uploadMutation = useUploadAttachment(issue.id);
  const deleteMutation = useDeleteAttachment(issue.id);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      setError(null);
      const fileArray = Array.from(files);

      for (const file of fileArray) {
        const validationError = validateFile({
          type: file.type,
          size: file.size,
          name: file.name,
        });

        if (validationError) {
          setError(validationError);
          continue;
        }

        try {
          await uploadMutation.mutateAsync(file);
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Failed to upload file"
          );
        }
      }
    },
    [uploadMutation]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        handleFiles(files);
      }
    },
    [handleFiles]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        handleFiles(files);
      }
      // Reset input so the same file can be selected again
      e.target.value = "";
    },
    [handleFiles]
  );

  const handleDelete = useCallback(
    async (attachmentId: string) => {
      setDeletingId(attachmentId);
      try {
        await deleteMutation.mutateAsync(attachmentId);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to delete attachment"
        );
      } finally {
        setDeletingId(null);
      }
    },
    [deleteMutation]
  );

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className={cn("space-y-3", className)}>
      {/* Error message */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-md p-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-destructive hover:text-destructive/80"
          >
            &times;
          </button>
        </div>
      )}

      {/* Attachment grid */}
      {attachments.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {attachments.map((attachment) => (
            <AttachmentItem
              key={attachment.id}
              attachment={attachment}
              onPreview={() => setPreviewAttachment(attachment)}
              onDelete={() => handleDelete(attachment.id)}
              isDeleting={deletingId === attachment.id}
            />
          ))}
        </div>
      )}

      {/* Drop zone / Upload button */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "relative border-2 border-dashed rounded-md transition-colors",
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-muted-foreground/50",
          uploadMutation.isPending && "pointer-events-none"
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={`${getAllowedMimeTypesString()},${getAllowedExtensions()}`}
          onChange={handleFileSelect}
          className="hidden"
        />

        {uploadMutation.isPending ? (
          <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Uploading...</span>
          </div>
        ) : (
          <button
            onClick={openFilePicker}
            className={cn(
              "flex items-center justify-center gap-2 w-full py-4 text-sm",
              isDragging
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {isDragging ? (
              <>
                <Upload className="w-4 h-4" />
                <span>Drop files here</span>
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                <span>Add attachment</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* File type hint */}
      <p className="text-[10px] text-muted-foreground text-center">
        Images, PDFs, and documents up to 10MB
      </p>

      {/* Loading state */}
      {isLoading && attachments.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-2">
          Loading attachments...
        </p>
      )}

      {/* Preview modal */}
      <AttachmentPreview
        attachment={previewAttachment}
        open={!!previewAttachment}
        onOpenChange={(open) => !open && setPreviewAttachment(null)}
      />
    </div>
  );
}
