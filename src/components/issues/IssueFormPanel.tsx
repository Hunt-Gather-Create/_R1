"use client";

import { useEffect, useRef, useState } from "react";
import TextareaAutosize from "react-textarea-autosize";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MarkdownPreview } from "@/components/ui/markdown-editor";
import { useIssueFormContext } from "./context";
import { StatusSelect } from "./properties/StatusSelect";
import { PrioritySelect } from "./properties/PrioritySelect";
import { AssigneeSelect } from "./properties/AssigneeSelect";
import { LabelSelect } from "./properties/LabelSelect";
import { DatePicker } from "./properties/DatePicker";
import { EstimateInput } from "./properties/EstimateInput";
import { SuggestedSubtaskList } from "./SuggestedSubtaskList";
import { DescriptionEditorDialog } from "./DescriptionEditorDialog";
import { HighlightableField } from "./HighlightableField";

interface IssueFormPanelProps {
  onSubmit: () => void;
  onCancel: () => void;
}

export function IssueFormPanel({ onSubmit, onCancel }: IssueFormPanelProps) {
  const {
    formState,
    updateForm,
    highlightedFields,
    columns,
    labels,
    members,
    onCreateLabel,
    isSubmitting,
    canSubmit,
  } = useIssueFormContext();

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [isDescriptionDialogOpen, setIsDescriptionDialogOpen] = useState(false);
  const [localHighlights, setLocalHighlights] = useState<Set<string>>(
    new Set()
  );

  // Track previous highlightedFields to detect changes during render
  const [prevHighlightedFields, setPrevHighlightedFields] = useState<Set<string>>(
    new Set()
  );

  // Derive state during render (not in effect) - rerender-derived-state-no-effect rule
  if (highlightedFields.size > 0 && highlightedFields !== prevHighlightedFields) {
    setPrevHighlightedFields(highlightedFields as Set<string>);
    setLocalHighlights(highlightedFields as Set<string>);
    // Clear highlight after animation
    setTimeout(() => setLocalHighlights(new Set()), 2000);
  } else if (highlightedFields.size === 0 && prevHighlightedFields.size > 0) {
    setPrevHighlightedFields(new Set());
  }

  // Focus title on mount
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const selectedLabels = labels.filter((l) =>
    formState.labelIds.includes(l.id)
  );

  const handleAddLabel = (labelId: string) => {
    updateForm({ labelIds: [...formState.labelIds, labelId] });
  };

  const handleRemoveLabel = (labelId: string) => {
    updateForm({
      labelIds: formState.labelIds.filter((id) => id !== labelId),
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
        <h3 className="text-sm font-medium">Issue Details</h3>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="p-4 space-y-6">
          {/* Title */}
          <HighlightableField
            label="Title"
            fieldKey="title"
            highlightedFields={localHighlights}
          >
            <TextareaAutosize
              ref={titleRef}
              value={formState.title}
              onChange={(e) => updateForm({ title: e.target.value })}
              className={cn(
                "w-full text-lg font-semibold resize-none bg-muted/50 rounded-md p-3",
                "border border-transparent focus:border-border",
                "focus:outline-none focus:ring-0",
                "placeholder:text-muted-foreground"
              )}
              placeholder="Issue title"
            />
          </HighlightableField>

          {/* Properties */}
          <div className="grid grid-cols-2 gap-4">
            <HighlightableField
              label="Status"
              fieldKey="columnId"
              highlightedFields={localHighlights}
              compact
            >
              <StatusSelect
                value={formState.columnId}
                columns={columns}
                onColumnChange={(columnId) => updateForm({ columnId })}
              />
            </HighlightableField>

            <HighlightableField
              label="Priority"
              fieldKey="priority"
              highlightedFields={localHighlights}
              compact
            >
              <PrioritySelect
                value={formState.priority}
                onChange={(priority) => updateForm({ priority })}
              />
            </HighlightableField>

            <HighlightableField
              label="Due date"
              fieldKey="dueDate"
              highlightedFields={localHighlights}
              compact
            >
              <DatePicker
                value={formState.dueDate}
                onChange={(dueDate) => updateForm({ dueDate })}
              />
            </HighlightableField>

            <HighlightableField
              label="Estimate"
              fieldKey="estimate"
              highlightedFields={localHighlights}
              compact
            >
              <EstimateInput
                value={formState.estimate}
                onChange={(estimate) => updateForm({ estimate })}
              />
            </HighlightableField>

            <HighlightableField
              label="Assignee"
              fieldKey="assigneeId"
              highlightedFields={localHighlights}
              compact
            >
              <AssigneeSelect
                value={formState.assigneeId}
                members={members}
                onChange={(assigneeId) => updateForm({ assigneeId })}
              />
            </HighlightableField>
          </div>

          {/* Labels */}
          <HighlightableField
            label="Labels"
            fieldKey="labelIds"
            highlightedFields={localHighlights}
            compact
          >
            <LabelSelect
              selectedLabels={selectedLabels}
              availableLabels={labels}
              onAdd={handleAddLabel}
              onRemove={handleRemoveLabel}
              onCreateLabel={onCreateLabel}
            />
          </HighlightableField>

          {/* Description */}
          <HighlightableField
            label="Description"
            fieldKey="description"
            highlightedFields={localHighlights}
          >
            <div
              onClick={() => setIsDescriptionDialogOpen(true)}
              className={cn(
                "min-h-[120px] max-h-[300px] overflow-y-auto rounded-md border border-border bg-muted/30 cursor-text group relative",
                "hover:border-muted-foreground/50 transition-colors scrollbar-thin"
              )}
            >
              {formState.description ? (
                <div className="p-3">
                  <MarkdownPreview content={formState.description} />
                </div>
              ) : (
                <div className="p-3 text-muted-foreground text-sm">
                  Click to add a description...
                </div>
              )}
              <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="p-1.5 bg-muted rounded-md">
                  <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
              </div>
            </div>
          </HighlightableField>

          {/* Description Editor Dialog */}
          <DescriptionEditorDialog
            open={isDescriptionDialogOpen}
            onOpenChange={setIsDescriptionDialogOpen}
            value={formState.description}
            onChange={(description) => updateForm({ description })}
            placeholder="Add a description... (e.g., As a [user], I want [goal], so that [benefit])"
          />

          {/* Suggested Subtasks */}
          <SuggestedSubtaskList />
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

// Re-export the IssueFormState type for backwards compatibility
export type { IssueFormState } from "./context";
