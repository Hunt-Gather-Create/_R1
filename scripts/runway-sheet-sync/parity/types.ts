/**
 * Parity harness types, _R1#151.
 *
 * Four verdict values, no free text, per the ticket's "Verdict per row"
 * section. AGREE means every field the tool would write matches what the
 * hand walk wrote. A row `diff.ts` calls "matched" while
 * `owner`/`resources`/`category` differ is DISAGREE here, never AGREE,
 * because this harness compares its own field set, not the tool's.
 */

export type ParityVerdict = "AGREE" | "DISAGREE" | "TOOL_ONLY" | "HAND_ONLY";

/** The fields this harness compares. A strict superset of diff.ts's three,
 * `status`, `startDate`, `endDate`. owner/resources/category are added
 * because diff.ts never emits a FieldDelta for them, measured in the
 * _R1#151 ticket body. title/weekOf are excluded on purpose. They are
 * match keys, never correction targets, per the ticket's "title and weekOf
 * are MATCH KEYS only" rule. */
export const PARITY_FIELDS = [
  "status",
  "startDate",
  "endDate",
  "category",
  "owner",
  "resources",
] as const;
export type ParityField = (typeof PARITY_FIELDS)[number];

export type ParityFieldValues = Record<ParityField, string | null>;

/** One frozen prod row, read by an instrument independent of runway-read.ts
 * so owner/resources are never silently dropped by reusing the tool's own
 * narrower projection. */
export interface ProdWeekItemRow {
  id: string;
  projectId: string | null;
  title: string;
  weekOf: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string | null;
  category: string | null;
  owner: string | null;
  resources: string | null;
  notes: string | null;
}

export interface ProdProjectRow {
  id: string;
  name: string;
  status: string | null;
  category: string | null;
  notes: string | null;
}

/** One frozen input: everything the diff engine's L1/WI matching needs, plus
 * the fields the tool's own diff never compares. Written once, read many
 * times. That is the whole point of freezing, per the ticket's "Two frozen
 * snapshots in" rule. */
export interface ProdSnapshot {
  clientSlug: string;
  capturedAt: string;
  client: { id: string; slug: string; name: string };
  projects: ProdProjectRow[];
  weekItems: ProdWeekItemRow[];
}

export interface ParityFieldDelta {
  field: ParityField;
  tool: string | null;
  hand: string | null;
}

export interface ParityMatchInfo {
  method: "ledger" | "fuzzy" | "code";
  score: number | null;
}

export interface ParityRowVerdict {
  /** null for HAND_ONLY. There is no sheet row. */
  rowNumber: number | null;
  taskNo: string | null;
  title: string;
  verdict: ParityVerdict;
  /** HOW the tool reached its answer, per the ticket's "Accidental
   * agreement is a finding, not a pass" rule. null when there is no
   * sheet-side match at all, i.e. TOOL_ONLY or HAND_ONLY. */
  match: ParityMatchInfo | null;
  weekItemId: string | null;
  mismatchedFields: ParityFieldDelta[];
  note: string | null;
}

export interface ParityResult {
  sheetId: string;
  clientSlug: string;
  runId: string;
  sheetFrozenAt: string;
  prodFrozenAt: string;
  l1: {
    resolved: boolean;
    projectId?: string;
    projectName?: string;
    score?: number;
    method?: "code" | "fuzzy" | "none";
  };
  rows: ParityRowVerdict[];
  counts: Record<ParityVerdict, number>;
  /** _R1#156: how many rows the tool could not resolve on its own,
   * HAND_ONLY + DISAGREE. Trending to zero across schedules IS the
   * milestone. Never reduced by a post-run tidy — a row that needed a human
   * to reason about it stays counted even after someone fixes it by hand. */
  interventions: number;
}
