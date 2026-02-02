"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import {
  getIssueSubtasks,
  getSubtaskCount,
  createIssue,
  convertToSubtask,
  convertToIssue,
  updateIssue,
  deleteIssue,
} from "@/lib/actions/issues";
import type { UpdateIssueInput } from "@/lib/types";

// Query hook for fetching subtasks of an issue
export function useIssueSubtasks(
  issueId: string | null,
  options?: { refetchInterval?: number | false }
) {
  return useQuery({
    queryKey: issueId ? queryKeys.issue.subtasks(issueId) : ["disabled"],
    queryFn: () => (issueId ? getIssueSubtasks(issueId) : Promise.resolve([])),
    enabled: !!issueId,
    refetchInterval: options?.refetchInterval,
    refetchIntervalInBackground: false,
  });
}

// Query hook for fetching subtask count (for progress indicators)
export function useSubtaskCount(issueId: string | null) {
  return useQuery({
    queryKey: issueId ? queryKeys.issue.subtaskCount(issueId) : ["disabled"],
    queryFn: () =>
      issueId
        ? getSubtaskCount(issueId)
        : Promise.resolve({ total: 0, completed: 0 }),
    enabled: !!issueId,
  });
}

/**
 * Combined hook for all subtask operations.
 * Encapsulates all subtask mutations with proper cache invalidation.
 */
export function useSubtaskOperations(
  parentIssueId: string,
  workspaceId: string
) {
  const queryClient = useQueryClient();

  const invalidateSubtaskQueries = () => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.issue.subtasks(parentIssueId),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.issue.subtaskCount(parentIssueId),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.board.detail(workspaceId),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.issue.activities(parentIssueId),
    });
  };

  const createSubtask = useMutation({
    mutationFn: async ({
      columnId,
      title,
    }: {
      columnId: string;
      title: string;
    }) => {
      return createIssue(columnId, {
        title,
        parentIssueId,
      });
    },
    onSuccess: invalidateSubtaskQueries,
  });

  const updateSubtask = useMutation({
    mutationFn: async ({
      subtaskId,
      data,
    }: {
      subtaskId: string;
      data: UpdateIssueInput;
    }) => {
      return updateIssue(subtaskId, data);
    },
    onSuccess: invalidateSubtaskQueries,
  });

  const removeSubtask = useMutation({
    mutationFn: async (subtaskId: string) => {
      return deleteIssue(subtaskId);
    },
    onSuccess: invalidateSubtaskQueries,
  });

  const promoteToIssue = useMutation({
    mutationFn: async ({
      subtaskId,
      columnId,
    }: {
      subtaskId: string;
      columnId: string;
    }) => {
      return convertToIssue(subtaskId, columnId);
    },
    onSuccess: invalidateSubtaskQueries,
  });

  return {
    createSubtask,
    updateSubtask,
    removeSubtask,
    promoteToIssue,
  };
}

// Mutation hook for converting an issue to a subtask
export function useConvertToSubtask(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      issueId,
      parentIssueId,
    }: {
      issueId: string;
      parentIssueId: string;
    }) => {
      return convertToSubtask(issueId, parentIssueId);
    },
    onSuccess: (_, { parentIssueId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.board.detail(workspaceId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.issue.subtasks(parentIssueId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.issue.subtaskCount(parentIssueId),
      });
    },
  });
}

// Hook to get a function that invalidates subtask queries
export function useInvalidateSubtasks(issueId: string) {
  const queryClient = useQueryClient();

  return () => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.issue.subtasks(issueId),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.issue.subtaskCount(issueId),
    });
  };
}
