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

import { GanttSectionDark } from "@/lib/runway/gantt/gantt-section-dark";
import type { RundownSection } from "@/lib/runway/gantt/types";
import { groupSections } from "@/lib/runway/gantt/group-sections";
import { weekItemsForSection, l1IdForSection } from "@/lib/runway/gantt/section-builders";
import { ReadyToCloseChip, NoScheduledTasksChip } from "./section-chips";
import {
  GanttChartsChevron,
  GanttChartsChevronStyle,
} from "./gantt-charts-collapse";

// Track 4 audit fix (2026-05-05, WARN — Panel 3): the inline `groupSections`
// + `SectionBlock` definitions were extracted to
// `@/lib/runway/gantt/group-sections.ts` so this RSC consumer shares the
// algorithm with `account-tier/AccountTier.tsx`. Drift risk between the
// two consumers is removed — any rule change to wrapper-child grouping
// lands in one place.
//
// Issue #49 (2026-05-18): the chevron + scoped CSS used to live inline in
// this file. They moved to `./gantt-charts-collapse.tsx` so the client-
// component `gantt-charts-section.tsx` can render the same affordance at
// the client level without re-defining the CSS rule. This file is a pure
// consumer now — same rendered output, no behavior change.

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
      <GanttChartsChevronStyle />
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
                const childItemsCount = weekItemsForSection(child).length;
                // Issue #41: ReadyToClose is meaningful only when at least
                // one scheduled item remains. AND-out empty sections so the
                // chip never appears alongside NoScheduledTasks.
                const childReady =
                  childL1Id !== null &&
                  readyToCloseIds?.has(childL1Id) === true &&
                  childItemsCount > 0;
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
                      {childItemsCount === 0 ? (
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
        const standaloneItemsCount = weekItemsForSection(block.section).length;
        // Issue #41 parallel: standalone L1 mirrors the wrapper-child rule —
        // ReadyToClose suppressed when the section has zero scheduled items.
        const standaloneReady =
          standaloneL1Id !== null &&
          readyToCloseIds?.has(standaloneL1Id) === true &&
          standaloneItemsCount > 0;
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
              {standaloneItemsCount === 0 ? (
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
