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

type SectionBlock =
  | { kind: "wrapper"; wrapper: RundownSection; children: RundownSection[] }
  | { kind: "standalone"; section: RundownSection };

/** Mirror of groupTocSections / groupSectionsForAccount for RSC context. */
function groupSections(sections: RundownSection[]): SectionBlock[] {
  const blocks: SectionBlock[] = [];
  let currentWrapper: { wrapper: RundownSection; children: RundownSection[] } | null = null;
  for (const s of sections) {
    if (s.kind === "wrapper") {
      if (currentWrapper) blocks.push({ kind: "wrapper", ...currentWrapper });
      currentWrapper = { wrapper: s, children: [] };
    } else if (s.kind === "wrapper-child") {
      if (currentWrapper) {
        currentWrapper.children.push(s);
      } else {
        blocks.push({ kind: "standalone", section: s });
      }
    } else {
      if (currentWrapper) {
        blocks.push({ kind: "wrapper", ...currentWrapper });
        currentWrapper = null;
      }
      blocks.push({ kind: "standalone", section: s });
    }
  }
  if (currentWrapper) blocks.push({ kind: "wrapper", ...currentWrapper });
  return blocks;
}

export function RundownContentRSC({ sections }: { sections: RundownSection[] }) {
  if (sections.length === 0) return null;
  const blocks = groupSections(sections);

  return (
    <>
      {blocks.map((block) => {
        if (block.kind === "wrapper") {
          return (
            <details
              key={block.wrapper.anchor}
              open
              className="rounded-lg border border-slate-700 bg-slate-900/40 p-3"
            >
              <summary className="cursor-pointer list-none text-sm font-medium text-slate-200">
                {block.wrapper.title}
              </summary>
              <div className="mt-3">
                <GanttSectionDark data={block.wrapper.data} />
              </div>
              {block.children.map((child) => (
                <details
                  key={child.anchor}
                  open
                  className="ml-4 mt-3 rounded border-l-2 border-slate-700 pl-3"
                >
                  <summary className="cursor-pointer list-none text-xs text-slate-400">
                    {child.title}
                  </summary>
                  <div className="mt-2">
                    <GanttSectionDark data={child.data} />
                  </div>
                </details>
              ))}
            </details>
          );
        }
        return (
          <details
            key={block.section.anchor}
            open
            className="rounded-lg border border-slate-700/60 bg-slate-900/20 p-3"
          >
            <summary className="cursor-pointer list-none text-sm font-medium text-slate-300">
              {block.section.title}
            </summary>
            <div className="mt-3">
              <GanttSectionDark data={block.section.data} />
            </div>
          </details>
        );
      })}
    </>
  );
}
