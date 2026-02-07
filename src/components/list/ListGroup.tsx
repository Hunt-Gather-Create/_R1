"use client";

import { useState } from "react";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMounted } from "@/lib/hooks";
import { StatusDot } from "@/components/issues/StatusDot";
import { AddIssueForm } from "@/components/board/AddIssueForm";
import { SortableIssueRow } from "./SortableIssueRow";
import { IssueRow } from "./IssueRow";
import type { ColumnWithIssues, IssueWithLabels } from "@/lib/types";
import type { Status } from "@/lib/design-tokens";

interface ListGroupProps {
  column: ColumnWithIssues;
  sortedIssues: IssueWithLabels[];
  selectedIds: Set<string>;
  focusedIndex: number;
  startIndex: number;
  dndEnabled?: boolean;
  onToggleSelect: (issueId: string) => void;
  onIssueClick: (issue: IssueWithLabels, globalIndex: number) => void;
  onAddIssue: (columnId: string, title: string) => void;
  onSendToAI: (issueId: string) => void;
}

export function ListGroup({
  column,
  sortedIssues,
  selectedIds,
  focusedIndex,
  startIndex,
  dndEnabled = false,
  onToggleSelect,
  onIssueClick,
  onAddIssue,
  onSendToAI,
}: ListGroupProps) {
  const mounted = useMounted();

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  const { setNodeRef, isOver } = useDroppable({
    id: `column-${column.id}`,
    data: { type: "column", column },
    disabled: !dndEnabled,
  });

  const handleAddIssue = (title: string) => {
    onAddIssue(column.id, title);
    setShowAddForm(false);
  };

  const renderIssueRow = (issue: IssueWithLabels, i: number) => {
    const globalIndex = startIndex + i;
    const rowProps = {
      issue,
      isSelected: selectedIds.has(issue.id),
      onSelect: () => onToggleSelect(issue.id),
      onClick: () => onIssueClick(issue, globalIndex),
      onSendToAI: () => onSendToAI(issue.id),
    };

    const wrapper = (content: React.ReactNode) => (
      <div
        key={issue.id}
        className={cn(
          focusedIndex === globalIndex && "ring-2 ring-primary ring-inset"
        )}
      >
        {content}
      </div>
    );

    if (dndEnabled) {
      return wrapper(<SortableIssueRow key={issue.id} {...rowProps} />);
    }
    return wrapper(<IssueRow key={issue.id} {...rowProps} />);
  };

  const issueContent = (
    <>
      {showAddForm && (
        <div className="px-3 py-2 border-b border-border/30">
          <AddIssueForm
            onAdd={handleAddIssue}
            onCancel={() => setShowAddForm(false)}
            autoFocus
          />
        </div>
      )}

      {sortedIssues.length === 0 && !showAddForm ? (
        <div className="px-10 py-3 text-xs text-muted-foreground">
          No issues
        </div>
      ) : (
        sortedIssues.map((issue, i) => renderIssueRow(issue, i))
      )}
    </>
  );

  return (
    <div className="border-b border-border/30 last:border-b-0">
      {/* Group header */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="group flex items-center gap-2 w-full h-8 px-3 bg-muted/20 hover:bg-muted/40 transition-colors text-left"
      >
        {isCollapsed ? (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        )}

        {column.status && (
          <StatusDot status={column.status as Status} size="sm" />
        )}
        <span className="text-xs font-medium text-foreground">
          {column.name}
        </span>

        <span className="text-[11px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
          {sortedIssues.length}
        </span>

        <div className="flex-1" />

        <div
          onClick={(e) => {
            e.stopPropagation();
            setShowAddForm(true);
          }}
          className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
          role="button"
          tabIndex={-1}
        >
          <Plus className="w-3.5 h-3.5" />
        </div>
      </button>

      {/* Group content */}
      {!isCollapsed && (
        <div
          ref={dndEnabled && mounted ? setNodeRef : undefined}
          className={cn(
            "transition-colors",
            dndEnabled && mounted && isOver && "bg-accent/30"
          )}
        >
          {dndEnabled ? (
            <SortableContext
              items={sortedIssues.map((i) => i.id)}
              strategy={verticalListSortingStrategy}
            >
              {issueContent}
            </SortableContext>
          ) : (
            issueContent
          )}
        </div>
      )}
    </div>
  );
}
