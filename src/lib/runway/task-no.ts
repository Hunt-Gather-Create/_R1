/**
 * taskNo helpers — pure functions, no DB deps (v4-schema-plan §4.3).
 *
 * Sheet-sourced tasks carry their sheet task number (e.g. "3.2"). Runway-born
 * tasks created under a numbered section auto-append: numeric-parse the
 * TRAILING component of each sibling's taskNo, take max + 1, keep the
 * sibling prefix. Text comparison is wrong here — lexicographically
 * max("3.9", "3.10") is "3.9", so the parse must be numeric (SP-3).
 *
 * Deletion is gap-preserving: if task 3.3 is deleted, the next new task is
 * still max+1, never a slot-fill. Renumbering never happens implicitly.
 */

export interface ParsedTaskNo {
  /** Everything before the final ".", or "" for a bare number like "7". */
  prefix: string;
  /** Numeric value of the trailing component. */
  trailing: number;
}

/**
 * Parse a taskNo into prefix + trailing numeric component.
 * Returns null when the trailing component is not a plain integer
 * (e.g. "3.2a", "TBD", "") — those siblings are skipped by auto-append.
 */
export function parseTaskNo(taskNo: string): ParsedTaskNo | null {
  const lastDot = taskNo.lastIndexOf(".");
  const prefix = lastDot === -1 ? "" : taskNo.slice(0, lastDot);
  const trailingRaw = lastDot === -1 ? taskNo : taskNo.slice(lastDot + 1);
  if (!/^\d+$/.test(trailingRaw)) return null;
  return { prefix, trailing: Number(trailingRaw) };
}

/**
 * Compute the next auto-append taskNo from a section's sibling taskNos.
 *
 * Returns null when no sibling carries a parseable taskNo — a Runway-born
 * section with no numbered siblings has no prefix to inherit, so the new
 * task's taskNo stays null until sheet reconciliation places the section
 * (SP-2).
 *
 * When siblings mix prefixes (should not happen inside one section, but
 * data can drift), the prefix of the numerically-largest trailing component
 * wins — the append continues the dominant sequence.
 */
export function computeNextTaskNo(siblingTaskNos: Array<string | null>): string | null {
  let best: ParsedTaskNo | null = null;
  for (const raw of siblingTaskNos) {
    if (!raw) continue;
    const parsed = parseTaskNo(raw);
    if (!parsed) continue;
    if (best === null || parsed.trailing > best.trailing) best = parsed;
  }
  if (best === null) return null;
  const next = best.trailing + 1;
  return best.prefix === "" ? String(next) : `${best.prefix}.${next}`;
}
