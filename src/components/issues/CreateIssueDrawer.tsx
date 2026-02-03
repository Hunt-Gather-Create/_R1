"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useBoardContext } from "@/components/board/context/BoardProvider";
import { IssueFormProvider, useIssueFormContext } from "./context";
import { ChatPanel } from "./ChatPanel";
import { IssueFormPanel } from "./IssueFormPanel";
import { createIssue } from "@/lib/actions/issues";
import { queryKeys } from "@/lib/query-keys";
import type { Status } from "@/lib/design-tokens";

interface CreateIssueDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Inner component that uses the context
function CreateIssueDrawerContent({
  onOpenChange,
}: {
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { board, workspaceId } = useBoardContext();
  const {
    formState,
    suggestedSubtasks,
    resetForm,
    setIsSubmitting,
  } = useIssueFormContext();

  const handleSubmit = useCallback(async () => {
    if (!formState.title.trim() || !formState.columnId) return;

    setIsSubmitting(true);

    try {
      // Get the selected column to derive status
      const selectedColumn = board.columns.find(
        (c) => c.id === formState.columnId
      );
      const status = (selectedColumn?.status as Status) || "todo";

      // Create the main issue
      const createdIssue = await createIssue(formState.columnId, {
        title: formState.title.trim(),
        description: formState.description.trim() || undefined,
        status,
        priority: formState.priority,
        labelIds: formState.labelIds,
        dueDate: formState.dueDate ?? undefined,
        estimate: formState.estimate ?? undefined,
        assigneeId: formState.assigneeId,
      });

      // Create subtasks if any were suggested
      if (suggestedSubtasks.length > 0) {
        await Promise.all(
          suggestedSubtasks.map((subtask) =>
            createIssue(formState.columnId, {
              title: subtask.title,
              description: subtask.description,
              priority: subtask.priority,
              parentIssueId: createdIssue.id,
              status,
            })
          )
        );
      }

      // Invalidate board query to refresh the kanban board
      await queryClient.invalidateQueries({
        queryKey: queryKeys.board.detail(workspaceId),
      });

      // Reset form and close drawer
      resetForm();
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  }, [
    formState,
    suggestedSubtasks,
    board.columns,
    workspaceId,
    queryClient,
    resetForm,
    setIsSubmitting,
    onOpenChange,
  ]);

  const handleCancel = useCallback(() => {
    resetForm();
    onOpenChange(false);
  }, [resetForm, onOpenChange]);

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between h-14 px-6 border-b border-border shrink-0">
        <SheetTitle className="text-base font-semibold">Create Issue</SheetTitle>
      </div>

      {/* Content - Two column layout */}
      <div className="flex flex-1 min-h-0">
        {/* Left: AI Chat */}
        <div className="w-[55%] border-r border-border">
          <ChatPanel />
        </div>

        {/* Right: Issue Form */}
        <div className="w-[45%]">
          <IssueFormPanel onSubmit={handleSubmit} onCancel={handleCancel} />
        </div>
      </div>
    </>
  );
}

export function CreateIssueDrawer({
  open,
  onOpenChange,
}: CreateIssueDrawerProps) {
  // Reset form when drawer closes
  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
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
        <IssueFormProvider>
          <CreateIssueDrawerContent onOpenChange={onOpenChange} />
        </IssueFormProvider>
      </SheetContent>
    </Sheet>
  );
}
