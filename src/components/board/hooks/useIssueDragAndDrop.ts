"use client";

import { useState, useCallback } from "react";
import {
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import type {
  IssueWithLabels,
  BoardWithColumnsAndIssues,
  ColumnWithIssues,
} from "@/lib/types";

interface UseIssueDragAndDropOptions {
  board: BoardWithColumnsAndIssues;
  findColumn: (issueId: string) => ColumnWithIssues | undefined;
  moveIssueToColumn: (
    issueId: string,
    targetColumnId: string,
    targetPosition: number
  ) => void;
}

export function useIssueDragAndDrop({
  board,
  findColumn,
  moveIssueToColumn,
}: UseIssueDragAndDropOptions) {
  const [activeIssue, setActiveIssue] = useState<IssueWithLabels | null>(null);
  const [originalColumnId, setOriginalColumnId] = useState<string | null>(null);
  const [isOverDropzone, setIsOverDropzone] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const { active } = event;
      const column = findColumn(active.id as string);
      const issue = column?.issues.find((i) => i.id === active.id);
      setActiveIssue(issue ?? null);
      setOriginalColumnId(column?.id ?? null);
    },
    [findColumn]
  );

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { over } = event;
    setIsOverDropzone(!!over);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const draggedFromColumnId = originalColumnId;
      setActiveIssue(null);
      setOriginalColumnId(null);
      setIsOverDropzone(false);

      if (!over || !draggedFromColumnId) return;

      const activeId = active.id as string;
      const overId = over.id as string;

      let targetColumnId: string;
      let targetPosition: number;

      if (overId.startsWith("column-")) {
        // Dropped on column itself (empty area)
        targetColumnId = overId.replace("column-", "");
        const targetColumn = board.columns.find((c) => c.id === targetColumnId);
        targetPosition = targetColumn?.issues.length ?? 0;
      } else {
        // Dropped on another issue
        const overColumn = findColumn(overId);
        if (!overColumn) return;
        targetColumnId = overColumn.id;
        const overIndex = overColumn.issues.findIndex((i) => i.id === overId);

        if (draggedFromColumnId === targetColumnId) {
          // Same column reorder
          const activeIndex = overColumn.issues.findIndex(
            (i) => i.id === activeId
          );
          if (activeIndex === -1 || activeIndex === overIndex) return;

          const reorderedIssues = arrayMove(
            overColumn.issues,
            activeIndex,
            overIndex
          );
          targetPosition = reorderedIssues.findIndex((i) => i.id === activeId);
        } else {
          // Cross-column move
          targetPosition = overIndex;
        }
      }

      // Skip if dropping in same position
      if (draggedFromColumnId === targetColumnId) {
        const currentColumn = board.columns.find(
          (c) => c.id === draggedFromColumnId
        );
        const currentIndex =
          currentColumn?.issues.findIndex((i) => i.id === activeId) ?? -1;
        if (currentIndex === targetPosition) return;
      }

      moveIssueToColumn(activeId, targetColumnId, targetPosition);
    },
    [board.columns, originalColumnId, findColumn, moveIssueToColumn]
  );

  return {
    sensors,
    activeIssue,
    isOverDropzone,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
  };
}
