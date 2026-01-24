"use client";

import { useState, useEffect } from "react";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { IssueCard } from "@/components/issues";
import { AddIssueForm } from "./AddIssueForm";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useBoardContext } from "./context";
import type { ColumnWithIssues, IssueWithLabels } from "@/lib/types";

interface IssueColumnProps {
  column: ColumnWithIssues;
  onIssueClick: (issue: IssueWithLabels) => void;
}

export function IssueColumn({ column, onIssueClick }: IssueColumnProps) {
  const { addIssue, removeIssue } = useBoardContext();

  const [mounted, setMounted] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  const isOrphaned = column.isSystem;

  const { setNodeRef, isOver } = useDroppable({
    id: `column-${column.id}`,
    data: {
      type: "column",
      column,
    },
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleAddIssue = (title: string) => {
    addIssue(column.id, { title });
    setShowAddForm(false);
  };

  const handleDeleteIssue = (issueId: string) => {
    removeIssue(issueId);
  };

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border",
        "min-w-[280px] max-w-[320px]",
        isCollapsed ? "max-h-12" : "max-h-[calc(100vh-180px)]",
        isOrphaned
          ? "bg-amber-500/10 border-amber-500/50"
          : "bg-secondary/30 border-border/50"
      )}
    >
      {/* Column Header */}
      <div
        className={cn(
          "flex items-center justify-between h-10 px-3 border-b",
          isOrphaned ? "border-amber-500/30" : "border-border/50"
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-0.5 hover:bg-accent rounded transition-colors"
          >
            {isCollapsed ? (
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            )}
          </button>
          {isOrphaned && (
            <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
          )}
          <h2
            className={cn(
              "text-sm font-medium truncate",
              isOrphaned
                ? "text-amber-600 dark:text-amber-400"
                : "text-foreground"
            )}
          >
            {column.name}
          </h2>
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {column.issues.length}
          </span>
        </div>

        {!isOrphaned && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowAddForm(true)}
              className="p-1 hover:bg-accent rounded transition-colors text-muted-foreground hover:text-foreground"
              title="Add issue"
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              className="p-1 hover:bg-accent rounded transition-colors text-muted-foreground hover:text-foreground"
              title="Column options"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Column Content */}
      {!isCollapsed && (
        <div
          ref={mounted ? setNodeRef : undefined}
          className={cn(
            "flex-1 flex flex-col overflow-y-auto scrollbar-thin p-2",
            "transition-colors",
            mounted && isOver && "bg-accent/50"
          )}
        >
          <SortableContext
            items={column.issues.map((i) => i.id)}
            strategy={verticalListSortingStrategy}
          >
            {showAddForm && (
              <div className="mb-2">
                <AddIssueForm
                  onAdd={handleAddIssue}
                  onCancel={() => setShowAddForm(false)}
                  autoFocus
                />
              </div>
            )}

            <div className="space-y-2 flex-1">
              {column.issues.map((issue) => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  onClick={() => onIssueClick(issue)}
                  onDelete={() => handleDeleteIssue(issue.id)}
                />
              ))}
            </div>

            {column.issues.length === 0 && !showAddForm && (
              <div className="flex flex-col items-center justify-start py-8 text-center flex-1">
                <p className="text-sm text-muted-foreground mb-2">No issues</p>
                {!isOrphaned && (
                  <button
                    onClick={() => setShowAddForm(true)}
                    className="text-xs text-primary hover:underline"
                  >
                    Create an issue
                  </button>
                )}
              </div>
            )}

            {isOrphaned && column.issues.length > 0 && (
              <div className="mt-2 p-2 rounded bg-amber-500/10 text-center">
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Drag issues to another column
                </p>
              </div>
            )}
          </SortableContext>
        </div>
      )}
    </div>
  );
}
