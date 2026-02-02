"use client";

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AIExecutionStatus } from "@/lib/types";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface AISubtaskBadgeProps {
  status?: AIExecutionStatus;
  className?: string;
}

const statusConfig: Record<
  NonNullable<AIExecutionStatus>,
  { color: string; label: string }
> = {
  pending: { color: "text-blue-500", label: "Pending" },
  running: { color: "text-yellow-500 animate-pulse", label: "Running" },
  completed: { color: "text-green-500", label: "Completed" },
  failed: { color: "text-red-500", label: "Failed" },
};

export function AISubtaskBadge({ status, className }: AISubtaskBadgeProps) {
  const config = status ? statusConfig[status] : null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center shrink-0",
            config?.color ?? "text-purple-500",
            className
          )}
        >
          <Sparkles className="w-3.5 h-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {config ? `AI Task: ${config.label}` : "AI Task"}
      </TooltipContent>
    </Tooltip>
  );
}
