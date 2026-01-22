"use client";

import { useState } from "react";
import { Check, Plus, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Label } from "@/lib/types";

interface LabelSelectProps {
  selectedLabels: Label[];
  availableLabels: Label[];
  onAdd: (labelId: string) => void;
  onRemove: (labelId: string) => void;
  className?: string;
}

function LabelPill({
  label,
  onRemove,
}: {
  label: Label;
  onRemove?: () => void;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full"
      style={{
        backgroundColor: `${label.color}20`,
        color: label.color,
      }}
    >
      {label.name}
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="hover:bg-black/10 rounded-full p-0.5"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </span>
  );
}

export function LabelSelect({
  selectedLabels,
  availableLabels,
  onAdd,
  onRemove,
  className,
}: LabelSelectProps) {
  const [open, setOpen] = useState(false);

  const selectedIds = new Set(selectedLabels.map((l) => l.id));
  const unselectedLabels = availableLabels.filter((l) => !selectedIds.has(l.id));

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Selected labels */}
      {selectedLabels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedLabels.map((label) => (
            <LabelPill
              key={label.id}
              label={label}
              onRemove={() => onRemove(label.id)}
            />
          ))}
        </div>
      )}

      {/* Add label button */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className={cn(
              "flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground",
              "hover:text-foreground hover:bg-accent rounded transition-colors"
            )}
          >
            <Plus className="w-3 h-3" />
            Add label
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2" align="start">
          <div className="space-y-1">
            {unselectedLabels.length === 0 ? (
              <p className="text-xs text-muted-foreground p-2 text-center">
                No more labels available
              </p>
            ) : (
              unselectedLabels.map((label) => (
                <button
                  key={label.id}
                  onClick={() => {
                    onAdd(label.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 rounded",
                    "hover:bg-accent transition-colors text-left"
                  )}
                >
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: label.color }}
                  />
                  <span className="text-sm">{label.name}</span>
                </button>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
