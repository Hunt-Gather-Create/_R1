"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { createKnowledgeImageUpload } from "@/lib/actions/knowledge";

/**
 * Shared hook for uploading images via knowledge assets (R2).
 * Works in any context — no documentId required.
 */
export function useUploadImage(workspaceId: string) {
  return useCallback(
    async (file: File): Promise<string> => {
      try {
        const upload = await createKnowledgeImageUpload({
          workspaceId,
          filename: file.name,
          mimeType: file.type || "image/png",
          size: file.size,
        });

        const res = await fetch(upload.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type || "image/png" },
          body: file,
        });

        if (!res.ok) {
          throw new Error("Failed to upload image to storage");
        }

        toast.success("Image uploaded");
        return upload.imageMarkdownUrl;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Image upload failed";
        toast.error(message);
        throw new Error(message);
      }
    },
    [workspaceId],
  );
}
