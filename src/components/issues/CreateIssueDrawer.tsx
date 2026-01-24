"use client";

import { useState, useCallback } from "react";
import { X } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useBoardContext } from "@/components/board/context/BoardProvider";
import { ChatPanel } from "./ChatPanel";
import { IssueFormPanel, type IssueFormState } from "./IssueFormPanel";
import { STATUS, PRIORITY, type Priority } from "@/lib/design-tokens";

interface CreateIssueDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const initialFormState: IssueFormState = {
  title: "",
  description: "",
  status: STATUS.TODO,
  priority: PRIORITY.NONE,
  labelIds: [],
  dueDate: null,
  estimate: null,
};

export function CreateIssueDrawer({
  open,
  onOpenChange,
}: CreateIssueDrawerProps) {
  const { board, addIssue, labels, createLabel } = useBoardContext();
  const [formState, setFormState] = useState<IssueFormState>(initialFormState);
  const [highlightedFields, setHighlightedFields] = useState<
    Set<keyof IssueFormState>
  >(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Find the "Todo" column to add issues to
  const todoColumn =
    board.columns.find((col) => col.name.toLowerCase() === "todo") ||
    board.columns[0];

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
    if (!formState.title.trim() || !todoColumn) return;

    setIsSubmitting(true);

    addIssue(todoColumn.id, {
      title: formState.title.trim(),
      description: formState.description.trim() || undefined,
      status: formState.status,
      priority: formState.priority,
      labelIds: formState.labelIds,
      dueDate: formState.dueDate ?? undefined,
      estimate: formState.estimate ?? undefined,
    });

    // Reset form and close drawer
    setFormState(initialFormState);
    setIsSubmitting(false);
    onOpenChange(false);
  }, [formState, todoColumn, addIssue, onOpenChange]);

  const handleCancel = useCallback(() => {
    setFormState(initialFormState);
    onOpenChange(false);
  }, [onOpenChange]);

  // Reset form when drawer opens
  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        setFormState(initialFormState);
        setHighlightedFields(new Set());
      }
      onOpenChange(isOpen);
    },
    [onOpenChange]
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
