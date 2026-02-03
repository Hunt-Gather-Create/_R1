"use client";

import { X, Sparkles, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIssueFormContext, type SuggestedSubtask } from "./context";
import { PriorityIcon } from "./PriorityIcon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface SuggestedSubtaskItemProps {
  suggestion: SuggestedSubtask;
  onRemove: () => void;
}

function SuggestedSubtaskItem({
  suggestion,
  onRemove,
}: SuggestedSubtaskItemProps) {
  return (
    <div
      className={cn(
        "group border border-dashed border-border/50 rounded-md",
        "bg-muted/20 hover:bg-muted/40 transition-colors"
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        {/* AI indicator */}
        <span className="text-purple-500 shrink-0">
          <Sparkles className="w-3.5 h-3.5" />
        </span>

        {/* Priority icon */}
        <PriorityIcon priority={suggestion.priority} size="sm" />

        {/* Title */}
        <span className="flex-1 text-sm truncate">{suggestion.title}</span>

        {/* Remove button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onRemove}
              className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            Remove
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Description preview if available */}
      {suggestion.description && (
        <div className="px-3 pb-2 pt-0">
          <p className="text-xs text-muted-foreground/70 line-clamp-2">
            {suggestion.description}
          </p>
        </div>
      )}
    </div>
  );
}

export function SuggestedSubtaskList() {
  const {
    suggestedSubtasks,
    removeSuggestedSubtask,
    clearSuggestedSubtasks,
    highlightSubtasks,
  } = useIssueFormContext();

  if (suggestedSubtasks.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "transition-all duration-500 rounded-md",
        highlightSubtasks &&
          "ring-2 ring-primary ring-offset-2 ring-offset-background"
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-purple-500" />
          Suggested Subtasks
          <span className="text-muted-foreground/60">
            ({suggestedSubtasks.length})
          </span>
        </label>
        {suggestedSubtasks.length > 1 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={clearSuggestedSubtasks}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                Clear all
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              Remove all suggested subtasks
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      <div className="space-y-2">
        {suggestedSubtasks.map((suggestion) => (
          <SuggestedSubtaskItem
            key={suggestion.id}
            suggestion={suggestion}
            onRemove={() => removeSuggestedSubtask(suggestion.id)}
          />
        ))}
      </div>

      <p className="text-xs text-muted-foreground/60 mt-2">
        These subtasks will be created when you submit the issue.
      </p>
    </div>
  );
}
