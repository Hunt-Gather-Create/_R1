"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import {
  createKnowledgeDocument,
  createKnowledgeDocumentUpload,
  finalizeKnowledgeDocumentUpload,
  createKnowledgeFolder,
  deleteKnowledgeFolder,
  deleteKnowledgeDocument,
  getIssueKnowledgeDocuments,
  getKnowledgeDocument,
  getKnowledgeDocuments,
  getKnowledgeFolders,
  getKnowledgeTags,
  linkKnowledgeDocumentToIssue,
  moveKnowledgeDocument,
  moveKnowledgeFolder,
  renameKnowledgeDocument,
  renameKnowledgeFolder,
  unlinkKnowledgeDocumentFromIssue,
  updateKnowledgeDocument,
} from "@/lib/actions/knowledge";

export function useKnowledgeFolders(workspaceId: string | null) {
  return useQuery({
    queryKey: workspaceId ? queryKeys.knowledge.folders(workspaceId) : ["disabled"],
    queryFn: () =>
      workspaceId ? getKnowledgeFolders(workspaceId) : Promise.resolve([]),
    enabled: !!workspaceId,
  });
}

export function useKnowledgeDocuments(input: {
  workspaceId: string | null;
  folderId?: string | null;
  tag?: string | null;
  query?: string | null;
}) {
  return useQuery({
    queryKey: input.workspaceId
      ? queryKeys.knowledge.documents(
          input.workspaceId,
          input.folderId,
          input.tag,
          input.query
        )
      : ["disabled"],
    queryFn: () =>
      input.workspaceId
        ? getKnowledgeDocuments({
            workspaceId: input.workspaceId,
            folderId: input.folderId,
            tag: input.tag,
            query: input.query,
          })
        : Promise.resolve([]),
    enabled: !!input.workspaceId,
  });
}

export function useKnowledgeDocument(documentId: string | null) {
  return useQuery({
    queryKey: documentId ? queryKeys.knowledge.document(documentId) : ["disabled"],
    queryFn: () =>
      documentId ? getKnowledgeDocument(documentId) : Promise.resolve(null),
    enabled: !!documentId,
  });
}

export function useKnowledgeTags(workspaceId: string | null) {
  return useQuery({
    queryKey: workspaceId ? queryKeys.knowledge.tags(workspaceId) : ["disabled"],
    queryFn: () => (workspaceId ? getKnowledgeTags(workspaceId) : Promise.resolve([])),
    enabled: !!workspaceId,
  });
}

export function useCreateKnowledgeFolder(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; parentFolderId?: string | null }) =>
      createKnowledgeFolder({
        workspaceId,
        name: input.name,
        parentFolderId: input.parentFolderId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.folders(workspaceId) });
    },
  });
}

export function useCreateKnowledgeDocument(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; content: string; folderId?: string | null }) =>
      createKnowledgeDocument({
        workspaceId,
        title: input.title,
        content: input.content,
        folderId: input.folderId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.documents(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.tags(workspaceId) });
    },
  });
}

export function useCreateKnowledgeDocumentUpload(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      filename: string;
      mimeType: string;
      size: number;
      folderId?: string | null;
    }) =>
      createKnowledgeDocumentUpload({
        workspaceId,
        filename: input.filename,
        mimeType: input.mimeType,
        size: input.size,
        folderId: input.folderId,
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.documents(workspaceId) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.knowledge.document(result.document.id),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.tags(workspaceId) });
    },
  });
}

export function useFinalizeKnowledgeDocumentUpload(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => finalizeKnowledgeDocumentUpload(documentId),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.documents(workspaceId) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.knowledge.document(result.documentId),
      });
    },
  });
}

export function useUpdateKnowledgeDocument(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      documentId: string;
      title: string;
      content: string;
      folderId?: string | null;
    }) => updateKnowledgeDocument(input),
    onSuccess: (doc) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.documents(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.document(doc.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.tags(workspaceId) });
    },
  });
}

export function useDeleteKnowledgeDocument(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => deleteKnowledgeDocument(documentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.documents(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.tags(workspaceId) });
    },
  });
}

export function useDeleteKnowledgeFolder(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (folderId: string) => deleteKnowledgeFolder(folderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.folders(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.documents(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.tags(workspaceId) });
    },
  });
}

export function useMoveKnowledgeDocument(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { documentId: string; targetFolderId: string | null }) =>
      moveKnowledgeDocument(input),
    onSuccess: (doc) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.documents(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.document(doc.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.folders(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.tags(workspaceId) });
    },
  });
}

export function useRenameKnowledgeDocument(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { documentId: string; title: string }) =>
      renameKnowledgeDocument(input),
    onSuccess: (doc) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.documents(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.document(doc.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.folders(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.tags(workspaceId) });
    },
  });
}

export function useMoveKnowledgeFolder(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { folderId: string; targetParentFolderId: string | null }) =>
      moveKnowledgeFolder(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.folders(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.documents(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.tags(workspaceId) });
    },
  });
}

export function useRenameKnowledgeFolder(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { folderId: string; name: string }) => renameKnowledgeFolder(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.folders(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.documents(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.tags(workspaceId) });
    },
  });
}

export function useIssueKnowledgeLinks(issueId: string | null) {
  return useQuery({
    queryKey: issueId ? queryKeys.knowledge.issueLinks(issueId) : ["disabled"],
    queryFn: () =>
      issueId ? getIssueKnowledgeDocuments(issueId) : Promise.resolve([]),
    enabled: !!issueId,
  });
}

export function useLinkKnowledgeToIssue(issueId: string, workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => linkKnowledgeDocumentToIssue(issueId, documentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.issueLinks(issueId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.documents(workspaceId) });
    },
  });
}

export function useUnlinkKnowledgeFromIssue(issueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) =>
      unlinkKnowledgeDocumentFromIssue(issueId, documentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.issueLinks(issueId) });
    },
  });
}
