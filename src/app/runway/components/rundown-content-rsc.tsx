/**
 * Server component: renders Gantt sections as collapsible <details> blocks.
 *
 * Lives in the App Router server-component module graph alongside page.tsx.
 * Imports GanttSectionDark (which does NOT import react-dom/server or fs),
 * so Turbopack's react-server module-condition restriction is satisfied.
 *
 * The rendered ReactNode is passed as `ganttContent` to AccountSection
 * (client component). Native HTML <details> provides open/close without JS.
 */

import * as React from "react";
import { GanttSectionDark } from "@/lib/runway/gantt/gantt-section-dark";
import type { RundownSection } from "@/lib/runway/gantt/types";
import { groupSections } from "@/lib/runway/gantt/group-sections";
import { weekItemsForSection, l1IdForSection } from "@/lib/runway/gantt/section-builders";
import { ReadyToCloseChip, NoScheduledTasksChip } from "./section-chips";

// Track 4 audit fix (2026-05-05, WARN — Panel 3): the inline `groupSections`
// + `SectionBlock` definitions were extracted to
// `@/lib/runway/gantt/group-sections.ts` so this RSC consumer shares the
// algorithm with `account-tier/AccountTier.tsx`. Drift risk between the
// two consumers is removed — any rule change to wrapper-child grouping
// lands in one place.

/**
 * Track 4 Wave 4.4 — chevron-rotation polish for the dark Gantt embed.
 *
 * Mirrors the Wave 4.1 `CollapsibleSection` pattern (which uses class
 * `account-tier-details` + `account-tier-chevron`) so both tabs feel
 * like the same product. Native `<details>` still drives open/close —
 * we just hide the default disclosure triangle, render a custom chevron
 * `▶`, and rotate it 90deg via the `[open]` attribute selector with a
 * 150ms ease-out transition.
 *
 * Inlined here (not imported from CollapsibleSection) because this
 * component is a Server Component in the App Router module graph and
 * already emits raw `<details>` with theme-specific Tailwind classes;
 * a parallel scoped class lets us evolve the dark embed without
 * touching the account-tier primitive.
 */
const GANTT_CHARTS_CHEVRON_CSS = `
  details.gantt-charts-details > summary {
    list-style: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  details.gantt-charts-details > summary::-webkit-details-marker {
    display: none;
  }
  details.gantt-charts-details > summary > .gantt-charts-chevron {
    display: inline-block;
    transition: transform 150ms ease-out;
    transform: rotate(0deg);
    font-size: 0.65rem;
    line-height: 1;
  }
  details.gantt-charts-details[open] > summary > .gantt-charts-chevron {
    transform: rotate(90deg);
  }
`;

function GanttChartsChevron(): React.JSX.Element {
  return (
    <span aria-hidden="true" className="gantt-charts-chevron">
      ▶
    </span>
  );
}

export function RundownContentRSC({
  sections,
  readyToCloseIds,
}: {
  sections: RundownSection[];
  /**
   * Track 3 Wave 5: precomputed set of L1 ids that are "ready to close"
   * (every weekItem completed, L1 itself not yet completed/canceled).
   * Each matching section's <summary> renders the chip next to the
   * title. Optional — when undefined, no chip renders (back-compat for
   * any caller that hasn't been threaded through page.tsx yet).
   */
  readyToCloseIds?: ReadonlySet<string>;
}) {
  if (sections.length === 0) return null;
  const blocks = groupSections(sections);

  return (
    <>
      <style>{GANTT_CHARTS_CHEVRON_CSS}</style>
      {blocks.map((block) => {
        if (block.kind === "wrapper") {
          return (
            <details
              key={block.wrapper.anchor}
              open
              className="gantt-charts-details rounded-lg border border-slate-700 bg-slate-900/40 p-3"
            >
              <summary className="cursor-pointer list-none text-sm font-medium text-slate-200">
                <GanttChartsChevron />
                {block.wrapper.title}
              </summary>
              <div className="mt-3">
                <GanttSectionDark data={block.wrapper.data} sectionKind={block.wrapper.kind} />
              </div>
              {/* Issue 3 (operator-locked 2026-05-05): each wrapper-child
                  gets its own bracket originating at the L1 summary row,
                  with explicit vertical separation between groups so
                  readers can tell which L2s belong to which L1. The
                  `mt-6` (was `mt-3`) doubles the gap; the bracket comes
                  from `border-l-2 border-slate-600` on each child's own
                  `<details>` — borders are per-element so they cannot
                  span two L1s. */}
              {block.children.map((child) => {
                const childL1Id = l1IdForSection(child);
                const childReady =
                  childL1Id !== null && readyToCloseIds?.has(childL1Id) === true;
                return (
                  <details
                    key={child.anchor}
                    open
                    className="gantt-charts-details ml-4 mt-6 rounded border-l-2 border-slate-600 bg-slate-900/30 pl-3 pr-2 py-2"
                  >
                    <summary className="cursor-pointer list-none text-xs font-medium text-slate-300">
                      <GanttChartsChevron />
                      {child.title}
                      {childReady ? <ReadyToCloseChip variant="dark" /> : null}
                      {weekItemsForSection(child).length === 0 ? (
                        <NoScheduledTasksChip variant="dark" />
                      ) : null}
                    </summary>
                    <div className="mt-2">
                      <GanttSectionDark data={child.data} sectionKind={child.kind} />
                    </div>
                  </details>
                );
              })}
            </details>
          );
        }
        const standaloneL1Id = l1IdForSection(block.section);
        const standaloneReady =
          standaloneL1Id !== null && readyToCloseIds?.has(standaloneL1Id) === true;
        return (
          <details
            key={block.section.anchor}
            open
            className="gantt-charts-details rounded-lg border border-slate-700/60 bg-slate-900/20 p-3"
          >
            <summary className="cursor-pointer list-none text-sm font-medium text-slate-300">
              <GanttChartsChevron />
              {block.section.title}
              {standaloneReady ? <ReadyToCloseChip variant="dark" /> : null}
              {weekItemsForSection(block.section).length === 0 ? (
                <NoScheduledTasksChip variant="dark" />
              ) : null}
            </summary>
            <div className="mt-3">
              <GanttSectionDark data={block.section.data} sectionKind={block.section.kind} />
            </div>
          </details>
        );
      })}
    </>
  );
}
