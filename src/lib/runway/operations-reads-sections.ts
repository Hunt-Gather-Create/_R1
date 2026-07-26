/**
 * Runway Read Operations — L3 sections (4-level hierarchy, 2026-07-26)
 *
 * Sections group tasks inside a project (plan §4.1). A section with all 5
 * actionable fields null is a pure grouping band; any set field promotes it
 * to actionable. Dates for pure-grouping sections are derived from children
 * at READ TIME only — nothing is stored (plan §3.4 own-value-wins rule).
 */

import { getRunwayDb } from "@/lib/db/runway";
import { sections, weekItems } from "@/lib/db/runway-schema";
import { asc, eq } from "drizzle-orm";
import { fuzzyMatch, type FuzzyMatchResult } from "./operations-utils";
import { foldChildDateRange } from "./section-utils";

export type SectionRow = typeof sections.$inferSelect;

/** Ordered read of a project's sections (sortOrder, then title for stability). */
export async function getSectionsForProject(projectId: string): Promise<SectionRow[]> {
  const db = getRunwayDb();
  return db
    .select()
    .from(sections)
    .where(eq(sections.projectId, projectId))
    .orderBy(asc(sections.sortOrder), asc(sections.title));
}

export async function getSectionById(sectionId: string): Promise<SectionRow | null> {
  const db = getRunwayDb();
  const rows = await db
    .select()
    .from(sections)
    .where(eq(sections.id, sectionId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Fuzzy-match a section by title within one project (exact > starts-with >
 * substring, same ranking as projects/week items). Returns the shared
 * FuzzyMatchResult so callers can disambiguate.
 */
export async function findSectionByFuzzyTitle(
  projectId: string,
  title: string,
): Promise<FuzzyMatchResult<SectionRow>> {
  const rows = await getSectionsForProject(projectId);
  return fuzzyMatch(rows, title, (s) => s.title);
}

/**
 * Read-time derived date range for a section's child tasks. Used by the UI
 * to gray-render dates on pure-grouping sections (own-value-wins: an
 * actionable section's own dates take precedence and this derivation is not
 * consulted). Never persisted. The fold lives in section-utils.ts so the
 * dashboard, Gantt extraction, and MCP surface derive identically.
 */
export async function deriveSectionChildDateRange(
  sectionId: string,
): Promise<{ startDate: string | null; endDate: string | null }> {
  const db = getRunwayDb();
  const children = await db
    .select({
      startDate: weekItems.startDate,
      endDate: weekItems.endDate,
      date: weekItems.date,
    })
    .from(weekItems)
    .where(eq(weekItems.sectionId, sectionId));
  return foldChildDateRange(children);
}

/** Child tasks of a section, ordered like the board (sortOrder then title). */
export async function getWeekItemsForSection(sectionId: string) {
  const db = getRunwayDb();
  return db
    .select()
    .from(weekItems)
    .where(eq(weekItems.sectionId, sectionId))
    .orderBy(asc(weekItems.sortOrder), asc(weekItems.title));
}
