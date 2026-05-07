"use client";

import { useState, useTransition } from "react";

interface NeedsUpdateToggleProps {
  initialEnabled: boolean;
  onToggle: (next: boolean) => Promise<unknown>;
  onChange?: (next: boolean) => void;
  /**
   * Compact mode -- hides the label + description text. Used when the toggle
   * is rendered inline inside the Needs Update section header.
   */
  compact?: boolean;
}

/**
 * Pill-shaped sliding toggle for the Needs Update section. Mirrors
 * InFlightToggle but uses the red palette to match the Needs Update header
 * styling.
 */
export function NeedsUpdateToggle({
  initialEnabled,
  onToggle,
  onChange,
  compact = false,
}: NeedsUpdateToggleProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    const prev = enabled;
    const next = !enabled;
    setEnabled(next);
    onChange?.(next);
    startTransition(async () => {
      try {
        await onToggle(next);
      } catch (err) {
        setEnabled(prev);
        onChange?.(prev);
        console.error(JSON.stringify({
          event: "needs_update_toggle_error",
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    });
  };

  const toggle = (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-labelledby="needs-update-label"
      aria-describedby="needs-update-desc"
      data-testid="needs-update-toggle"
      disabled={isPending}
      onClick={handleClick}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60 ${
        enabled
          ? "border-red-400/40 bg-red-500"
          : "border-border bg-muted"
      }`}
    >
      <span
        aria-hidden
        className={`inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform ${
          enabled ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );

  if (compact) {
    return (
      <span className="inline-flex items-center gap-2">
        {toggle}
        <span id="needs-update-label" className="sr-only">Needs Update</span>
        <span id="needs-update-desc" className="sr-only">
          {enabled
            ? "Showing items that need an update."
            : "Toggle on to view items that need an update."}
        </span>
      </span>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {toggle}
      <span id="needs-update-label" className="text-sm font-medium text-foreground">Needs Update</span>
      <span id="needs-update-desc" className="text-xs text-muted-foreground">
        {enabled
          ? "Showing items that need an update."
          : "Toggle on to view items that need an update."}
      </span>
    </div>
  );
}
