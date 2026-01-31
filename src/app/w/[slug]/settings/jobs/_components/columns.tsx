"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusCell } from "./StatusCell";
import { TimeCell } from "./TimeCell";
import { DurationCell } from "./DurationCell";
import type { BackgroundJob, JobMetadata } from "@/lib/types";

function parseMetadata(metadata: string | null): JobMetadata | null {
  if (!metadata) return null;
  try {
    return JSON.parse(metadata) as JobMetadata;
  } catch {
    return null;
  }
}

// Sortable header component
function SortableHeader({
  column,
  title,
}: {
  column: { toggleSorting: (desc?: boolean) => void; getIsSorted: () => false | "asc" | "desc" };
  title: string;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-3 h-8 data-[state=open]:bg-accent"
      onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
    >
      {title}
      <ArrowUpDown className="ml-2 h-4 w-4" />
    </Button>
  );
}

export const columns: ColumnDef<BackgroundJob>[] = [
  {
    accessorKey: "status",
    header: ({ column }) => <SortableHeader column={column} title="Status" />,
    cell: ({ row }) => <StatusCell status={row.original.status} />,
    filterFn: (row, id, value: string[]) => {
      return value.includes(row.getValue(id));
    },
  },
  {
    accessorKey: "functionName",
    header: ({ column }) => <SortableHeader column={column} title="Function" />,
    cell: ({ row }) => (
      <span className="font-medium">{row.original.functionName}</span>
    ),
  },
  {
    id: "description",
    header: "Description",
    cell: ({ row }) => {
      const metadata = parseMetadata(row.original.metadata);
      const description = metadata?.description;
      if (!description) {
        return <span className="text-muted-foreground">-</span>;
      }
      return (
        <span className="text-muted-foreground max-w-[200px] truncate block">
          {description}
        </span>
      );
    },
  },
  {
    accessorKey: "startedAt",
    header: ({ column }) => <SortableHeader column={column} title="Started" />,
    cell: ({ row }) => <TimeCell date={row.original.startedAt} />,
  },
  {
    id: "duration",
    header: "Duration",
    cell: ({ row }) => <DurationCell job={row.original} />,
  },
  {
    id: "attempts",
    header: "Attempts",
    cell: ({ row }) => (
      <span className="text-muted-foreground tabular-nums">
        {row.original.attempt}/{row.original.maxAttempts}
      </span>
    ),
  },
];
