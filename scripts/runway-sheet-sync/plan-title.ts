/**
 * _R1#154: shared title parsing for the freshness check (item 2) and the
 * discovery command (item 3). Two naming conventions coexist in Drive
 * today, measured 2026-09-27:
 *   old: "<CODE> | <Label> - Project Plan v<N>"
 *   new: "<CODE>_<slug>_Project-Plan-v<N>"
 * A third shape exists too ("<CODE> | <Label> | Project Plan v<N>", the
 * registered Soundly sheet, TP's ruling on this ticket after the first
 * premise pass measured on a truncated 25-file listing): a title can
 * contain "Project Plan" and still match neither strict shape. This parser
 * never guesses a slug for that case; PARSE returns null and the caller
 * reports it in a named "shape not recognised" bucket instead of dropping
 * it or forcing a false match.
 */

const NEW_SHAPE = /^([A-Za-z]+-?[\dA-Za-z-]*?)_(.+)_Project-Plan-v(\d+)$/i;
const OLD_SHAPE = /^([A-Za-z]+-?[\dA-Za-z-]*?)\s*\|\s*(.+?)\s*-\s*Project\s*Plan\s*v(\d+)$/i;

/** TP's ruling 1a: the broad candidate gate for discovery, deliberately
 * loose so a third, fourth, or fifth title shape is never silently dropped
 * the way a strict-shape-only gate would drop it. */
export const PLAN_TITLE_CANDIDATE = /project[ -]plan/i;

/** Titles starting PENDING-CLEARANCE_ or containing the whole word TEST are
 * real files that are not plans (_R1#154 body). Checked before shape
 * parsing, since a title like "... Project Plan TEST" would otherwise
 * parse cleanly and hide in the unregistered bucket. */
export function isPendingClearanceOrTest(name: string): boolean {
  return name.startsWith("PENDING-CLEARANCE_") || /\bTEST\b/.test(name);
}

export interface ParsedPlanTitle {
  shape: "old" | "new";
  /** The engagement code exactly as it appears in the title. May disagree
   * with a registry's engagementCode (drift is itself informational, see
   * item 1, held for the operator). */
  code: string;
  /** Explicit slug for the new shape. Null for the old shape: a free-text
   * label is not a normalized slug, and this parser never invents one. */
  slug: string | null;
  /** Free-text label for the old shape. Null for the new shape. */
  label: string | null;
  version: number;
}

export function parsePlanTitle(name: string): ParsedPlanTitle | null {
  const newMatch = name.match(NEW_SHAPE);
  if (newMatch) {
    return { shape: "new", code: newMatch[1], slug: newMatch[2], label: null, version: Number(newMatch[3]) };
  }
  const oldMatch = name.match(OLD_SHAPE);
  if (oldMatch) {
    return { shape: "old", code: oldMatch[1], slug: null, label: oldMatch[2], version: Number(oldMatch[3]) };
  }
  return null;
}

/** Leading alphabetic run of an engagement code: "BPC-2603-01" -> "BPC".
 * This is the "client prefix" _R1#154 matches siblings on, deliberately
 * never the full code: ITEP's v2 carries a different full code, BPC-2604,
 * than its registered v1, BPC-2603-01, and a match on the full code misses
 * the exact case this ticket exists for. */
export function clientPrefix(code: string): string {
  const m = code.match(/^[A-Za-z]+/);
  return (m ? m[0] : code).toUpperCase();
}

export function normalizeSlug(slug: string): string {
  return slug.trim().toLowerCase();
}
