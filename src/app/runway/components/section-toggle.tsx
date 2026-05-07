"use client";

import { useState, useTransition } from "react";

/**
 * Shared sliding toggle for runway section headers (In Flight, Needs Update).
 *
 * Replaced two near-identical components (in-flight-toggle.tsx,
 * needs-update-toggle.tsx) on 2026-05-07. Section identity drives palette,
 * a11y ids, descriptive text, and the structured-log event name.
 *
 * To add a new section toggle: add a new entry to SECTION_PRESETS below
 * and pass `section="<key>"`. No new component file required.
 */

const SECTION_PRESETS = {
  "in-flight": {
    label: "In Flight",
    descOn: "Showing tasks that are already in flight for projects.",
    descOff: "Toggle on to view tasks that are in flight for projects.",
    onClasses: "border-sky-400/40 bg-sky-500",
    ringClasses: "focus-visible:ring-sky-400",
    errorEvent: "in_flight_toggle_error",
  },
  "needs-update": {
    label: "Needs Update",
    descOn: "Showing items that need an update.",
    descOff: "Toggle on to view items that need an update.",
    onClasses: "border-red-300/30 bg-red-500/75",
    ringClasses: "focus-visible:ring-red-300",
    errorEvent: "needs_update_toggle_error",
  },
} as const;

export type SectionToggleKey = keyof typeof SECTION_PRESETS;

interface SectionToggleProps {
  section: SectionToggleKey;
  initialEnabled: boolean;
  onToggle: (next: boolean) => Promise<unknown>;
  onChange?: (next: boolean) => void;
  /** Compact mode hides the visible label + description; keeps sr-only copies for AT. */
  compact?: boolean;
}

export function SectionToggle({
  section,
  initialEnabled,
  onToggle,
  onChange,
  compact = false,
}: SectionToggleProps) {
  const preset = SECTION_PRESETS[section];
  const [enabled, setEnabled] = useState(initialEnabled);
  const [isPending, startTransition] = useTransition();
  const labelId = `${section}-label`;
  const descId = `${section}-desc`;

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
          event: preset.errorEvent,
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
      aria-labelledby={labelId}
      aria-describedby={descId}
      data-testid={`${section}-toggle`}
      disabled={isPending}
      onClick={handleClick}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors focus:outline-none focus-visible:ring-2 ${preset.ringClasses} focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60 ${
        enabled ? preset.onClasses : "border-border bg-muted"
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
        <span id={labelId} className="sr-only">{preset.label}</span>
        <span id={descId} className="sr-only">
          {enabled ? preset.descOn : preset.descOff}
        </span>
      </span>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {toggle}
      <span id={labelId} className="text-sm font-medium text-foreground">{preset.label}</span>
      <span id={descId} className="text-xs text-muted-foreground">
        {enabled ? preset.descOn : preset.descOff}
      </span>
    </div>
  );
}
