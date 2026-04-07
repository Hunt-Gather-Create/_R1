"use client";

import type { PipelineItem } from "../types";
import { StyledBadge, MetadataLabel } from "./status-badge";

const PIPELINE_STATUS: Record<string, { label: string; className: string }> = {
  scoping: {
    label: "Scoping",
    className: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  },
  drafting: {
    label: "Drafting",
    className: "bg-violet-500/20 text-violet-400 border-violet-500/30",
  },
  "sow-sent": {
    label: "SOW Sent",
    className: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  },
  verbal: {
    label: "Verbal",
    className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  },
  signed: {
    label: "Signed",
    className: "bg-sky-500/20 text-sky-400 border-sky-500/30",
  },
  "at-risk": {
    label: "At Risk",
    className: "bg-red-500/20 text-red-400 border-red-500/30",
  },
};

/** Statuses where the item is inherently waiting on someone external. */
const WAITING_STATUSES = new Set(["sow-sent", "verbal"]);

function getWaitingOnDisplay(item: PipelineItem): string | null {
  if (item.waitingOn) return item.waitingOn;
  if (WAITING_STATUSES.has(item.status)) return "Client";
  return null;
}

export function PipelineRow({ item }: { item: PipelineItem }) {
  const style = PIPELINE_STATUS[item.status];
  const waitingOn = getWaitingOnDisplay(item);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/50 bg-background/50 p-3 sm:flex-row sm:items-center sm:gap-4 sm:p-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1 sm:gap-2">
          <span className="text-sm font-medium text-foreground">
            {item.account}
          </span>
          <span className="text-muted-foreground/30">/</span>
          <span className="text-sm text-foreground/80">{item.title}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          {item.owner ? (
            <MetadataLabel label="Owner" value={item.owner} className="text-xs text-muted-foreground/50" />
          ) : null}
          {waitingOn ? (
            <MetadataLabel label="Waiting on" value={waitingOn} />
          ) : null}
          {item.notes ? (
            <span className="text-xs text-muted-foreground/60">
              Next Steps: {item.notes}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-3">
        {style ? (
          <StyledBadge label={style.label} className={style.className} />
        ) : null}
        <span className="font-mono text-lg font-bold text-foreground sm:min-w-[5rem] sm:text-right">
          {item.value}
        </span>
      </div>
    </div>
  );
}
