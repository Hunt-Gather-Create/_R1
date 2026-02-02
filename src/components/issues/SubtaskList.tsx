"use client";

import { useState, useRef, useEffect } from "react";
import { Plus, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SubtaskItem } from "./SubtaskItem";
import { SuggestedSubtaskItem } from "./SuggestedSubtaskItem";
import { useBoardContext } from "@/components/board/context";
import {
  useIssueSubtasks,
  useSubtaskOperations,
  useAISuggestions,
  useAddSuggestionAsSubtask,
  useAddAllSuggestionsAsSubtasks,
  useDismissSuggestion,
  useUpdateAITaskDetails,
} from "@/lib/hooks";
import { toggleAIAssignable } from "@/lib/actions/issues";
import type { IssueWithLabels } from "@/lib/types";

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

  const { data: subtasks = [], isLoading } = useIssueSubtasks(issue.id);
  const { createSubtask, updateSubtask, removeSubtask, promoteToIssue } =
    useSubtaskOperations(issue.id, workspaceId);

  // AI suggestions
  const { data: suggestions = [] } = useAISuggestions(issue.id);
  const addSuggestion = useAddSuggestionAsSubtask(issue.id, workspaceId);
  const addAllSuggestions = useAddAllSuggestionsAsSubtasks(issue.id, workspaceId);
  const dismissSuggestion = useDismissSuggestion(issue.id);
  const updateAITaskDetails = useUpdateAITaskDetails(issue.id, workspaceId);

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

  return (
    <div className={cn("space-y-2", className)}>
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
