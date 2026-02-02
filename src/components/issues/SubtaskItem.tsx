"use client";

import { useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  MoreHorizontal,
  Trash2,
  ExternalLink,
  Sparkles,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusSelect } from "./properties/StatusSelect";
import { PrioritySelect } from "./properties/PrioritySelect";
import { PriorityIcon } from "./PriorityIcon";
import { AISubtaskBadge } from "./AISubtaskBadge";
import { STATUS, type Status, type Priority } from "@/lib/design-tokens";
import type { IssueWithLabels, UpdateIssueInput, AIExecutionStatus } from "@/lib/types";

export interface SubtaskItemProps {
  subtask: IssueWithLabels;
  onUpdate: (data: UpdateIssueInput) => void;
  onDelete: () => void;
  onConvertToIssue: () => void;
  onToggleAI: (aiAssignable: boolean) => void;
  onUpdateAIInstructions: (instructions: string | null) => void;
  onRunAITask?: () => void;
  isRunning?: boolean;
}

export function SubtaskItem({
  subtask,
  onUpdate,
  onDelete,
  onConvertToIssue,
  onToggleAI,
  onUpdateAIInstructions,
  onRunAITask,
  isRunning = false,
}: SubtaskItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(subtask.title);
  const [description, setDescription] = useState(subtask.description || "");
  const [aiInstructions, setAIInstructions] = useState(subtask.aiInstructions || "");

  const isDone =
    subtask.status === STATUS.DONE || subtask.status === STATUS.CANCELED;
  const isAITask = subtask.aiAssignable === true;
  const aiTools = subtask.aiTools ? JSON.parse(subtask.aiTools) as string[] : null;
  const aiStatus = subtask.aiExecutionStatus as AIExecutionStatus;
  const isExecuting = isRunning || aiStatus === "pending" || aiStatus === "running";
  const isCompleted = aiStatus === "completed";
  const isFailed = aiStatus === "failed";

  const handleToggleStatus = () => {
    onUpdate({
      status: isDone ? STATUS.TODO : STATUS.DONE,
    });
  };

  const handleTitleBlur = () => {
    if (title.trim() && title !== subtask.title) {
      onUpdate({ title: title.trim() });
    }
    setIsEditing(false);
  };

  const handleDescriptionBlur = () => {
    if (description !== (subtask.description || "")) {
      onUpdate({ description: description || undefined });
    }
  };

  const handleAIInstructionsBlur = () => {
    if (aiInstructions !== (subtask.aiInstructions || "")) {
      onUpdateAIInstructions(aiInstructions || null);
    }
  };

  const handleRunAITask = () => {
    onRunAITask?.();
  };

  return (
    <div
      className={cn(
        "group border border-border/50 rounded-md",
        isExpanded && "bg-muted/30"
      )}
    >
      {/* Main row */}
      <div className="flex items-center gap-2 px-3 py-2">
        {/* Expand/collapse toggle */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-0.5 hover:bg-accent rounded text-muted-foreground"
        >
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
        </button>

        {/* Status checkbox */}
        <button
          onClick={handleToggleStatus}
          className={cn(
            "w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
            isDone
              ? "bg-status-done border-status-done"
              : "border-muted-foreground hover:border-primary"
          )}
        >
          {isDone && (
            <svg
              className="w-2.5 h-2.5 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={3}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          )}
        </button>

        {/* AI Badge */}
        {isAITask && (
          <AISubtaskBadge status={subtask.aiExecutionStatus as AIExecutionStatus} />
        )}

        {/* Identifier */}
        <span className="text-[10px] font-medium text-muted-foreground shrink-0">
          {subtask.identifier}
        </span>

        {/* Priority icon */}
        <PriorityIcon priority={subtask.priority as Priority} size="sm" />

        {/* Title */}
        {isEditing ? (
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleTitleBlur();
              } else if (e.key === "Escape") {
                setTitle(subtask.title);
                setIsEditing(false);
              }
            }}
            className={cn(
              "flex-1 text-sm bg-transparent border-none outline-none",
              "focus:ring-0"
            )}
            autoFocus
          />
        ) : (
          <span
            onClick={() => setIsEditing(true)}
            className={cn(
              "flex-1 text-sm truncate cursor-text",
              isDone && "line-through text-muted-foreground"
            )}
          >
            {subtask.title}
          </span>
        )}

        {/* Run button for AI tasks */}
        {isAITask && !isDone && (
          <>
            {isExecuting ? (
              <span className="flex items-center gap-1 h-6 px-2 text-xs text-yellow-500">
                <Loader2 className="w-3 h-3 animate-spin" />
                Running...
              </span>
            ) : isFailed ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleRunAITask}
                disabled={isRunning}
                className="h-6 px-2 text-xs text-red-500 hover:text-red-600"
              >
                <RefreshCw className="w-3 h-3 mr-1" />
                Retry
              </Button>
            ) : isCompleted ? (
              <span className="flex items-center gap-1 h-6 px-2 text-xs text-green-500">
                <CheckCircle2 className="w-3 h-3" />
                Done
              </span>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleRunAITask}
                disabled={isRunning}
                className="h-6 px-2 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Play className="w-3 h-3 mr-1" />
                Run
              </Button>
            )}
          </>
        )}

        {/* Actions dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-1 hover:bg-accent rounded text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => onToggleAI(!isAITask)}>
              <Sparkles className="w-4 h-4 mr-2" />
              {isAITask ? "Remove AI flag" : "Make AI task"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onConvertToIssue}>
              <ExternalLink className="w-4 h-4 mr-2" />
              Convert to issue
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onDelete}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete subtask
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Expanded details */}
      {isExpanded && (
        <div className="px-3 pb-3 pt-1 space-y-3 border-t border-border/50">
          {/* Properties row */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">Status</span>
              <StatusSelect
                value={subtask.status as Status}
                onChange={(status) => onUpdate({ status })}
                className="w-[140px] h-7"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">
                Priority
              </span>
              <PrioritySelect
                value={subtask.priority as Priority}
                onChange={(priority) => onUpdate({ priority })}
                className="w-[140px] h-7"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <MarkdownEditor
              value={description}
              onChange={setDescription}
              onBlur={handleDescriptionBlur}
              placeholder="Add description..."
              minHeight={180}
              compact
            />
          </div>

          {/* AI Task section */}
          {isAITask && (
            <div className="space-y-2 pt-2 border-t border-border/50">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                <span className="font-medium">AI Task Details</span>
              </div>

              {/* AI Instructions */}
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground">
                  Instructions
                </label>
                <MarkdownEditor
                  value={aiInstructions}
                  onChange={setAIInstructions}
                  onBlur={handleAIInstructionsBlur}
                  placeholder="How should AI approach this task..."
                  minHeight={120}
                  compact
                />
              </div>

              {/* AI Tools */}
              {aiTools && aiTools.length > 0 && (
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground">
                    Tools
                  </label>
                  <div className="flex flex-wrap gap-1">
                    {aiTools.map((tool) => (
                      <span
                        key={tool}
                        className="px-2 py-0.5 text-[10px] bg-muted rounded-full"
                      >
                        {tool}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Execution Summary */}
              {subtask.aiExecutionSummary && (
                <div className="space-y-1 pt-2 border-t border-border/30">
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    {isCompleted ? (
                      <CheckCircle2 className="w-3 h-3 text-green-500" />
                    ) : isFailed ? (
                      <XCircle className="w-3 h-3 text-red-500" />
                    ) : null}
                    <span className="font-medium">Execution Summary</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {subtask.aiExecutionSummary}
                  </p>
                </div>
              )}

              {/* Failed state retry hint */}
              {isFailed && !subtask.aiExecutionSummary && (
                <div className="flex items-center gap-1.5 text-[10px] text-red-500 pt-2">
                  <XCircle className="w-3 h-3" />
                  <span>Execution failed. Click Retry to run again.</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
