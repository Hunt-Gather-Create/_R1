/**
 * Client rundown — assembles a single-page, multi-section view of every
 * top-level project under a client.
 *
 * Section layout per operator (2026-04-30):
 *   - Wrapper retainer (e.g. "1H Convergix Retainer"):
 *       1 wrapper section showing wrapper-level chart issues + a visual
 *       Gantt of the children L1 projects (no per-row alert sub-rows on
 *       the rollup itself — those move to each child's section).
 *       N "wrapper-child" sections — one per child L1, drilling into
 *       that child's L2 weekItems with full L1+L2 detection.
 *   - Standalone L1: a single "standalone" section.
 *
 * Each top-level project contributes one or more sections. Order is
 * alphabetical by top-level project name; within a wrapper, the wrapper
 * section precedes its children which are themselves alphabetical.
 */

import { drizzle } from "drizzle-orm/libsql";
import { eq, inArray } from "drizzle-orm";
import { weekItems, projects as projectsTable } from "@/lib/db/runway-schema";
import { detectChildProjectIssues } from "../../../src/lib/runway/gantt/detect-issues";
import {
  addSeverity,
  buildL1SectionData,
  buildWrapperSectionData,
  slugAnchor,
} from "../../../src/lib/runway/gantt/section-builders";
import type {
  ClientRow,
  ClientRundownData,
  ProjectRow,
  RundownSection,
  SeverityCounts,
  WeekItemRow,
} from "../../../src/lib/runway/gantt/types";

type DrizzleDb = ReturnType<typeof drizzle>;

const ZERO: SeverityCounts = { critical: 0, warn: 0, info: 0 };

/**
 * Build the complete rundown for a client. Fetches each top-level
 * project's child projects (to classify wrapper vs L1) and, for any L1
 * subject (standalone OR wrapper-child), its weekItems.
 *
 * One round trip per top-level project for child-projects, then a single
 * batch query for weekItems across all entities that need them.
 */
export async function extractClientRundown(
  db: DrizzleDb,
  client: ClientRow,
  topLevelProjects: ProjectRow[],
  generatedAt: string,
  todayISO: string,
): Promise<ClientRundownData> {
  // First pass: classify each top-level into wrapper-with-children OR
  // standalone, and collect the universe of project ids that need
  // weekItems fetched (all standalones + every wrapper-child + every
  // wrapper itself for orphan-probe). Order by raw input for now —
  // we'll re-sort below once we know which standalones are empty.
  type ClassifiedTop =
    | { kind: "wrapper"; project: ProjectRow; children: ProjectRow[] }
    | { kind: "standalone"; project: ProjectRow };

  const classified: ClassifiedTop[] = [];
  for (const top of topLevelProjects) {
    const children = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.parentProjectId, top.id));
    if (
      top.parentProjectId === null &&
      top.engagementType === "retainer" &&
      children.length > 0
    ) {
      classified.push({ kind: "wrapper", project: top, children });
    } else {
      classified.push({ kind: "standalone", project: top });
    }
  }

  // Collect every project id that needs a weekItems pull.
  const idsNeedingWeekItems = new Set<string>();
  for (const c of classified) {
    if (c.kind === "wrapper") {
      idsNeedingWeekItems.add(c.project.id); // for orphan probe
      for (const child of c.children) idsNeedingWeekItems.add(child.id);
    } else {
      idsNeedingWeekItems.add(c.project.id);
    }
  }

  const wiByProject = new Map<string, WeekItemRow[]>();
  if (idsNeedingWeekItems.size > 0) {
    const all = await db
      .select()
      .from(weekItems)
      .where(inArray(weekItems.projectId, Array.from(idsNeedingWeekItems)));
    for (const w of all) {
      const pid = w.projectId;
      if (!pid) continue;
      const arr = wiByProject.get(pid);
      if (arr) arr.push(w);
      else wiByProject.set(pid, [w]);
    }
  }

  // Sort top-levels: projects-with-content first, empty standalones last.
  // Within each group, alphabetical. Wrappers always count as having
  // content (they have child projects); a standalone is "empty" iff it
  // has zero weekItems (operator 2026-04-30 — empty placeholders shouldn't
  // dominate the top of the rundown).
  function hasContent(c: ClassifiedTop): boolean {
    if (c.kind === "wrapper") return true;
    return (wiByProject.get(c.project.id) ?? []).length > 0;
  }
  classified.sort((a, b) => {
    const ac = hasContent(a) ? 0 : 1;
    const bc = hasContent(b) ? 0 : 1;
    if (ac !== bc) return ac - bc;
    return a.project.name.localeCompare(b.project.name);
  });

  const sections: RundownSection[] = [];
  const overall: SeverityCounts = { ...ZERO };

  for (const c of classified) {
    if (c.kind === "wrapper") {
      const orphanItems = (wiByProject.get(c.project.id) ?? []).map((w) => ({
        id: w.id,
        title: w.title,
      }));
      const wrapperData = buildWrapperSectionData(
        c.project,
        client,
        c.children,
        orphanItems,
        generatedAt,
        todayISO,
      );
      sections.push({
        anchor: slugAnchor(c.project.name),
        kind: "wrapper",
        title: c.project.name,
        data: wrapperData,
      });
      addSeverity(overall, wrapperData.summary.severity);

      // Per-child drill-in sections
      const sortedChildren = [...c.children].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      for (const child of sortedChildren) {
        const wis = wiByProject.get(child.id) ?? [];
        // Append child-of-wrapper relational issues to the child's chart
        // issues — these describe the child's relationship to the
        // wrapper, so they belong under the child's section rather than
        // the rollup (operator semantic 2026-04-30).
        const relationship = detectChildProjectIssues(child, c.project);
        const extraChart = [...relationship.inline, ...relationship.subRow];
        const childData = buildL1SectionData(
          child,
          client,
          wis,
          todayISO,
          generatedAt,
          extraChart,
        );
        sections.push({
          anchor: slugAnchor(`${c.project.name}-${child.name}`),
          kind: "wrapper-child",
          title: child.name,
          parentTitle: c.project.name,
          data: childData,
        });
        addSeverity(overall, childData.summary.severity);
      }
    } else {
      const wis = wiByProject.get(c.project.id) ?? [];
      const data = buildL1SectionData(
        c.project,
        client,
        wis,
        todayISO,
        generatedAt,
      );
      sections.push({
        anchor: slugAnchor(c.project.name),
        kind: "standalone",
        title: c.project.name,
        data,
      });
      addSeverity(overall, data.summary.severity);
    }
  }

  return {
    client,
    sections,
    generatedAt,
    overallSeverity: overall,
  };
}
