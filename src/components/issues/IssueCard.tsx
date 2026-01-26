"use client";

import { useState, useEffect } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { PriorityIcon } from "./PriorityIcon";
import { StatusDot } from "./StatusDot";
import { QuickActions } from "./QuickActions";
import { SubtaskProgress } from "./SubtaskProgress";
import { Calendar } from "lucide-react";
import { format, isPast, isToday } from "date-fns";
import { useSubtaskCount } from "@/lib/hooks";
import type { IssueWithLabels, Label } from "@/lib/types";
import type { Priority, Status } from "@/lib/design-tokens";

interface IssueCardProps {
  issue: IssueWithLabels;
  onClick: () => void;
  onDelete?: () => void;
  onSendToAI?: () => void;
  isDragging?: boolean;
}

// Label pill component
function LabelPill({ label }: { label: Label }) {
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded-full"
      style={{
        backgroundColor: `${label.color}20`,
        color: label.color,
      }}
    >
      {label.name}
    </span>
  );
}

// Due date indicator
function DueDateBadge({ date }: { date: Date }) {
  const isOverdue = isPast(date) && !isToday(date);
  const isDueToday = isToday(date);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px]",
        isOverdue
          ? "text-destructive"
          : isDueToday
            ? "text-[var(--priority-high)]"
            : "text-muted-foreground"
      )}
    >
      <Calendar className="w-3 h-3" />
      {format(date, "MMM d")}
    </span>
  );
}

export function IssueCard({
  issue,
  onClick,
  onDelete,
  onSendToAI,
  isDragging: isDraggingProp,
}: IssueCardProps) {
  const [mounted, setMounted] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: issue.id,
    data: {
      type: "issue",
      issue,
    },
  });

  // Fetch subtask count for this issue (only for parent issues)
  const { data: subtaskCount } = useSubtaskCount(
    issue.parentIssueId ? null : issue.id
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  const style = mounted
    ? {
        transform: CSS.Transform.toString(transform),
        transition,
      }
    : undefined;

  const dragging = isDragging || isDraggingProp;

  // Show max 3 labels, with overflow indicator
  const visibleLabels = issue.labels.slice(0, 3);
  const overflowCount = issue.labels.length - 3;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(mounted ? attributes : {})}
      {...(mounted ? listeners : {})}
      onClick={onClick}
      className={cn(
        "group relative rounded-md border border-border p-3 cursor-pointer",
        "hover:border-primary/50 transition-all",
        dragging && "ring-2 ring-primary shadow-lg opacity-90",
        issue.sentToAI ? "bg-blue-950" : "bg-card hover:bg-accent/30"
      )}
    >
      {/* Top row: Identifier + Priority + Quick Actions */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-medium text-muted-foreground shrink-0">
            {issue.identifier}
          </span>
          <PriorityIcon priority={issue.priority as Priority} size="sm" />
        </div>
        <QuickActions onDelete={onDelete} onSendToAI={onSendToAI} className="shrink-0" />
      </div>

      {/* Title */}
      <h3 className="text-sm font-medium text-foreground leading-snug mb-2 line-clamp-2">
        {issue.title}
      </h3>

      {/* Bottom row: Status + Subtasks + Labels + Due Date */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <StatusDot status={issue.status as Status} size="sm" />

          {/* Subtask progress */}
          {subtaskCount && subtaskCount.total > 0 && (
            <SubtaskProgress count={subtaskCount} size="sm" />
          )}

          {/* Labels */}
          {visibleLabels.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              {visibleLabels.map((label) => (
                <LabelPill key={label.id} label={label} />
              ))}
              {overflowCount > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  +{overflowCount}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Due date */}
        {issue.dueDate && <DueDateBadge date={new Date(issue.dueDate)} />}
      </div>

      {/* Estimate badge (if set) */}
      {issue.estimate && (
        <div className="absolute top-3 right-3">
          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {issue.estimate}pt
          </span>
        </div>
      )}
    </div>
  );
}

// Compact variant for list views
export function IssueCardCompact({
  issue,
  onClick,
}: {
  issue: IssueWithLabels;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="group flex items-center gap-3 px-3 py-2 hover:bg-accent/30 cursor-pointer transition-colors"
    >
      <StatusDot status={issue.status as Status} size="sm" />
      <span className="text-[10px] font-medium text-muted-foreground w-16 shrink-0">
        {issue.identifier}
      </span>
      <PriorityIcon priority={issue.priority as Priority} size="sm" />
      <span className="text-sm truncate flex-1">{issue.title}</span>
      {issue.labels.length > 0 && (
        <div className="flex items-center gap-1">
          {issue.labels.slice(0, 2).map((label) => (
            <LabelPill key={label.id} label={label} />
          ))}
        </div>
      )}
      {issue.dueDate && <DueDateBadge date={new Date(issue.dueDate)} />}
    </div>
  );
}
