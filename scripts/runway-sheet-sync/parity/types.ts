/**
 * Parity harness types (_R1#151).
 *
 * Four verdict values, no free text (ticket §"Verdict per row"). AGREE means
 * every field the tool would write matches what the hand walk wrote — a row
 * `diff.ts` calls "matched" while `owner`/`resources`/`category` differ is
 * DISAGREE here, never AGREE, because this harness compares its own field
 * set, not the tool's.
 */

export type ParityVerdict = "AGREE" | "DISAGREE" | "TOOL_ONLY" | "HAND_ONLY";

/** The fields this harness compares — a strict superset of diff.ts's three
 * (`status`, `startDate`, `endDate`): owner/resources/category are added
 * because diff.ts never emits a FieldDelta for them (measured _R1#151 body).
 * title/weekOf are excluded on purpose — they are match keys, never
 * correction targets (ticket, "title and weekOf are MATCH KEYS only"). */
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
 * times — the whole point of freezing (ticket, "Two frozen snapshots in"). */
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
  /** null for HAND_ONLY — there is no sheet row. */
  rowNumber: number | null;
  taskNo: string | null;
  title: string;
  verdict: ParityVerdict;
  /** HOW the tool reached its answer (ticket, "Accidental agreement is a
   * finding, not a pass") — null when there is no sheet-side match at all
   * (TOOL_ONLY / HAND_ONLY). */
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
}
