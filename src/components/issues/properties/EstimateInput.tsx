"use client";

import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface EstimateInputProps {
  value?: number | null;
  onChange: (value: number | null) => void;
  className?: string;
}

const ESTIMATE_OPTIONS = [0.5, 1, 2, 3, 5, 8, 13, 21];

export function EstimateInput({ value, onChange, className }: EstimateInputProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-1 px-2 py-1 text-xs rounded",
            "hover:bg-accent transition-colors",
            value ? "text-foreground" : "text-muted-foreground",
            className
          )}
        >
          {value ? `${value} points` : "Set estimate"}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-2" align="start">
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground px-1">
            Story points
          </p>
          <div className="grid grid-cols-4 gap-1">
            {ESTIMATE_OPTIONS.map((points) => (
              <button
                key={points}
                onClick={() => {
                  onChange(points);
                  setOpen(false);
                }}
                className={cn(
                  "px-2 py-1.5 text-sm rounded transition-colors",
                  value === points
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent"
                )}
              >
                {points}
              </button>
            ))}
          </div>
          {value && (
            <button
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="w-full px-2 py-1 text-xs text-muted-foreground hover:text-destructive text-center"
            >
              Remove estimate
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
