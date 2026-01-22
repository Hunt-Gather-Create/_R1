"use client";

import { useEffect, useRef, useState } from "react";
import TextareaAutosize from "react-textarea-autosize";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatusSelect } from "./properties/StatusSelect";
import { PrioritySelect } from "./properties/PrioritySelect";
import { LabelSelect } from "./properties/LabelSelect";
import { DatePicker } from "./properties/DatePicker";
import { EstimateInput } from "./properties/EstimateInput";
import { STATUS, type Status, type Priority } from "@/lib/design-tokens";
import type { Label, CreateIssueInput } from "@/lib/types";

export interface IssueFormState {
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  labelIds: string[];
  dueDate: Date | null;
  estimate: number | null;
}

interface IssueFormPanelProps {
  formState: IssueFormState;
  onFormChange: (state: Partial<IssueFormState>) => void;
  availableLabels: Label[];
  onSubmit: () => void;
  onCancel: () => void;
  isSubmitting?: boolean;
  highlightedFields?: Set<keyof IssueFormState>;
}

export function IssueFormPanel({
  formState,
  onFormChange,
  availableLabels,
  onSubmit,
  onCancel,
  isSubmitting = false,
  highlightedFields = new Set(),
}: IssueFormPanelProps) {
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [localHighlights, setLocalHighlights] = useState<Set<keyof IssueFormState>>(new Set());

  // Track highlighted fields for animation
  useEffect(() => {
    if (highlightedFields.size > 0) {
      setLocalHighlights(highlightedFields);
      const timer = setTimeout(() => {
        setLocalHighlights(new Set());
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [highlightedFields]);

  // Focus title on mount
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const selectedLabels = availableLabels.filter((l) =>
    formState.labelIds.includes(l.id)
  );

  const handleAddLabel = (labelId: string) => {
    onFormChange({ labelIds: [...formState.labelIds, labelId] });
  };

  const handleRemoveLabel = (labelId: string) => {
    onFormChange({ labelIds: formState.labelIds.filter((id) => id !== labelId) });
  };

  const canSubmit = formState.title.trim().length > 0 && !isSubmitting;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
        <h3 className="text-sm font-medium">Issue Details</h3>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-thin">
        {/* Title */}
        <div
          className={cn(
            "transition-all duration-500 rounded-md",
            localHighlights.has("title") && "ring-2 ring-primary ring-offset-2 ring-offset-background"
          )}
        >
          <label className="text-xs font-medium text-muted-foreground block mb-2">
            Title
          </label>
          <TextareaAutosize
            ref={titleRef}
            value={formState.title}
            onChange={(e) => onFormChange({ title: e.target.value })}
            className={cn(
              "w-full text-lg font-semibold resize-none bg-muted/50 rounded-md p-3",
              "border border-transparent focus:border-border",
              "focus:outline-none focus:ring-0",
              "placeholder:text-muted-foreground"
            )}
            placeholder="Issue title"
          />
        </div>

        {/* Description */}
        <div
          className={cn(
            "transition-all duration-500 rounded-md",
            localHighlights.has("description") && "ring-2 ring-primary ring-offset-2 ring-offset-background"
          )}
        >
          <label className="text-xs font-medium text-muted-foreground block mb-2">
            Description
          </label>
          <TextareaAutosize
            value={formState.description}
            onChange={(e) => onFormChange({ description: e.target.value })}
            className={cn(
              "w-full text-sm resize-none bg-muted/50 rounded-md p-3",
              "border border-transparent focus:border-border",
              "focus:outline-none focus:ring-0",
              "placeholder:text-muted-foreground"
            )}
            placeholder="Add a description... (e.g., As a [user], I want [goal], so that [benefit])"
            minRows={4}
          />
        </div>

        {/* Properties */}
        <div className="grid grid-cols-2 gap-4">
          <div
            className={cn(
              "transition-all duration-500 rounded-md p-2 -m-2",
              localHighlights.has("status") && "ring-2 ring-primary ring-offset-2 ring-offset-background"
            )}
          >
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Status
            </label>
            <StatusSelect
              value={formState.status}
              onChange={(status) => onFormChange({ status })}
            />
          </div>
          <div
            className={cn(
              "transition-all duration-500 rounded-md p-2 -m-2",
              localHighlights.has("priority") && "ring-2 ring-primary ring-offset-2 ring-offset-background"
            )}
          >
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Priority
            </label>
            <PrioritySelect
              value={formState.priority}
              onChange={(priority) => onFormChange({ priority })}
            />
          </div>
          <div
            className={cn(
              "transition-all duration-500 rounded-md p-2 -m-2",
              localHighlights.has("dueDate") && "ring-2 ring-primary ring-offset-2 ring-offset-background"
            )}
          >
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Due date
            </label>
            <DatePicker
              value={formState.dueDate}
              onChange={(dueDate) => onFormChange({ dueDate })}
            />
          </div>
          <div
            className={cn(
              "transition-all duration-500 rounded-md p-2 -m-2",
              localHighlights.has("estimate") && "ring-2 ring-primary ring-offset-2 ring-offset-background"
            )}
          >
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Estimate
            </label>
            <EstimateInput
              value={formState.estimate}
              onChange={(estimate) => onFormChange({ estimate })}
            />
          </div>
        </div>

        {/* Labels */}
        <div
          className={cn(
            "transition-all duration-500 rounded-md p-2 -m-2",
            localHighlights.has("labelIds") && "ring-2 ring-primary ring-offset-2 ring-offset-background"
          )}
        >
          <label className="text-xs font-medium text-muted-foreground block mb-2">
            Labels
          </label>
          <LabelSelect
            selectedLabels={selectedLabels}
            availableLabels={availableLabels}
            onAdd={handleAddLabel}
            onRemove={handleRemoveLabel}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 p-4 border-t border-border shrink-0">
        <Button variant="ghost" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button onClick={onSubmit} disabled={!canSubmit}>
          {isSubmitting ? "Creating..." : "Create Issue"}
        </Button>
      </div>
    </div>
  );
}
