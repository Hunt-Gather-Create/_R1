"use client";

import type { DayItem } from "../types";
import { DayItemCard } from "./day-item-card";
import { SectionToggle } from "./section-toggle";
import { SectionHeader } from "./section-header";

interface NeedsUpdateSectionProps {
  staleItems: DayItem[];
  /** When false, the section content collapses but the header + toggle stay visible. */
  enabled?: boolean;
  /**
   * Toggle props -- when provided, the section header renders the toggle
   * inline. Mirrors the In Flight pattern.
   */
  onToggle?: (next: boolean) => Promise<unknown>;
  onToggleChange?: (next: boolean) => void;
}

export function NeedsUpdateSection({
  staleItems,
  enabled = true,
  onToggle,
  onToggleChange,
}: NeedsUpdateSectionProps) {
  const totalCount = staleItems.reduce((sum, day) => sum + day.items.length, 0);
  const hasToggle = onToggle !== undefined;

  // Legacy back-compat: when no toggle props are provided, hide entirely
  // when there is nothing to show. Tests that don't pass toggle props
  // depend on this behavior.
  if (!hasToggle && totalCount === 0) return null;

  return (
    <section data-testid="needs-update-section">
      <SectionHeader
        section="needs-update"
        title="Needs Update"
        count={totalCount}
        toggle={
          hasToggle ? (
            <SectionToggle
              section="needs-update"
              initialEnabled={enabled}
              onToggle={onToggle}
              onChange={onToggleChange}
              compact
            />
          ) : undefined
        }
      />
      {enabled && totalCount > 0 ? (
        <>
          <p className="mb-4 text-sm text-muted-foreground">
            These items haven&apos;t been updated. DM the bot to clear them.
          </p>
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 sm:p-4">
            <div className="space-y-4">
              {staleItems.map((day) => (
                <div key={day.date}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {day.label}
                  </p>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {day.items.map((item, i) => (
                      <DayItemCard
                        key={item.id ?? `${item.account}|${item.title}|${i}`}
                        item={item}
                        size="lg"
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
