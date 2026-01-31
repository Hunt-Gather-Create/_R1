"use client";

import { memo } from "react";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Ban,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { JobStatus } from "@/lib/types";

interface StatusCellProps {
  status: string;
}

const statusConfig: Record<
  JobStatus,
  { icon: typeof CheckCircle2; label: string; className: string }
> = {
  pending: {
    icon: Clock,
    label: "Pending",
    className: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
  },
  running: {
    icon: Loader2,
    label: "Running",
    className: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  },
  completed: {
    icon: CheckCircle2,
    label: "Completed",
    className: "bg-green-500/10 text-green-600 border-green-500/20",
  },
  failed: {
    icon: XCircle,
    label: "Failed",
    className: "bg-red-500/10 text-red-600 border-red-500/20",
  },
  cancelled: {
    icon: Ban,
    label: "Cancelled",
    className: "bg-gray-500/10 text-gray-600 border-gray-500/20",
  },
};

export const StatusCell = memo(function StatusCell({ status }: StatusCellProps) {
  const config = statusConfig[status as JobStatus] ?? statusConfig.pending;
  const Icon = config.icon;
  const isRunning = status === "running";

  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 font-medium", config.className)}
    >
      <Icon
        className={cn("h-3.5 w-3.5", isRunning && "animate-spin")}
      />
      {config.label}
    </Badge>
  );
});
