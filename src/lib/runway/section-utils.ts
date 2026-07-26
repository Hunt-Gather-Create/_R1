/**
 * Pure L3 section helpers — no DB deps (4-level hierarchy, 2026-07-26).
 *
 * Single source of truth for two predicates the dashboard, the Gantt
 * rundown extraction, and the MCP surface must agree on: what makes a
 * section "actionable", and how a child date range derives at read time.
 */

/** The shape both week-item rows and derived inputs share for the fold. */
export interface ChildDateSource {
  startDate: string | null;
  endDate: string | null;
  date?: string | null;
}

export interface SectionActionableFieldsShape {
  status: string | null;
  owner: string | null;
  resources: string | null;
  startDate: string | null;
  endDate: string | null;
}

/** Any of the 5 actionable fields set = actionable; all null = pure grouping. */
export function isSectionActionable(s: SectionActionableFieldsShape): boolean {
  return (
    s.status !== null ||
    s.owner !== null ||
    s.resources !== null ||
    s.startDate !== null ||
    s.endDate !== null
  );
}

/**
 * Read-time derived range over child tasks:
 * min(startDate ?? date) .. max(endDate ?? startDate ?? date).
 * Never persisted (plan §3.4 guardrail 1 — no stored rollups for sections).
 */
export function foldChildDateRange(
  children: ChildDateSource[],
): { startDate: string | null; endDate: string | null } {
  let minStart: string | null = null;
  let maxEnd: string | null = null;
  for (const child of children) {
    const start = child.startDate ?? child.date ?? null;
    if (start && (minStart === null || start < minStart)) minStart = start;
    const end = child.endDate ?? start;
    if (end && (maxEnd === null || end > maxEnd)) maxEnd = end;
  }
  return { startDate: minStart, endDate: maxEnd };
}
