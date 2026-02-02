"use client";

import { Plus, X, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AISuggestionWithTools } from "@/lib/types";
import type { Priority } from "@/lib/design-tokens";
import { PriorityIcon } from "./PriorityIcon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface SuggestedSubtaskItemProps {
  suggestion: AISuggestionWithTools;
  onAdd: () => void;
  onDismiss: () => void;
  isAdding?: boolean;
}

export function SuggestedSubtaskItem({
  suggestion,
  onAdd,
  onDismiss,
  isAdding,
}: SuggestedSubtaskItemProps) {
  return (
    <div
      className={cn(
        "group border border-dashed border-border/50 rounded-md opacity-75 hover:opacity-100 transition-opacity",
        "bg-muted/20 hover:bg-muted/40"
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        {/* AI indicator */}
        <span className="text-purple-500 shrink-0">
          <Sparkles className="w-3.5 h-3.5" />
        </span>

        {/* Priority icon */}
        <PriorityIcon priority={suggestion.priority as Priority} size="sm" />

        {/* Title */}
        <span className="flex-1 text-sm text-muted-foreground truncate">
          {suggestion.title}
        </span>

        {/* Tools hint */}
        {suggestion.toolsRequired && suggestion.toolsRequired.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-[10px] text-muted-foreground/60 shrink-0">
                {suggestion.toolsRequired.length} tool
                {suggestion.toolsRequired.length > 1 ? "s" : ""}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {suggestion.toolsRequired.join(", ")}
            </TooltipContent>
          </Tooltip>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onDismiss}
                disabled={isAdding}
                className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              Dismiss
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onAdd}
                disabled={isAdding}
                className={cn(
                  "p-1 hover:bg-primary/10 rounded text-primary transition-colors",
                  isAdding && "opacity-50 cursor-not-allowed"
                )}
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              Add as AI subtask
            </TooltipContent>
          </Tooltip>
        </div>
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
