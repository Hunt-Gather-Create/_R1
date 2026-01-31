"use client";

import { memo, useMemo } from "react";
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";
import type { BackgroundJob } from "@/lib/types";

dayjs.extend(duration);

interface DurationCellProps {
  job: BackgroundJob;
}

function formatDuration(ms: number): string {
  const d = dayjs.duration(ms);

  if (ms < 1000) return `${ms}ms`;

  const hours = Math.floor(d.asHours());
  const minutes = d.minutes();
  const seconds = d.seconds();

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  return `${seconds}s`;
}

export const DurationCell = memo(function DurationCell({ job }: DurationCellProps) {
  const { startedAt, completedAt, status } = job;

  // Calculate duration - for running jobs this will update on each data refresh (10s poll)
  const durationText = useMemo(() => {
    if (!startedAt) return null;

    const start = dayjs(startedAt);

    // For running jobs, calculate from start to now (will refresh on poll)
    if (status === "running" || status === "pending") {
      const elapsed = dayjs().diff(start);
      return formatDuration(elapsed);
    }

    // For completed/failed jobs, show actual duration
    if (completedAt) {
      const elapsed = dayjs(completedAt).diff(start);
      return formatDuration(elapsed);
    }

    return null;
  }, [startedAt, completedAt, status]);

  if (!durationText) {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <span className="text-muted-foreground tabular-nums">
      {durationText}
    </span>
  );
});
