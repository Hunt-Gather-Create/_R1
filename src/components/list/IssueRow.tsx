"use client";

import { cn } from "@/lib/utils";
import { StatusDot } from "@/components/issues/StatusDot";
import { PriorityIcon } from "@/components/issues/PriorityIcon";
import { QuickActions } from "@/components/issues/QuickActions";
import { Calendar, Check } from "lucide-react";
import { format, isPast, isToday } from "date-fns";
import type { IssueWithLabels, Label } from "@/lib/types";
import type { Status, Priority } from "@/lib/design-tokens";

interface IssueRowProps {
  issue: IssueWithLabels;
  isSelected?: boolean;
  onSelect?: () => void;
  onClick?: () => void;
  onSendToAI?: () => void;
}

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

function DueDateCell({ date }: { date: Date }) {
  const isOverdue = isPast(date) && !isToday(date);
  const isDueToday = isToday(date);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs",
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

export function IssueRow({
  issue,
  isSelected = false,
  onSelect,
  onClick,
  onSendToAI,
}: IssueRowProps) {
  return (
    <div
      className={cn(
        "group flex items-center h-9 border-b border-border/50 cursor-pointer",
        "transition-colors",
        isSelected && "bg-primary/10",
        issue.sentToAI ? "bg-blue-950" : "hover:bg-accent/30"
      )}
      onClick={onClick}
    >
      {/* Checkbox */}
      <div className="flex items-center justify-center w-10 flex-shrink-0">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSelect?.();
          }}
          className={cn(
            "w-4 h-4 rounded border flex items-center justify-center",
            "transition-colors",
            isSelected
              ? "bg-primary border-primary text-primary-foreground"
              : "border-muted-foreground/30 hover:border-muted-foreground"
          )}
        >
          {isSelected && <Check className="w-3 h-3" />}
        </button>
      </div>

      {/* Identifier */}
      <div className="w-20 flex-shrink-0 px-2">
        <span className="text-[11px] font-medium text-muted-foreground">
          {issue.identifier}
        </span>
      </div>

      {/* Status */}
      <div className="w-8 flex-shrink-0 flex items-center justify-center">
        <StatusDot status={issue.status as Status} size="sm" />
      </div>

      {/* Priority */}
      <div className="w-8 flex-shrink-0 flex items-center justify-center">
        <PriorityIcon priority={issue.priority as Priority} size="sm" />
      </div>

      {/* Title */}
      <div className="flex-1 min-w-0 px-2">
        <span className="text-sm truncate block">{issue.title}</span>
      </div>

      {/* Labels */}
      <div className="w-32 flex-shrink-0 px-2">
        <div className="flex items-center gap-1 overflow-hidden">
          {issue.labels.slice(0, 2).map((label) => (
            <LabelPill key={label.id} label={label} />
          ))}
          {issue.labels.length > 2 && (
            <span className="text-[10px] text-muted-foreground">
              +{issue.labels.length - 2}
            </span>
          )}
        </div>
      </div>

      {/* Due Date */}
      <div className="w-24 flex-shrink-0 px-2">
        {issue.dueDate && <DueDateCell date={new Date(issue.dueDate)} />}
      </div>

      {/* Quick Actions */}
      <div className="w-10 flex-shrink-0 flex items-center justify-center">
        <QuickActions onSendToAI={onSendToAI} />
      </div>

      {/* Estimate */}
      <div className="w-16 flex-shrink-0 px-2 text-right">
        {issue.estimate && (
          <span className="text-xs text-muted-foreground">
            {issue.estimate}pt
          </span>
        )}
      </div>
    </div>
  );
}
