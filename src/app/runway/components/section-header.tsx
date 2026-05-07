import type { ReactNode } from "react";

/**
 * Shared header row for runway dashboard sections that share the
 * `<h2 + count badge + optional inline toggle>` shape.
 *
 * Replaced inline duplication between in-flight-section.tsx and
 * needs-update-section.tsx on 2026-05-07. Section identity drives palette;
 * the toggle slot accepts any ReactNode so callers can pass <SectionToggle>
 * (the common case) or any other control without changing this component.
 */

const SECTION_HEADER_PRESETS = {
  "in-flight": {
    title: "text-sky-300",
    badgeBg: "bg-sky-500/20",
    badgeText: "text-sky-200",
  },
  "needs-update": {
    title: "text-red-300/90",
    badgeBg: "bg-red-500/15",
    badgeText: "text-red-300/90",
  },
} as const;

export type SectionHeaderKey = keyof typeof SECTION_HEADER_PRESETS;

interface SectionHeaderProps {
  section: SectionHeaderKey;
  title: string;
  count: number;
  toggle?: ReactNode;
}

export function SectionHeader({ section, title, count, toggle }: SectionHeaderProps) {
  const preset = SECTION_HEADER_PRESETS[section];
  return (
    <div className="mb-4 flex items-center gap-3">
      <h2 className={`font-display text-2xl font-bold ${preset.title}`}>
        {title}
      </h2>
      {count > 0 ? (
        <span
          data-testid={`${section}-count`}
          className={`rounded-full ${preset.badgeBg} px-2.5 py-0.5 text-sm font-medium ${preset.badgeText}`}
        >
          {count}
        </span>
      ) : null}
      {toggle ? <span className="ml-1">{toggle}</span> : null}
    </div>
  );
}
