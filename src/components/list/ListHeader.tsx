"use client";

import { cn } from "@/lib/utils";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

export type SortField =
  | "identifier"
  | "status"
  | "priority"
  | "title"
  | "dueDate"
  | "estimate"
  | "createdAt"
  | "updatedAt";

export type SortDirection = "asc" | "desc";

interface ListHeaderProps {
  sortField?: SortField;
  sortDirection?: SortDirection;
  onSort?: (field: SortField) => void;
  selectedCount?: number;
  totalCount?: number;
  onSelectAll?: () => void;
  isAllSelected?: boolean;
}

interface HeaderCellProps {
  field: SortField;
  label: string;
  width: string;
  sortField?: SortField;
  sortDirection?: SortDirection;
  onSort?: (field: SortField) => void;
  className?: string;
}

function HeaderCell({
  field,
  label,
  width,
  sortField,
  sortDirection,
  onSort,
  className,
}: HeaderCellProps) {
  const isActive = sortField === field;

  return (
    <button
      onClick={() => onSort?.(field)}
      className={cn(
        "flex items-center gap-1 px-2 h-full text-left",
        "text-[11px] font-medium text-muted-foreground uppercase tracking-wider",
        "hover:text-foreground transition-colors",
        width,
        className
      )}
    >
      <span className="truncate">{label}</span>
      {isActive ? (
        sortDirection === "asc" ? (
          <ArrowUp className="w-3 h-3 flex-shrink-0" />
        ) : (
          <ArrowDown className="w-3 h-3 flex-shrink-0" />
        )
      ) : (
        <ArrowUpDown className="w-3 h-3 flex-shrink-0 opacity-0 group-hover:opacity-50" />
      )}
    </button>
  );
}

export function ListHeader({
  sortField,
  sortDirection,
  onSort,
  selectedCount = 0,
  totalCount = 0,
  onSelectAll,
  isAllSelected = false,
}: ListHeaderProps) {
  return (
    <div className="flex items-center h-8 border-b border-border bg-muted/30 sticky top-0 z-10">
      {/* Checkbox */}
      <div className="flex items-center justify-center w-10 flex-shrink-0">
        <button
          onClick={onSelectAll}
          className={cn(
            "w-4 h-4 rounded border flex items-center justify-center",
            "transition-colors",
            isAllSelected || selectedCount > 0
              ? "bg-primary border-primary"
              : "border-muted-foreground/30 hover:border-muted-foreground"
          )}
        >
          {isAllSelected && (
            <svg
              className="w-3 h-3 text-primary-foreground"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={3}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          )}
          {!isAllSelected && selectedCount > 0 && (
            <div className="w-2 h-0.5 bg-primary-foreground rounded" />
          )}
        </button>
      </div>

      {/* ID */}
      <HeaderCell
        field="identifier"
        label="ID"
        width="w-20"
        sortField={sortField}
        sortDirection={sortDirection}
        onSort={onSort}
      />

      {/* Status */}
      <div className="w-8 flex-shrink-0" />

      {/* Priority */}
      <div className="w-8 flex-shrink-0" />

      {/* Title */}
      <HeaderCell
        field="title"
        label="Title"
        width="flex-1"
        sortField={sortField}
        sortDirection={sortDirection}
        onSort={onSort}
        className="min-w-0"
      />

      {/* Labels */}
      <div className="w-32 flex-shrink-0 px-2">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          Labels
        </span>
      </div>

      {/* Epic */}
      <div className="w-28 flex-shrink-0 px-2">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          Epic
        </span>
      </div>

      {/* Due Date */}
      <HeaderCell
        field="dueDate"
        label="Due"
        width="w-24"
        sortField={sortField}
        sortDirection={sortDirection}
        onSort={onSort}
      />

      {/* Estimate */}
      <HeaderCell
        field="estimate"
        label="Est"
        width="w-16"
        sortField={sortField}
        sortDirection={sortDirection}
        onSort={onSort}
        className="text-right justify-end"
      />
    </div>
  );
}
