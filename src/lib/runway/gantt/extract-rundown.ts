/**
 * Pure DB-coupled rundown builder — no react-dom/server, no Node fs.
 *
 * WHY THIS FILE EXISTS:
 * server.ts imports renderGantt/renderClientRundown from GanttTemplate.tsx,
 * which in turn imports react-dom/server. Next.js 16 + Turbopack forbids
 * react-dom/server (or any file that transitively imports it) from being
 * statically imported in ANY App Router entrypoint — including page.tsx.
 *
 * extractClientRundown itself does NOT use renderGantt or renderClientRundown.
 * This file re-implements the same function with only the imports it actually
 * needs so that page.tsx can import it without pulling in the
 * GanttTemplate → react-dom/server chain.
 *
 * Rendering is handled separately by RundownContentRSC (RSC component) which
 * imports GanttSectionDark — also clean, no react-dom/server or fs imports.
 *
 * Keep this file in sync with server.ts:extractClientRundown.
 */

import { eq, inArray } from "drizzle-orm";
import { getRunwayDb } from "@/lib/db/runway";
import {
  projects as projectsTable,
  weekItems,
} from "@/lib/db/runway-schema";
import {
  detectChildProjectIssues,
} from "@/lib/runway/gantt/detect-issues";
import {
  addSeverity,
  buildL1SectionData,
  buildWrapperSectionData,
  slugAnchor,
} from "@/lib/runway/gantt/section-builders";
import type {
  ClientRow,
  ClientRundownData,
  ProjectRow,
  RundownSection,
  SeverityCounts,
  WeekItemRow,
} from "@/lib/runway/gantt/types";

// ── DB type alias ──────────────────────────────────────────

type DrizzleDb = ReturnType<typeof getRunwayDb>;

const ZERO: SeverityCounts = { critical: 0, warn: 0, info: 0 };

export async function extractClientRundown(
  db: DrizzleDb,
  client: ClientRow,
  topLevelProjects: ProjectRow[],
  generatedAt: string,
  todayISO: string,
): Promise<ClientRundownData> {
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

  const idsNeedingWeekItems = new Set<string>();
  for (const c of classified) {
    if (c.kind === "wrapper") {
      idsNeedingWeekItems.add(c.project.id);
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

      const sortedChildren = [...c.children].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      for (const child of sortedChildren) {
        const wis = wiByProject.get(child.id) ?? [];
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
