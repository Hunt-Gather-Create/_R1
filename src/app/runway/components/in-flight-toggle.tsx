"use client";

import { useState, useTransition } from "react";

interface InFlightToggleProps {
  /** Initial persisted toggle value. */
  initialEnabled: boolean;
  /** Server action that persists the new state. */
  onToggle: (next: boolean) => Promise<unknown>;
  /** Optional callback for parent components that also track state. */
  onChange?: (next: boolean) => void;
  /**
   * Compact mode -- hides the label + description text. Used when the toggle
   * is rendered inline inside the In Flight section header (item 3).
   */
  compact?: boolean;
}

/**
 * Pill-shaped sliding toggle for the In Flight section (PR #88 chunk A).
 *
 * Dashboard cleanup item 3: added `compact` prop. When compact=true the
 * label and description are hidden so the control can live inline in the
 * section header without duplicating the "In Flight" text.
 *
 * Uses a native button with role="switch" + aria-checked for a11y. The knob
 * slides left (OFF) / right (ON) via a translate-x transition. Palette uses
 * sky-500 for the ON state to match the in-flight-section header styling.
 */
export function InFlightToggle({
  initialEnabled,
  onToggle,
  onChange,
  compact = false,
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

  const toggle = (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-labelledby="in-flight-label"
      aria-describedby="in-flight-desc"
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
  );

  if (compact) {
    // In compact mode we still need the aria targets in the DOM even though
    // they are visually hidden, so assistive tech can describe the switch.
    return (
      <span className="inline-flex items-center gap-2">
        {toggle}
        <span id="in-flight-label" className="sr-only">In Flight</span>
        <span id="in-flight-desc" className="sr-only">
          {enabled
            ? "Showing tasks that are already in flight for projects."
            : "Toggle on to view tasks that are in flight for projects."}
        </span>
      </span>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {toggle}
      <span id="in-flight-label" className="text-sm font-medium text-foreground">In Flight</span>
      <span id="in-flight-desc" className="text-xs text-muted-foreground">
        {enabled
          ? "Showing tasks that are already in flight for projects."
          : "Toggle on to view tasks that are in flight for projects."}
      </span>
    </div>
  );
}
