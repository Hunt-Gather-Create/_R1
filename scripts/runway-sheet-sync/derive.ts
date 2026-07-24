/**
 * Derivation rules — §2.4 status (CREATE branch only), Q1.12 category
 * keyword table, §2.5 notes composition + cap truncation, §2.7 duplicate
 * title disambiguation.
 */
import { NOTES_MAX_LEN_L2 } from "../../src/lib/runway/operations-utils";
import type { LeafTask } from "./types";

/** §2.4 CREATE branch. in-progress / blocked / at-risk are human-set only. */
export function deriveStatus(completed: boolean): "completed" | "scheduled" {
  return completed ? "completed" : "scheduled";
}

type Category = LeafTask["category"];

/**
 * Q1.12 — keyword mapping, leaf title first, then section context, else
 * delivery. Order matters: first match wins.
 */
const CATEGORY_RULES: [RegExp, Category][] = [
  [/\bkick\s?-?off\b/i, "kickoff"],
  [/\blaunch\b|\bgo[- ]live\b|\bpublish\b|\blive\b/i, "launch"],
  [/\bapprov/i, "approval"],
  [/\bsign[- ]?off\b/i, "approval"],
  [/\bdeadline\b/i, "deadline"],
  [/\bqa\b|\breview|\bcrit\b|\buat\b|\bproof/i, "review"],
];

export function deriveCategory(title: string, section: string | null): Category {
  for (const [re, cat] of CATEGORY_RULES) {
    if (re.test(title)) return cat;
  }
  if (section) {
    for (const [re, cat] of CATEGORY_RULES) {
      if (re.test(section)) return cat;
    }
  }
  return "delivery";
}

export interface NotesParts {
  taskNo: string | null;
  resource: string | null;
  predecessorRow: number | null;
  lag: number | null;
  priority: string | null;
}

/**
 * §2.5 — compose in order (sheet-row anchor, resource, predecessor/lag,
 * priority), truncate at cap - 3 with "..." suffix. The sheet-row anchor
 * ("Sheet 1.1") doubles as the ledger reverse-lookup key per §2.3.
 */
export function composeNotes(parts: NotesParts): { notes: string; truncated: boolean } {
  const segments: string[] = [];
  if (parts.resource) segments.push(`Resource: ${parts.resource}`);
  if (parts.predecessorRow !== null) {
    segments.push(
      `Predecessor row ${parts.predecessorRow}${parts.lag !== null ? `, lag ${parts.lag}` : ""}`
    );
  }
  if (parts.priority) segments.push(`Priority: ${parts.priority}`);

  const anchor = parts.taskNo ? `[Sheet ${parts.taskNo}]` : "";
  const body = segments.join(" | ");
  const full = anchor && body ? `${anchor} ${body}` : anchor || body;
  if (full.length <= NOTES_MAX_LEN_L2) return { notes: full, truncated: false };
  return { notes: full.slice(0, NOTES_MAX_LEN_L2 - 3) + "...", truncated: true };
}

/**
 * §2.7 create-side collision guard: createWeekItem's idempotency key is
 * (clientId, title, weekOf, updatedBy) — projectId absent. Duplicate
 * (title, weekOf) pairs within one client batch silently dedupe, so any
 * repeat gets a section-derived suffix. Mutates resolvedTitle in place.
 */
export function disambiguateTitles(tasks: LeafTask[]): number {
  const byKey = new Map<string, LeafTask[]>();
  for (const t of tasks) {
    const key = `${t.title.toLowerCase()}|${t.weekOf ?? "no-week"}`;
    const list = byKey.get(key) ?? [];
    list.push(t);
    byKey.set(key, list);
  }

  let disambiguated = 0;
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    for (const t of list) {
      const tag = t.section ?? `row ${t.rowNumber}`;
      t.resolvedTitle = `${t.title} [${tag}]`;
      disambiguated++;
    }
  }
  return disambiguated;
}
