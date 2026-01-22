"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PriorityIcon } from "../PriorityIcon";
import { PRIORITY, PRIORITY_CONFIG, type Priority } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

interface PrioritySelectProps {
  value: Priority;
  onChange: (value: Priority) => void;
  className?: string;
}

export function PrioritySelect({
  value,
  onChange,
  className,
}: PrioritySelectProps) {
  return (
    <Select
      value={String(value)}
      onValueChange={(v) => onChange(Number(v) as Priority)}
    >
      <SelectTrigger className={cn("w-[180px] h-8 text-xs", className)}>
        <SelectValue>
          <div className="flex items-center gap-2">
            <PriorityIcon priority={value} size="sm" />
            <span>{PRIORITY_CONFIG[value].label}</span>
          </div>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {Object.values(PRIORITY).map((priority) => (
          <SelectItem key={priority} value={String(priority)}>
            <div className="flex items-center gap-2">
              <PriorityIcon priority={priority} size="sm" />
              <span>{PRIORITY_CONFIG[priority].label}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
