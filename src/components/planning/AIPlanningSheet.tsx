"use client";

import { useState, useCallback } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useBoardContext } from "@/components/board/context/BoardProvider";
import { PlanningChatPanel, type PlannedIssue, type EpicSummary } from "./PlanningChatPanel";
import { PlannedIssuesPanel } from "./PlannedIssuesPanel";
import { createEpic } from "@/lib/actions/epics";

interface AIPlanningSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AIPlanningSheet({ open, onOpenChange }: AIPlanningSheetProps) {
  const { board, addIssue, workspaceId } = useBoardContext();
  const [plannedIssues, setPlannedIssues] = useState<PlannedIssue[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [epicSummary, setEpicSummary] = useState<EpicSummary | null>(null);

  // Find the intake column based on workspace purpose
  const intakeColumn = board.columns.find((col) => {
    const name = col.name.toLowerCase();
    return name === "backlog" || name === "ideas";
  }) || board.columns[0];

  const handlePlanIssue = useCallback(
    (issue: Omit<PlannedIssue, "id" | "status">) => {
      const newIssue: PlannedIssue = {
        ...issue,
        id: crypto.randomUUID(),
        status: "pending",
      };
      setPlannedIssues((prev) => [...prev, newIssue]);
    },
    []
  );

  const handleUpdateIssue = useCallback(
    (id: string, updates: Partial<PlannedIssue>) => {
      setPlannedIssues((prev) =>
        prev.map((issue) =>
          issue.id === id ? { ...issue, ...updates } : issue
        )
      );
    },
    []
  );

  const handleRemoveIssue = useCallback((id: string) => {
    setPlannedIssues((prev) => prev.filter((issue) => issue.id !== id));
  }, []);

  const handleCreateAll = useCallback(async () => {
    if (!intakeColumn) return;

    setIsCreating(true);

    // Create the epic first
    const epic = await createEpic(workspaceId, epicSummary ?? { title: "Untitled Epic" });

    const pendingIssues = plannedIssues.filter((i) => i.status === "pending");

    for (const issue of pendingIssues) {
      // Mark as creating
      setPlannedIssues((prev) =>
        prev.map((i) => (i.id === issue.id ? { ...i, status: "creating" } : i))
      );

      // Create the issue with epicId
      addIssue(intakeColumn.id, {
        title: issue.title,
        description: issue.description,
        priority: issue.priority,
        epicId: epic.id,
      });

      // Mark as created
      setPlannedIssues((prev) =>
        prev.map((i) =>
          i.id === issue.id ? { ...i, status: "created" as const } : i
        )
      );

      // Small delay between creations for visual feedback
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    setIsCreating(false);
  }, [plannedIssues, intakeColumn, addIssue, workspaceId, epicSummary]);

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        // Reset state when closing
        setPlannedIssues([]);
        setIsCreating(false);
        setEpicSummary(null);
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
            AI Planning
          </SheetTitle>
        </div>

        {/* Content - Two column layout */}
        <div className="flex flex-1 min-h-0">
          {/* Left: AI Chat */}
          <div className="w-[55%] border-r border-border">
            <PlanningChatPanel
              onPlanIssue={handlePlanIssue}
              onSummarizeEpic={setEpicSummary}
            />
          </div>

          {/* Right: Planned Issues */}
          <div className="w-[45%]">
            <PlannedIssuesPanel
              issues={plannedIssues}
              onUpdateIssue={handleUpdateIssue}
              onRemoveIssue={handleRemoveIssue}
              onCreateAll={handleCreateAll}
              isCreating={isCreating}
              epicSummary={epicSummary}
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
