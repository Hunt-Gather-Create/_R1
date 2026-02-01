"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Calendar } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DatePickerProps {
  value?: Date | null;
  onChange: (date: Date | null) => void;
  className?: string;
}

// Simple date picker without full calendar library
export function DatePicker({ value, onChange, className }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");

  const handleDateSubmit = () => {
    if (!inputValue) return;
    const date = new Date(inputValue);
    if (!isNaN(date.getTime())) {
      onChange(date);
      setOpen(false);
      setInputValue("");
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            "justify-start text-left font-normal h-8 px-2",
            !value && "text-muted-foreground",
            className
          )}
        >
          <Calendar className="mr-2 h-4 w-4" />
          {value ? format(new Date(value), "MMM d, yyyy") : "Set due date"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              Enter date
            </label>
            <input
              type="date"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className={cn(
                "w-full px-3 py-2 text-sm rounded-md",
                "bg-background border border-input",
                "focus:outline-none focus:ring-2 focus:ring-ring"
              )}
            />
          </div>

          {/* Quick select options */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              Quick select
            </p>
            <div className="flex flex-wrap gap-1">
              {[
                { label: "Today", days: 0 },
                { label: "Tomorrow", days: 1 },
                { label: "Next week", days: 7 },
                { label: "Next month", days: 30 },
              ].map(({ label, days }) => (
                <button
                  key={label}
                  onClick={() => {
                    const date = new Date();
                    date.setDate(date.getDate() + days);
                    onChange(date);
                    setOpen(false);
                  }}
                  className="px-2 py-1 text-xs bg-muted hover:bg-accent rounded transition-colors"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t">
            {value && (
              <button
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                className="text-xs text-destructive hover:underline"
              >
                Remove date
              </button>
            )}
            <Button
              size="sm"
              onClick={handleDateSubmit}
              disabled={!inputValue}
              className="ml-auto"
            >
              Set date
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
