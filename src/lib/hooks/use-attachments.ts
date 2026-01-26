"use client";

import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import {
  getIssueAttachments,
  deleteAttachment,
} from "@/lib/actions/attachments";
import type { AttachmentWithUrl } from "@/lib/types";

interface UploadInitResponse {
  uploadUrl: string;
  storageKey: string;
}

interface ConfirmResponse {
  attachment: AttachmentWithUrl;
}

/**
 * Query hook for fetching attachments for an issue
 */
export function useIssueAttachments(issueId: string | null) {
  return useQuery({
    queryKey: issueId ? queryKeys.issue.attachments(issueId) : ["disabled"],
    queryFn: () =>
      issueId ? getIssueAttachments(issueId) : Promise.resolve([]),
    enabled: !!issueId,
    // Refresh URLs every 10 minutes (before 15 min expiry)
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * Mutation hook for uploading an attachment
 */
export function useUploadAttachment(issueId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: File) => {
      // Step 1: Get presigned upload URL from our API
      const initRes = await fetch("/api/attachments/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issueId,
          filename: file.name,
          mimeType: file.type,
          size: file.size,
        }),
      });

      if (!initRes.ok) {
        const error = await initRes.json();
        throw new Error(error.error || "Failed to initiate upload");
      }

      const { uploadUrl, storageKey }: UploadInitResponse = await initRes.json();

      // Step 2: Upload file directly to R2 using presigned URL
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });

      if (!uploadRes.ok) {
        throw new Error(`Upload failed: ${uploadRes.status}`);
      }

      // Step 3: Confirm upload and create database record
      const confirmRes = await fetch("/api/attachments/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issueId,
          storageKey,
          filename: file.name,
          mimeType: file.type,
          size: file.size,
        }),
      });

      if (!confirmRes.ok) {
        const error = await confirmRes.json();
        throw new Error(error.error || "Failed to confirm upload");
      }

      const { attachment }: ConfirmResponse = await confirmRes.json();
      return attachment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.issue.attachments(issueId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.issue.activities(issueId),
      });
    },
  });
}

/**
 * Mutation hook for deleting an attachment
 */
export function useDeleteAttachment(issueId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (attachmentId: string) => {
      await deleteAttachment(attachmentId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.issue.attachments(issueId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.issue.activities(issueId),
      });
    },
  });
}

/**
 * Hook to get a function that invalidates attachments and activities
 * Useful for refreshing after AI-generated attachments
 */
export function useInvalidateAttachments(issueId: string) {
  const queryClient = useQueryClient();

  return useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.issue.attachments(issueId),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.issue.activities(issueId),
    });
  }, [queryClient, issueId]);
}
