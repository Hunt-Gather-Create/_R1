"use client";

import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import {
  getAISuggestions,
  addSuggestionAsSubtask,
  addAllSuggestionsAsSubtasks,
  dismissAISuggestion,
  dismissAllAISuggestions,
} from "@/lib/actions/ai-suggestions";
import { toggleAIAssignable, updateAITaskDetails } from "@/lib/actions/issues";

// Query hook for fetching AI suggestions for an issue
export function useAISuggestions(issueId: string | null) {
  return useQuery({
    queryKey: issueId ? queryKeys.issue.aiSuggestions(issueId) : ["disabled"],
    queryFn: () => (issueId ? getAISuggestions(issueId) : Promise.resolve([])),
    enabled: !!issueId,
  });
}

// Hook to invalidate AI suggestions query (for use after tool calls)
export function useInvalidateAISuggestions(issueId: string) {
  const queryClient = useQueryClient();

  return useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.issue.aiSuggestions(issueId),
    });
  }, [queryClient, issueId]);
}

// Mutation hook for converting a suggestion to a subtask
export function useAddSuggestionAsSubtask(
  issueId: string,
  workspaceId: string
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (suggestionId: string) => addSuggestionAsSubtask(suggestionId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.issue.aiSuggestions(issueId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.issue.subtasks(issueId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.issue.subtaskCount(issueId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.board.detail(workspaceId),
      });
    },
  });
}

// Mutation hook for adding all suggestions as subtasks
export function useAddAllSuggestionsAsSubtasks(
  issueId: string,
  workspaceId: string
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => addAllSuggestionsAsSubtasks(issueId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.issue.aiSuggestions(issueId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.issue.subtasks(issueId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.issue.subtaskCount(issueId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.board.detail(workspaceId),
      });
    },
  });
}

// Mutation hook for dismissing a suggestion
export function useDismissSuggestion(issueId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (suggestionId: string) => dismissAISuggestion(suggestionId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.issue.aiSuggestions(issueId),
      });
    },
  });
}

// Mutation hook for dismissing all suggestions
export function useDismissAllSuggestions(issueId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => dismissAllAISuggestions(issueId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.issue.aiSuggestions(issueId),
      });
    },
  });
}

// Mutation hook for toggling AI assignable flag
export function useToggleAIAssignable(issueId: string, workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (aiAssignable: boolean) =>
      toggleAIAssignable(issueId, aiAssignable),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.issue.subtasks(issueId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.board.detail(workspaceId),
      });
    },
  });
}

// Mutation hook for updating AI task details (instructions, tools)
export function useUpdateAITaskDetails(
  parentIssueId: string,
  workspaceId: string
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      issueId,
      data,
    }: {
      issueId: string;
      data: { aiInstructions?: string | null; aiTools?: string[] | null };
    }) => updateAITaskDetails(issueId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.issue.subtasks(parentIssueId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.board.detail(workspaceId),
      });
    },
  });
}
