"use client";

import { useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import {
  executeAITask,
  executeAllAITasks,
  getAITaskStatus,
} from "@/lib/actions/ai-task-execution";
import type { AIExecutionStatus } from "@/lib/types";

/**
 * Hook to execute a single AI task
 */
export function useExecuteAITask(parentIssueId: string, workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (issueId: string) => executeAITask(issueId),
    onSuccess: () => {
      // Invalidate subtasks to refresh status
      queryClient.invalidateQueries({
        queryKey: queryKeys.issue.subtasks(parentIssueId),
      });
      // Invalidate board to refresh issue display
      queryClient.invalidateQueries({
        queryKey: queryKeys.board.detail(workspaceId),
      });
    },
  });
}

/**
 * Hook to execute all AI tasks for a parent issue
 */
export function useExecuteAllAITasks(parentIssueId: string, workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => executeAllAITasks(parentIssueId),
    onSuccess: () => {
      // Invalidate subtasks to refresh status
      queryClient.invalidateQueries({
        queryKey: queryKeys.issue.subtasks(parentIssueId),
      });
      // Invalidate board to refresh issue display
      queryClient.invalidateQueries({
        queryKey: queryKeys.board.detail(workspaceId),
      });
    },
  });
}

/**
 * Hook to poll AI task status with auto-stop on completion
 */
export function useAITaskStatus(
  issueId: string | null,
  options: {
    pollInterval?: number;
    enabled?: boolean;
    onStatusChange?: (status: AIExecutionStatus) => void;
  } = {}
) {
  const { pollInterval = 3000, enabled = true, onStatusChange } = options;
  const previousStatusRef = useRef<AIExecutionStatus>(null);

  const query = useQuery({
    queryKey: issueId ? queryKeys.issue.aiTaskStatus(issueId) : ["disabled"],
    queryFn: () => (issueId ? getAITaskStatus(issueId) : Promise.reject("No issue ID")),
    enabled: !!issueId && enabled,
    // Only refetch while status is "pending" or "running"
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      // Stop polling if completed or failed
      if (status === "completed" || status === "failed") {
        return false;
      }
      // Poll while pending or running
      if (status === "pending" || status === "running") {
        return pollInterval;
      }
      return false;
    },
    refetchIntervalInBackground: false,
  });

  // Track status changes using ref to avoid setState in effect
  useEffect(() => {
    if (query.data?.status && query.data.status !== previousStatusRef.current) {
      previousStatusRef.current = query.data.status;
      onStatusChange?.(query.data.status);
    }
  }, [query.data?.status, onStatusChange]);

  return query;
}

/**
 * Hook to invalidate AI task status query
 */
export function useInvalidateAITaskStatus(issueId: string) {
  const queryClient = useQueryClient();

  return useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.issue.aiTaskStatus(issueId),
    });
  }, [queryClient, issueId]);
}
