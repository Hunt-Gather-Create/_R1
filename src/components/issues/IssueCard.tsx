"use client";

import { useMemo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { getMemberInitials, getMemberDisplayName } from "@/lib/utils/member-utils";
import { PriorityIcon } from "./PriorityIcon";
import { StatusDot } from "./StatusDot";
import { QuickActions } from "./QuickActions";
import { SubtaskProgress } from "./SubtaskProgress";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useOptionalWorkspaceContext } from "@/components/workspace/context/WorkspaceProvider";
import { Calendar } from "lucide-react";
import { format, isPast, isToday } from "date-fns";
import { useSubtaskCount, useMounted } from "@/lib/hooks";
import type { IssueWithLabels, Label, WorkspaceMemberWithUser } from "@/lib/types";
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

// Assignee avatar component
function AssigneeAvatar({ member }: { member: WorkspaceMemberWithUser }) {
  const displayName = getMemberDisplayName(member);

  return (
    <Avatar className="h-5 w-5 shrink-0" title={displayName}>
      <AvatarImage src={member.user.avatarUrl ?? undefined} alt={displayName} />
      <AvatarFallback className="text-[8px] bg-muted text-muted-foreground">
        {getMemberInitials(member)}
      </AvatarFallback>
    </Avatar>
  );
}

// Hook to get assignee from workspace members
function useAssignee(assigneeId: string | null) {
  const workspaceContext = useOptionalWorkspaceContext();
  const members = workspaceContext?.members;
  return useMemo(() => {
    if (!assigneeId || !members) return null;
    return members.find((m) => m.userId === assigneeId) ?? null;
  }, [assigneeId, members]);
}

export function IssueCard({
  issue,
  onClick,
  onDelete,
  onSendToAI,
  isDragging: isDraggingProp,
}: IssueCardProps) {
  const mounted = useMounted();

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

  // Get assignee from workspace members
  const assignee = useAssignee(issue.assigneeId);

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
        "issue-item group relative rounded-md border border-border p-3 cursor-pointer",
        "hover:border-primary/50 transition-all",
        dragging && "ring-2 ring-primary shadow-lg opacity-90",
        issue.sentToAI ? "bg-blue-950" : "bg-card hover:bg-accent/30"
      )}
    >
      {/* Top row: Identifier + Priority + Estimate + Quick Actions */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-medium text-muted-foreground shrink-0">
            {issue.identifier}
          </span>
          <PriorityIcon priority={issue.priority as Priority} size="sm" />
          {issue.estimate && (
            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
              {issue.estimate}pt
            </span>
          )}
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

        {/* Right side: Assignee + Due date */}
        <div className="flex items-center gap-2 shrink-0">
          {assignee && <AssigneeAvatar member={assignee} />}
          {issue.dueDate && <DueDateBadge date={new Date(issue.dueDate)} />}
        </div>
      </div>

      {/* Subtask progress bar at bottom of card */}
      {subtaskCount && subtaskCount.total > 0 && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-muted rounded-b-md overflow-hidden">
          <div
            className={cn(
              "h-full transition-all",
              subtaskCount.completed === subtaskCount.total
                ? "bg-status-done"
                : "bg-primary"
            )}
            style={{
              width: `${Math.round((subtaskCount.completed / subtaskCount.total) * 100)}%`,
            }}
          />
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
  // Get assignee from workspace members
  const assignee = useAssignee(issue.assigneeId);

  return (
    <div
      onClick={onClick}
      className="issue-item-compact group flex items-center gap-3 px-3 py-2 hover:bg-accent/30 cursor-pointer transition-colors"
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
      {assignee && <AssigneeAvatar member={assignee} />}
      {issue.dueDate && <DueDateBadge date={new Date(issue.dueDate)} />}
    </div>
  );
}
