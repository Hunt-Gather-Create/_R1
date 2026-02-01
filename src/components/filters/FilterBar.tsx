"use client";

import { Filter, X, ChevronDown, Check } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { StatusDot } from "@/components/issues/StatusDot";
import { PriorityIcon } from "@/components/issues/PriorityIcon";
import { cn } from "@/lib/utils";
import {
  STATUS,
  STATUS_CONFIG,
  PRIORITY,
  PRIORITY_CONFIG,
} from "@/lib/design-tokens";
import {
  type FilterState,
  DEFAULT_FILTER_STATE,
  countActiveFilters,
} from "@/lib/filters";
import type { Label, Cycle } from "@/lib/types";

interface FilterBarProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  labels: Label[];
  cycles: Cycle[];
  className?: string;
}

interface FilterButtonProps {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}

function FilterButton({ label, count, active, onClick }: FilterButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-2 py-1 text-xs rounded-md transition-colors",
        active
          ? "bg-primary/20 text-primary border border-primary/30"
          : "bg-muted hover:bg-accent text-muted-foreground hover:text-foreground"
      )}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span className="bg-primary text-primary-foreground px-1 rounded text-[10px]">
          {count}
        </span>
      )}
      <ChevronDown className="w-3 h-3 opacity-50" />
    </button>
  );
}

export function FilterBar({
  filters,
  onChange,
  labels,
  cycles,
  className,
}: FilterBarProps) {
  const activeCount = countActiveFilters(filters);

  const updateFilter = <K extends keyof FilterState>(
    key: K,
    value: FilterState[K]
  ) => {
    onChange({ ...filters, [key]: value });
  };

  const toggleArrayFilter = <T,>(
    key: keyof FilterState,
    value: T,
    currentArray: T[]
  ) => {
    const newArray = currentArray.includes(value)
      ? currentArray.filter((v) => v !== value)
      : [...currentArray, value];
    updateFilter(key, newArray as FilterState[typeof key]);
  };

  const clearFilters = () => {
    onChange(DEFAULT_FILTER_STATE);
  };

  return (
    <div className={cn("flex items-center gap-2 flex-wrap", className)}>
      <div className="flex items-center gap-1 text-muted-foreground">
        <Filter className="w-4 h-4" />
        <span className="text-xs font-medium">Filter</span>
      </div>

      {/* Status filter */}
      <Popover>
        <PopoverTrigger asChild>
          <div>
            <FilterButton
              label="Status"
              count={filters.status.length}
              active={filters.status.length > 0}
              onClick={() => {}}
            />
          </div>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-2" align="start">
          <div className="space-y-1">
            {Object.values(STATUS).map((status) => (
              <button
                key={status}
                onClick={() =>
                  toggleArrayFilter("status", status, filters.status)
                }
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent text-left text-sm"
              >
                <StatusDot status={status} size="sm" />
                <span className="flex-1">{STATUS_CONFIG[status].label}</span>
                {filters.status.includes(status) && (
                  <Check className="w-4 h-4 text-primary" />
                )}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Priority filter */}
      <Popover>
        <PopoverTrigger asChild>
          <div>
            <FilterButton
              label="Priority"
              count={filters.priority.length}
              active={filters.priority.length > 0}
              onClick={() => {}}
            />
          </div>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-2" align="start">
          <div className="space-y-1">
            {Object.values(PRIORITY).map((priority) => (
              <button
                key={priority}
                onClick={() =>
                  toggleArrayFilter("priority", priority, filters.priority)
                }
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent text-left text-sm"
              >
                <PriorityIcon priority={priority} size="sm" />
                <span className="flex-1">
                  {PRIORITY_CONFIG[priority].label}
                </span>
                {filters.priority.includes(priority) && (
                  <Check className="w-4 h-4 text-primary" />
                )}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Labels filter */}
      {labels.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <div>
              <FilterButton
                label="Labels"
                count={filters.labels.length}
                active={filters.labels.length > 0}
                onClick={() => {}}
              />
            </div>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-2" align="start">
            <div className="space-y-1">
              {labels.map((label) => (
                <button
                  key={label.id}
                  onClick={() =>
                    toggleArrayFilter("labels", label.id, filters.labels)
                  }
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent text-left text-sm"
                >
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: label.color }}
                  />
                  <span className="flex-1">{label.name}</span>
                  {filters.labels.includes(label.id) && (
                    <Check className="w-4 h-4 text-primary" />
                  )}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {/* Cycles filter */}
      {cycles.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <div>
              <FilterButton
                label="Cycle"
                active={filters.cycleId !== null}
                onClick={() => {}}
              />
            </div>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-2" align="start">
            <div className="space-y-1">
              <button
                onClick={() => updateFilter("cycleId", null)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent text-left text-sm"
              >
                <span className="flex-1">All cycles</span>
                {filters.cycleId === null && (
                  <Check className="w-4 h-4 text-primary" />
                )}
              </button>
              {cycles.map((cycle) => (
                <button
                  key={cycle.id}
                  onClick={() => updateFilter("cycleId", cycle.id)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent text-left text-sm"
                >
                  <span className="flex-1">{cycle.name}</span>
                  {filters.cycleId === cycle.id && (
                    <Check className="w-4 h-4 text-primary" />
                  )}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {/* Clear filters */}
      {activeCount > 0 && (
        <button
          onClick={clearFilters}
          className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-3 h-3" />
          Clear ({activeCount})
        </button>
      )}
    </div>
  );
}
