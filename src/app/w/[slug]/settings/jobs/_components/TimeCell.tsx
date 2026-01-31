"use client";

import { memo } from "react";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

dayjs.extend(relativeTime);

interface TimeCellProps {
  date: Date | null;
}

export const TimeCell = memo(function TimeCell({ date }: TimeCellProps) {
  if (!date) {
    return <span className="text-muted-foreground">-</span>;
  }

  const d = dayjs(date);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-muted-foreground cursor-default">
            {d.fromNow()}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p>{d.format("MMM D, YYYY h:mm A")}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});
