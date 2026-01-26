"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { IssueRow } from "./IssueRow";
import { ListHeader, type SortField, type SortDirection } from "./ListHeader";
import {
  IssueProvider,
  useIssueContext,
} from "@/components/board/context/IssueContext";
import { cn } from "@/lib/utils";
import { useSendToAI } from "@/lib/hooks";
import type { BoardWithColumnsAndIssues, IssueWithLabels } from "@/lib/types";

interface ListViewProps {
  initialBoard: BoardWithColumnsAndIssues;
  onIssueSelect?: (issue: IssueWithLabels) => void;
}

export function ListView({ initialBoard, onIssueSelect }: ListViewProps) {
  return (
    <IssueProvider initialBoard={initialBoard}>
      <ListViewContent onIssueSelect={onIssueSelect} />
    </IssueProvider>
  );
}

function ListViewContent({
  onIssueSelect,
}: {
  onIssueSelect?: (issue: IssueWithLabels) => void;
}) {
  const { board } = useIssueContext();
  const { sendToAI } = useSendToAI();

  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);

  // Flatten all issues from all columns
  const allIssues = useMemo(() => {
    return board.columns.flatMap((col) => col.issues);
  }, [board.columns]);

  // Sort issues
  const sortedIssues = useMemo(() => {
    const sorted = [...allIssues].sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case "identifier":
          comparison = a.identifier.localeCompare(b.identifier);
          break;
        case "status":
          comparison = a.status.localeCompare(b.status);
          break;
        case "priority":
          comparison = a.priority - b.priority;
          break;
        case "title":
          comparison = a.title.localeCompare(b.title);
          break;
        case "dueDate":
          const aDate = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
          const bDate = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
          comparison = aDate - bDate;
          break;
        case "estimate":
          comparison = (a.estimate ?? 0) - (b.estimate ?? 0);
          break;
        case "createdAt":
          comparison =
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case "updatedAt":
          comparison =
            new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
          break;
        default:
          comparison = 0;
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });

    return sorted;
  }, [allIssues, sortField, sortDirection]);

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
    if (selectedIds.size === sortedIssues.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sortedIssues.map((i) => i.id)));
    }
  }, [selectedIds.size, sortedIssues]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
          setFocusedIndex((i) => Math.min(i + 1, sortedIssues.length - 1));
          break;
        case "ArrowUp":
        case "k":
          e.preventDefault();
          setFocusedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < sortedIssues.length) {
            onIssueSelect?.(sortedIssues[focusedIndex]);
          }
          break;
        case " ":
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < sortedIssues.length) {
            toggleSelect(sortedIssues[focusedIndex].id);
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
  }, [focusedIndex, sortedIssues, onIssueSelect, toggleSelect]);

  return (
    <div className="flex flex-col h-full">
      <ListHeader
        sortField={sortField}
        sortDirection={sortDirection}
        onSort={handleSort}
        selectedCount={selectedIds.size}
        totalCount={sortedIssues.length}
        onSelectAll={selectAll}
        isAllSelected={
          selectedIds.size === sortedIssues.length && sortedIssues.length > 0
        }
      />

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {sortedIssues.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm text-muted-foreground mb-2">
              No issues found
            </p>
            <p className="text-xs text-muted-foreground">
              Create an issue to get started
            </p>
          </div>
        ) : (
          sortedIssues.map((issue, index) => (
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
    </div>
  );
}
