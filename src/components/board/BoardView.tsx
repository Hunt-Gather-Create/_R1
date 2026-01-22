"use client";

import { useCallback } from "react";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import { IssueColumn } from "./IssueColumn";
import { IssueCard } from "@/components/issues";
import { useBoardContext } from "./context";
import { useIssueDragAndDrop } from "./hooks/useIssueDragAndDrop";
import { columnAwareCollisionDetection } from "@/lib/collision-detection";
import type { IssueWithLabels } from "@/lib/types";

interface BoardViewProps {
  onIssueSelect?: (issue: IssueWithLabels) => void;
}

export function BoardView({ onIssueSelect }: BoardViewProps) {
  const {
    board,
    findColumn,
    addIssue,
    removeIssue,
    moveIssueToColumn,
  } = useBoardContext();

  const handleIssueClick = useCallback(
    (issue: IssueWithLabels) => {
      onIssueSelect?.(issue);
    },
    [onIssueSelect]
  );

  const {
    sensors,
    activeIssue,
    isOverDropzone,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
  } = useIssueDragAndDrop({
    board,
    findColumn,
    moveIssueToColumn,
  });

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={columnAwareCollisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-3 overflow-x-auto pb-4 min-h-[calc(100vh-180px)]">
        {board.columns.map((column) => (
          <IssueColumn
            key={column.id}
            column={column}
            onIssueClick={handleIssueClick}
            onAddIssue={addIssue}
            onDeleteIssue={removeIssue}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeIssue && isOverDropzone && (
          <div className="rotate-2 cursor-grabbing">
            <IssueCard issue={activeIssue} onClick={() => {}} isDragging />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
