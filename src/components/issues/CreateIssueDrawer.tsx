"use client";

import { useState, useCallback } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useBoardContext } from "@/components/board/context/BoardProvider";
import { ChatPanel } from "./ChatPanel";
import { IssueFormPanel, type IssueFormState } from "./IssueFormPanel";
import { PRIORITY, type Priority, type Status } from "@/lib/design-tokens";

interface CreateIssueDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Get initial form state with default column
function getInitialFormState(defaultColumnId: string): IssueFormState {
  return {
    title: "",
    description: "",
    columnId: defaultColumnId,
    priority: PRIORITY.NONE,
    labelIds: [],
    dueDate: null,
    estimate: null,
  };
}

export function CreateIssueDrawer({
  open,
  onOpenChange,
}: CreateIssueDrawerProps) {
  const { board, addIssue, labels, createLabel } = useBoardContext();

  // Find the default column (prefer "todo" status, then first non-system column)
  const defaultColumn =
    board.columns.find((col) => col.status === "todo") ||
    board.columns.find((col) => !col.isSystem) ||
    board.columns[0];

  const [formState, setFormState] = useState<IssueFormState>(() =>
    getInitialFormState(defaultColumn?.id ?? "")
  );
  const [highlightedFields, setHighlightedFields] = useState<
    Set<keyof IssueFormState>
  >(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleFormChange = useCallback((updates: Partial<IssueFormState>) => {
    setFormState((prev) => ({ ...prev, ...updates }));
  }, []);

  const handleSuggestion = useCallback(
    (suggestion: {
      title: string;
      description: string;
      priority: Priority;
    }) => {
      const newHighlights = new Set<keyof IssueFormState>();

      if (suggestion.title) {
        newHighlights.add("title");
      }
      if (suggestion.description) {
        newHighlights.add("description");
      }
      if (suggestion.priority !== undefined) {
        newHighlights.add("priority");
      }

      setFormState((prev) => ({
        ...prev,
        title: suggestion.title || prev.title,
        description: suggestion.description || prev.description,
        priority: suggestion.priority ?? prev.priority,
      }));

      setHighlightedFields(newHighlights);

      // Clear highlights after animation
      setTimeout(() => {
        setHighlightedFields(new Set());
      }, 2000);
    },
    []
  );

  const handleSubmit = useCallback(() => {
    if (!formState.title.trim() || !formState.columnId) return;

    setIsSubmitting(true);

    // Get the selected column to derive status
    const selectedColumn = board.columns.find((c) => c.id === formState.columnId);
    const status = (selectedColumn?.status as Status) || "todo";

    addIssue(formState.columnId, {
      title: formState.title.trim(),
      description: formState.description.trim() || undefined,
      status,
      priority: formState.priority,
      labelIds: formState.labelIds,
      dueDate: formState.dueDate ?? undefined,
      estimate: formState.estimate ?? undefined,
    });

    // Reset form and close drawer
    setFormState(getInitialFormState(defaultColumn?.id ?? ""));
    setIsSubmitting(false);
    onOpenChange(false);
  }, [formState, board.columns, defaultColumn, addIssue, onOpenChange]);

  const handleCancel = useCallback(() => {
    setFormState(getInitialFormState(defaultColumn?.id ?? ""));
    onOpenChange(false);
  }, [defaultColumn, onOpenChange]);

  // Reset form when drawer opens
  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        setFormState(getInitialFormState(defaultColumn?.id ?? ""));
        setHighlightedFields(new Set());
      }
      onOpenChange(isOpen);
    },
    [defaultColumn, onOpenChange]
  );

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        className="w-[85vw] max-w-[1400px] sm:max-w-[1400px] p-0 flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between h-14 px-6 border-b border-border shrink-0">
          <SheetTitle className="text-base font-semibold">
            Create Issue
          </SheetTitle>
        </div>

        {/* Content - Two column layout */}
        <div className="flex flex-1 min-h-0">
          {/* Left: AI Chat */}
          <div className="w-[55%] border-r border-border">
            <ChatPanel onSuggestion={handleSuggestion} />
          </div>

          {/* Right: Issue Form */}
          <div className="w-[45%]">
            <IssueFormPanel
              formState={formState}
              onFormChange={handleFormChange}
              availableLabels={labels}
              columns={board.columns}
              onSubmit={handleSubmit}
              onCancel={handleCancel}
              isSubmitting={isSubmitting}
              highlightedFields={highlightedFields}
              onCreateLabel={createLabel}
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
