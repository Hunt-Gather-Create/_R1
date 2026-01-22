"use client";

import { cn } from "@/lib/utils";
import { PRIORITY, PRIORITY_CONFIG, type Priority } from "@/lib/design-tokens";

interface PriorityIconProps {
  priority: Priority;
  size?: "sm" | "md";
  showLabel?: boolean;
  className?: string;
}

export function PriorityIcon({
  priority,
  size = "sm",
  showLabel = false,
  className,
}: PriorityIconProps) {
  const config = PRIORITY_CONFIG[priority];

  // Priority bars visualization (Linear-style)
  const barCount = 4 - priority; // urgent=4 bars, high=3, medium=2, low=1, none=0

  return (
    <div
      className={cn("flex items-center gap-1.5", className)}
      title={config.label}
    >
      <div
        className={cn(
          "flex items-end gap-px",
          size === "sm" ? "h-3" : "h-4"
        )}
      >
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={cn(
              "rounded-sm transition-colors",
              size === "sm" ? "w-0.5" : "w-1",
              i < barCount ? config.color : "bg-muted-foreground/20",
              // Height varies by bar position
              i === 0 && (size === "sm" ? "h-1" : "h-1.5"),
              i === 1 && (size === "sm" ? "h-1.5" : "h-2"),
              i === 2 && (size === "sm" ? "h-2" : "h-2.5"),
              i === 3 && (size === "sm" ? "h-3" : "h-4")
            )}
            style={
              i < barCount
                ? { backgroundColor: `var(--priority-${priority === PRIORITY.URGENT ? "urgent" : priority === PRIORITY.HIGH ? "high" : priority === PRIORITY.MEDIUM ? "medium" : priority === PRIORITY.LOW ? "low" : "none"})` }
                : undefined
            }
          />
        ))}
      </div>
      {showLabel && (
        <span className={cn("text-xs", config.color)}>{config.label}</span>
      )}
    </div>
  );
}

// Simple text-based priority indicator for compact views
export function PriorityBadge({
  priority,
  className,
}: {
  priority: Priority;
  className?: string;
}) {
  const config = PRIORITY_CONFIG[priority];

  if (priority === PRIORITY.NONE) {
    return null;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold rounded",
        config.bgColor,
        config.color,
        className
      )}
      title={config.label}
    >
      {priority === PRIORITY.URGENT ? "!" : priority === PRIORITY.HIGH ? "!!" : priority === PRIORITY.MEDIUM ? "!" : ""}
    </span>
  );
}
