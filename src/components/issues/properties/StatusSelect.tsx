"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusDot } from "../StatusDot";
import { STATUS, STATUS_CONFIG, type Status } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";
import type { Column } from "@/lib/types";

/**
 * Column-based status selection (for moving issues between columns)
 */
interface ColumnModeProps {
  /** Current column ID */
  value: string;
  /** Available columns to choose from */
  columns: Column[];
  /** Called when a column is selected */
  onColumnChange: (columnId: string) => void;
  className?: string;
}

/**
 * Simple status selection (for subtasks or when columns not available)
 */
interface StatusModeProps {
  /** Current status value */
  value: Status;
  /** Called when a status is selected */
  onChange: (status: Status) => void;
  columns?: undefined;
  onColumnChange?: undefined;
  className?: string;
}

type StatusSelectProps = ColumnModeProps | StatusModeProps;

export function StatusSelect(props: StatusSelectProps) {
  const { className } = props;

  // Column-based mode: show columns as options
  if (props.columns) {
    const { value, columns, onColumnChange } = props;
    const currentColumn = columns.find((col) => col.id === value);
    const currentStatus = currentColumn?.status as Status | undefined;

    return (
      <Select value={value} onValueChange={onColumnChange}>
        <SelectTrigger className={cn("w-[180px] h-8 text-xs", className)}>
          <SelectValue>
            <div className="flex items-center gap-2">
              {currentStatus && <StatusDot status={currentStatus} size="sm" />}
              {!currentStatus && (
                <div className="w-2.5 h-2.5 rounded-full bg-muted-foreground/50" />
              )}
              <span>{currentColumn?.name ?? "Unknown"}</span>
            </div>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {columns
            .filter((col) => !col.isSystem)
            .map((column) => {
              const status = column.status as Status | undefined;
              return (
                <SelectItem key={column.id} value={column.id}>
                  <div className="flex items-center gap-2">
                    {status ? (
                      <StatusDot status={status} size="sm" />
                    ) : (
                      <div className="w-2.5 h-2.5 rounded-full bg-muted-foreground/50" />
                    )}
                    <span>{column.name}</span>
                  </div>
                </SelectItem>
              );
            })}
        </SelectContent>
      </Select>
    );
  }

  // Simple status mode: show hardcoded status options
  const { value, onChange } = props;

  return (
    <Select value={value} onValueChange={(v) => onChange(v as Status)}>
      <SelectTrigger className={cn("w-[180px] h-8 text-xs", className)}>
        <SelectValue>
          <div className="flex items-center gap-2">
            <StatusDot status={value} size="sm" />
            <span>{STATUS_CONFIG[value].label}</span>
          </div>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {Object.values(STATUS).map((status) => (
          <SelectItem key={status} value={status}>
            <div className="flex items-center gap-2">
              <StatusDot status={status} size="sm" />
              <span>{STATUS_CONFIG[status].label}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
