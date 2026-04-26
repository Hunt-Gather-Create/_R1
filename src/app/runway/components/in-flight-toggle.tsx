"use client";

import { useState, useTransition } from "react";

interface InFlightToggleProps {
  /** Initial persisted toggle value. */
  initialEnabled: boolean;
  /** Server action that persists the new state. */
  onToggle: (next: boolean) => Promise<unknown>;
  /** Optional callback for parent components that also track state. */
  onChange?: (next: boolean) => void;
}

/**
 * Pill-shaped sliding toggle for the In Flight section (PR #88 chunk A).
 *
 * Replaces the earlier plain checkbox in runway-board. Placed at the top-left
 * of the This Week view so the control sits above the In Flight (formerly
 * "Soft Flags") summary and the rest of the board.
 *
 * Uses a native button with role="switch" + aria-checked for a11y. The knob
 * slides left (OFF) / right (ON) via a translate-x transition. Palette uses
 * sky-500 for the ON state to match the in-flight-section header styling.
 */
export function InFlightToggle({
  initialEnabled,
  onToggle,
  onChange,
}: InFlightToggleProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    const prev = enabled;
    const next = !enabled;
    // Optimistic: flip local state immediately, persist in background.
    setEnabled(next);
    onChange?.(next);
    startTransition(async () => {
      try {
        await onToggle(next);
      } catch (err) {
        // Revert the optimistic flip so the UI matches reality.
        setEnabled(prev);
        onChange?.(prev);
        console.error(JSON.stringify({
          event: "in_flight_toggle_error",
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    });
  };

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="In Flight"
        data-testid="in-flight-toggle"
        disabled={isPending}
        onClick={handleClick}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60 ${
          enabled
            ? "border-sky-400/40 bg-sky-500"
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
      <span className="text-sm font-medium text-foreground">In Flight</span>
      <span className="text-xs text-muted-foreground">
        {enabled
          ? "Showing in-flight L2s above Today."
          : "In Flight hidden."}
      </span>
    </div>
  );
}
