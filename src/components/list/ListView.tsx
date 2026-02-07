"use client";

import { useState, useCallback, useEffect } from "react";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import { IssueRow } from "./IssueRow";
import { ListHeader, type SortField, type SortDirection } from "./ListHeader";
import { ListGroup } from "./ListGroup";
import { useBoardContext } from "@/components/board/context/BoardProvider";
import { cn } from "@/lib/utils";
import { useSendToAI } from "@/lib/hooks";
import { columnAwareCollisionDetection } from "@/lib/collision-detection";
import { useIssueDragAndDrop } from "@/components/board/hooks/useIssueDragAndDrop";
import { useGroupedIssues } from "./hooks/useGroupedIssues";
import type { IssueWithLabels } from "@/lib/types";

interface ListViewProps {
  onIssueSelect?: (issue: IssueWithLabels) => void;
}

export function ListView({ onIssueSelect }: ListViewProps) {
  const { board, addIssue, findColumn, moveIssueToColumn } =
    useBoardContext();
  const { sendToAI } = useSendToAI();

  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);

  const { groups, flatIssues, dndEnabled, showGroups } = useGroupedIssues(
    sortField,
    sortDirection
  );

  const {
    sensors,
    activeIssue,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
  } = useIssueDragAndDrop({ board, findColumn, moveIssueToColumn });

  const handleSort = useCallback((field: SortField) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
        return field;
      }
      setSortDirection("asc");
      return field;
    });
  }, []);

  const toggleSelect = useCallback((issueId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(issueId)) {
        next.delete(issueId);
      } else {
        next.add(issueId);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (selectedIds.size === flatIssues.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(flatIssues.map((i) => i.id)));
    }
  }, [selectedIds.size, flatIssues]);

  const handleIssueClick = useCallback(
    (issue: IssueWithLabels, globalIndex: number) => {
      setFocusedIndex(globalIndex);
      onIssueSelect?.(issue);
    },
    [onIssueSelect]
  );

  const handleAddIssue = useCallback(
    (columnId: string, title: string) => {
      addIssue(columnId, { title });
    },
    [addIssue]
  );

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip when drag is active
      if (activeIssue) return;

      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }

      switch (e.key) {
        case "ArrowDown":
        case "j":
          e.preventDefault();
          setFocusedIndex((i) => Math.min(i + 1, flatIssues.length - 1));
          break;
        case "ArrowUp":
        case "k":
          e.preventDefault();
          setFocusedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < flatIssues.length) {
            onIssueSelect?.(flatIssues[focusedIndex]);
          }
          break;
        case " ":
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < flatIssues.length) {
            toggleSelect(flatIssues[focusedIndex].id);
          }
          break;
        case "Escape":
          e.preventDefault();
          setSelectedIds(new Set());
          setFocusedIndex(-1);
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focusedIndex, flatIssues, onIssueSelect, toggleSelect, activeIssue]);

  const listContent = (
    <>
      <ListHeader
        sortField={sortField}
        sortDirection={sortDirection}
        onSort={handleSort}
        selectedCount={selectedIds.size}
        totalCount={flatIssues.length}
        onSelectAll={selectAll}
        isAllSelected={
          selectedIds.size === flatIssues.length && flatIssues.length > 0
        }
      />

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {showGroups ? (
          groups.map((group) => {
            let startIndex = 0;
            for (const g of groups) {
              if (g.id === group.id) break;
              startIndex += g.issues.length;
            }

            return (
              <ListGroup
                key={group.id}
                column={group.column}
                sortedIssues={group.issues}
                selectedIds={selectedIds}
                focusedIndex={focusedIndex}
                startIndex={startIndex}
                dndEnabled={dndEnabled}
                onToggleSelect={toggleSelect}
                onIssueClick={handleIssueClick}
                onAddIssue={handleAddIssue}
                onSendToAI={sendToAI}
              />
            );
          })
        ) : flatIssues.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm text-muted-foreground mb-2">
              No issues found
            </p>
            <p className="text-xs text-muted-foreground">
              Create an issue to get started
            </p>
          </div>
        ) : (
          flatIssues.map((issue, index) => (
            <div
              key={issue.id}
              className={cn(
                focusedIndex === index && "ring-2 ring-primary ring-inset"
              )}
            >
              <IssueRow
                issue={issue}
                isSelected={selectedIds.has(issue.id)}
                onSelect={() => toggleSelect(issue.id)}
                onClick={() => {
                  setFocusedIndex(index);
                  onIssueSelect?.(issue);
                }}
                onSendToAI={() => sendToAI(issue.id)}
              />
            </div>
          ))
        )}
      </div>

      {/* Selection toolbar */}
      {selectedIds.size > 0 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2 bg-card border border-border rounded-lg shadow-lg">
          <span className="text-sm font-medium">
            {selectedIds.size} selected
          </span>
          <div className="w-px h-4 bg-border" />
          <button className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Change status
          </button>
          <button className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Change priority
          </button>
          <button className="text-sm text-destructive hover:text-destructive/80 transition-colors">
            Delete
          </button>
        </div>
      )}
    </>
  );

  if (dndEnabled) {
    return (
      <div className="flex flex-col h-full">
        <DndContext
          sensors={sensors}
          collisionDetection={columnAwareCollisionDetection}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          {listContent}

          <DragOverlay dropAnimation={null}>
            {activeIssue ? (
              <div className="bg-card border border-border shadow-lg rounded">
                <IssueRow issue={activeIssue} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    );
  }

  return <div className="flex flex-col h-full">{listContent}</div>;
}
