"use client";

import { cn } from "@/lib/utils";
import { STATUS, STATUS_CONFIG, type Status } from "@/lib/design-tokens";
import { Circle, CircleDot, CircleCheck, CircleX, CircleDashed } from "lucide-react";

interface StatusDotProps {
  status: Status;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  className?: string;
}

const StatusIcons: Record<Status, React.ComponentType<{ className?: string }>> = {
  [STATUS.BACKLOG]: CircleDashed,
  [STATUS.TODO]: Circle,
  [STATUS.IN_PROGRESS]: CircleDot,
  [STATUS.DONE]: CircleCheck,
  [STATUS.CANCELED]: CircleX,
};

const sizeClasses = {
  sm: "w-3 h-3",
  md: "w-4 h-4",
  lg: "w-5 h-5",
};

export function StatusDot({
  status,
  size = "sm",
  showLabel = false,
  className,
}: StatusDotProps) {
  const config = STATUS_CONFIG[status];
  const Icon = StatusIcons[status];

  const getStatusColor = () => {
    switch (status) {
      case STATUS.BACKLOG:
        return "text-[var(--status-backlog)]";
      case STATUS.TODO:
        return "text-[var(--status-todo)]";
      case STATUS.IN_PROGRESS:
        return "text-[var(--status-in-progress)]";
      case STATUS.DONE:
        return "text-[var(--status-done)]";
      case STATUS.CANCELED:
        return "text-[var(--status-canceled)]";
      default:
        return "text-muted-foreground";
    }
  };

  return (
    <div
      className={cn("flex items-center gap-1.5", className)}
      title={config.label}
    >
      <Icon className={cn(sizeClasses[size], getStatusColor())} />
      {showLabel && (
        <span className="text-xs text-muted-foreground">{config.label}</span>
      )}
    </div>
  );
}

// Linear-style inline status badge
export function StatusBadge({
  status,
  className,
}: {
  status: Status;
  className?: string;
}) {
  const config = STATUS_CONFIG[status];

  const getBgColor = () => {
    switch (status) {
      case STATUS.BACKLOG:
        return "bg-[var(--status-backlog)]/20 text-[var(--status-backlog)]";
      case STATUS.TODO:
        return "bg-[var(--status-todo)]/20 text-[var(--status-todo)]";
      case STATUS.IN_PROGRESS:
        return "bg-[var(--status-in-progress)]/20 text-[var(--status-in-progress)]";
      case STATUS.DONE:
        return "bg-[var(--status-done)]/20 text-[var(--status-done)]";
      case STATUS.CANCELED:
        return "bg-[var(--status-canceled)]/20 text-[var(--status-canceled)]";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded",
        getBgColor(),
        className
      )}
    >
      <StatusDot status={status} size="sm" />
      {config.label}
    </span>
  );
}
