"use client";

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface HighlightableFieldProps {
  label: string;
  fieldKey: string;
  highlightedFields: Set<string>;
  children: ReactNode;
  /** Use compact styling (for grid items) */
  compact?: boolean;
  className?: string;
}

/**
 * A field wrapper that supports highlight animations for AI suggestions.
 * Used in issue forms to highlight fields when AI populates them.
 */
export function HighlightableField({
  label,
  fieldKey,
  highlightedFields,
  children,
  compact = false,
  className,
}: HighlightableFieldProps) {
  const isHighlighted = highlightedFields.has(fieldKey);

  return (
    <div
      className={cn(
        "transition-all duration-500 rounded-md",
        compact && "p-2 -m-2",
        isHighlighted &&
          "ring-2 ring-primary ring-offset-2 ring-offset-background",
        className
      )}
    >
      <label
        className={cn(
          "text-xs font-medium text-muted-foreground block",
          compact ? "mb-1" : "mb-2"
        )}
      >
        {label}
      </label>
      {children}
    </div>
  );
}
