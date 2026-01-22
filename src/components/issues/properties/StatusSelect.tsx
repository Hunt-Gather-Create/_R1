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

interface StatusSelectProps {
  value: Status;
  onChange: (value: Status) => void;
  className?: string;
}

export function StatusSelect({ value, onChange, className }: StatusSelectProps) {
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
