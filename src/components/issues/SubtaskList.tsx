"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { Plus, Sparkles, Play, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SubtaskItem } from "./SubtaskItem";
import { SuggestedSubtaskItem } from "./SuggestedSubtaskItem";
import { useBoardContext } from "@/components/board/context";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import {
  useIssueSubtasks,
  useSubtaskOperations,
  useAISuggestions,
  useAddSuggestionAsSubtask,
  useAddAllSuggestionsAsSubtasks,
  useDismissSuggestion,
  useUpdateAITaskDetails,
  useExecuteAITask,
  useExecuteAllAITasks,
} from "@/lib/hooks";
import { toggleAIAssignable } from "@/lib/actions/issues";
import type { IssueWithLabels, AIExecutionStatus } from "@/lib/types";
import { toast } from "sonner";

interface SubtaskListProps {
  issue: IssueWithLabels;
  className?: string;
}

export function SubtaskList({ issue, className }: SubtaskListProps) {
  const [isAddingSubtask, setIsAddingSubtask] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Get workspaceId from context instead of props
  const { board } = useBoardContext();
  const workspaceId = board.id;
  const queryClient = useQueryClient();

  // Check if there are running AI tasks to enable polling
  const [hasRunningTasks, setHasRunningTasks] = useState(false);

  const { data: subtasks = [], isLoading } = useIssueSubtasks(issue.id, {
    // Poll every 3 seconds while tasks are running
    refetchInterval: hasRunningTasks ? 3000 : false,
  });
  const { createSubtask, updateSubtask, removeSubtask, promoteToIssue } =
    useSubtaskOperations(issue.id, workspaceId);

  // AI suggestions
  const { data: suggestions = [] } = useAISuggestions(issue.id);
  const addSuggestion = useAddSuggestionAsSubtask(issue.id, workspaceId);
  const addAllSuggestions = useAddAllSuggestionsAsSubtasks(issue.id, workspaceId);
  const dismissSuggestion = useDismissSuggestion(issue.id);
  const updateAITaskDetails = useUpdateAITaskDetails(issue.id, workspaceId);

  // AI task execution
  const executeAITask = useExecuteAITask(issue.id, workspaceId);
  const executeAllAITasks = useExecuteAllAITasks(issue.id, workspaceId);
  const [runningTaskIds, setRunningTaskIds] = useState<Set<string>>(new Set());

  // Check if there are any runnable AI subtasks (pending or null status)
  const runnableAISubtasks = useMemo(() => {
    return subtasks.filter((s) => {
      if (!s.aiAssignable) return false;
      const status = s.aiExecutionStatus as AIExecutionStatus;
      return status === null || status === "pending" || status === "failed";
    });
  }, [subtasks]);

  const hasRunnableAITasks = runnableAISubtasks.length > 0;

  // Track running tasks for polling and completion detection
  const runningAITasks = useMemo(() => {
    return subtasks.filter((s) => {
      if (!s.aiAssignable) return false;
      const status = s.aiExecutionStatus as AIExecutionStatus;
      return status === "pending" || status === "running";
    });
  }, [subtasks]);

  // Track previous running task IDs to detect completions
  const previousRunningIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const currentRunningIds = new Set(runningAITasks.map((t) => t.id));
    const previousRunningIds = previousRunningIdsRef.current;

    // Check for tasks that just completed (were running, now aren't)
    const completedTaskIds = [...previousRunningIds].filter(
      (id) => !currentRunningIds.has(id)
    );

    if (completedTaskIds.length > 0) {
      // Invalidate attachments for the parent issue when tasks complete
      queryClient.invalidateQueries({
        queryKey: queryKeys.issue.attachments(issue.id),
      });
      // Also refresh activities
      queryClient.invalidateQueries({
        queryKey: queryKeys.issue.activities(issue.id),
      });
    }

    // Update previous running IDs
    previousRunningIdsRef.current = currentRunningIds;

    // Update polling state
    setHasRunningTasks(currentRunningIds.size > 0);
  }, [runningAITasks, queryClient, issue.id]);

  useEffect(() => {
    if (isAddingSubtask && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isAddingSubtask]);

  const handleAddSubtask = async () => {
    if (!newSubtaskTitle.trim()) return;

    await createSubtask.mutateAsync({
      columnId: issue.columnId,
      title: newSubtaskTitle.trim(),
    });

    setNewSubtaskTitle("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddSubtask();
    } else if (e.key === "Escape") {
      setIsAddingSubtask(false);
      setNewSubtaskTitle("");
    }
  };

  const handleToggleAI = async (subtaskId: string, aiAssignable: boolean) => {
    await toggleAIAssignable(subtaskId, aiAssignable);
  };

  const handleRunAITask = async (subtaskId: string) => {
    setRunningTaskIds((prev) => new Set(prev).add(subtaskId));
    try {
      await executeAITask.mutateAsync(subtaskId);
      toast.success("AI task started", {
        description: "The task is running in the background.",
      });
    } catch (error) {
      toast.error("Failed to start AI task", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setRunningTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(subtaskId);
        return next;
      });
    }
  };

  const handleRunAllAITasks = async () => {
    try {
      const result = await executeAllAITasks.mutateAsync();
      if (!result.runId) {
        toast.info("No tasks to run", {
          description: "All AI tasks are already completed or running.",
        });
      } else {
        toast.success("Started AI tasks", {
          description: "Tasks are running sequentially in the background.",
        });
      }
    } catch (error) {
      toast.error("Failed to start AI tasks", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  return (
    <div className={cn("space-y-2", className)}>
      {/* Subtask list header with Run All button */}
      {subtasks.length > 0 && hasRunnableAITasks && (
        <div className="flex items-center justify-between pb-1">
          <span className="text-xs text-muted-foreground">Subtasks</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleRunAllAITasks}
            disabled={executeAllAITasks.isPending}
            className="h-6 px-2 text-xs gap-1"
          >
            {executeAllAITasks.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Play className="w-3 h-3" />
            )}
            Run All AI Tasks
          </Button>
        </div>
      )}

      {/* Subtask list */}
      {subtasks.length > 0 && (
        <div className="space-y-2">
          {subtasks.map((subtask) => (
            <SubtaskItem
              key={subtask.id}
              subtask={subtask}
              onUpdate={(data) =>
                updateSubtask.mutate({ subtaskId: subtask.id, data })
              }
              onDelete={() => removeSubtask.mutate(subtask.id)}
              onConvertToIssue={() =>
                promoteToIssue.mutate({
                  subtaskId: subtask.id,
                  columnId: issue.columnId,
                })
              }
              onToggleAI={(aiAssignable) =>
                handleToggleAI(subtask.id, aiAssignable)
              }
              onUpdateAIInstructions={(instructions) =>
                updateAITaskDetails.mutate({
                  issueId: subtask.id,
                  data: { aiInstructions: instructions },
                })
              }
              onRunAITask={
                subtask.aiAssignable
                  ? () => handleRunAITask(subtask.id)
                  : undefined
              }
              isRunning={runningTaskIds.has(subtask.id)}
            />
          ))}
        </div>
      )}

      {/* AI Suggestions (ghost subtasks) */}
      {suggestions.length > 0 && (
        <div className="space-y-2 pt-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-purple-500" />
              AI Suggestions
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => addAllSuggestions.mutate()}
              disabled={addAllSuggestions.isPending}
              className="h-6 px-2 text-xs"
            >
              <Plus className="w-3 h-3 mr-1" />
              Add All
            </Button>
          </div>
          <div className="space-y-2">
            {suggestions.map((suggestion) => (
              <SuggestedSubtaskItem
                key={suggestion.id}
                suggestion={suggestion}
                onAdd={() => addSuggestion.mutate(suggestion.id)}
                onDismiss={() => dismissSuggestion.mutate(suggestion.id)}
                isAdding={addSuggestion.isPending}
              />
            ))}
          </div>
        </div>
      )}

      {/* Add subtask input */}
      {isAddingSubtask ? (
        <div className="flex items-center gap-2 px-3 py-2 border border-border rounded-md bg-muted/30">
          <Plus className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={newSubtaskTitle}
            onChange={(e) => setNewSubtaskTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              if (!newSubtaskTitle.trim()) {
                setIsAddingSubtask(false);
              }
            }}
            placeholder="Subtask title..."
            className={cn(
              "flex-1 text-sm bg-transparent border-none outline-none",
              "focus:ring-0 placeholder:text-muted-foreground"
            )}
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setIsAddingSubtask(false);
              setNewSubtaskTitle("");
            }}
            className="h-6 px-2 text-xs"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleAddSubtask}
            disabled={!newSubtaskTitle.trim() || createSubtask.isPending}
            className="h-6 px-2 text-xs"
          >
            Add
          </Button>
        </div>
      ) : (
        <button
          onClick={() => setIsAddingSubtask(true)}
          className={cn(
            "flex items-center gap-2 w-full px-3 py-2 text-sm text-muted-foreground",
            "hover:bg-accent/50 rounded-md transition-colors"
          )}
        >
          <Plus className="w-4 h-4" />
          Add subtask
        </button>
      )}

      {/* Loading state */}
      {isLoading && subtasks.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-2">
          Loading subtasks...
        </p>
      )}
    </div>
  );
}
