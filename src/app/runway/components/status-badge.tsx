"use client";

import type { ItemStatus } from "../types";

export const STATUS_STYLES: Record<
  ItemStatus,
  { label: string; className: string }
> = {
  "in-production": {
    label: "In Production",
    className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  },
  "awaiting-client": {
    label: "Awaiting Client",
    className: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  },
  "not-started": {
    label: "Not Started",
    className: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  },
  blocked: {
    label: "Blocked",
    className: "bg-red-500/20 text-red-400 border-red-500/30",
  },
  "on-hold": {
    label: "On Hold",
    className: "bg-zinc-500/20 text-zinc-500 border-zinc-500/30",
  },
  completed: {
    label: "Complete",
    className: "bg-sky-500/20 text-sky-400 border-sky-500/30",
  },
};

export const TYPE_INDICATORS: Record<string, string> = {
  delivery: "text-emerald-400",
  review: "text-sky-400",
  kickoff: "text-violet-400",
  deadline: "text-amber-400",
  approval: "text-amber-400",
  launch: "text-rose-400",
  blocked: "text-red-400",
};

export function StyledBadge({ label, className, extraClassName }: { label: string; className: string; extraClassName?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${className}${extraClassName ? ` ${extraClassName}` : ""}`}
    >
      {label}
    </span>
  );
}

export function StatusBadge({ status }: { status: ItemStatus }) {
  const style = STATUS_STYLES[status];
  return <StyledBadge label={style.label} className={style.className} />;
}

const CONTRACT_BADGE_STYLES: Record<string, { label: string; className: string } | undefined> = {
  expired: {
    label: "SOW Expired",
    className: "bg-red-500/20 text-red-400 border-red-500/30",
  },
  unsigned: {
    label: "SOW Unsigned",
    className: "bg-violet-500/20 text-violet-400 border-violet-500/30",
  },
};

export function ContractBadge({ status }: { status: string }) {
  const style = CONTRACT_BADGE_STYLES[status];
  if (!style) return null;
  return <StyledBadge label={style.label} className={style.className} extraClassName="mt-1" />;
}

export function MetadataLabel({
  label,
  value,
  className = "text-xs text-muted-foreground",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return <span className={className}>{label}: {value}</span>;
}

export function StaleBadge({ days }: { days: number }) {
  if (days < 7) return null;
  const weeks = Math.floor(days / 7);
  const color =
    days >= 30
      ? "bg-red-500/20 text-red-400 border-red-500/30"
      : "bg-amber-500/20 text-amber-400 border-amber-500/30";
  return <StyledBadge label={`${weeks}w waiting`} className={color} />;
}
