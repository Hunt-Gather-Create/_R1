/**
 * Runway Sheet Sync — shared types (Phase 1a: read + diff + emit, zero writes).
 *
 * Spec: civ-account-manager/docs/runway-tp-runway-integration-pre-plan.md (v4)
 * §2 data model, §2.9 row-identity ledger, §3 Phase 1a.
 */

/** One sheet in the sync registry. Client slug comes from config, never parsed from banners. */
export interface SheetConfig {
  sheetId: string;
  clientSlug: string;
  /** Real engagement code (file names can carry stale codes — read by content). */
  engagementCode: string;
  /** Human label used for L1 matching alongside banner content. */
  label: string;
}

/** Fixture file shape produced by the google-api skill export step. */
export interface SheetFixture {
  sheetId: string;
  tab: string;
  range: string;
  exportedAt: string;
  values: (string | undefined)[][];
}

export type RowType =
  | "pre-header" // banner / progress rows above the column-header row
  | "column-header" // the "✔ | TASKS | ..." row
  | "rollup" // engagement-spanning summary row (represented by the L1 itself)
  | "section-header" // phase/section grouping row — skipped per Q1.9
  | "leaf" // numbered leaf task → L2 WeekItem
  | "leaf-unnumbered" // indented, dated, but no numeric prefix (Soundly "Buffer / contingency")
  | "milestone" // *** MARKER *** rows — skipped
  | "empty-template" // reserved template rows below content
  | "spacer"; // fully empty

export interface ClassifiedRow {
  /** 1-based sheet row number. */
  rowNumber: number;
  type: RowType;
  raw: (string | undefined)[];
}

export interface LeafTask {
  rowNumber: number;
  /** Numeric prefix like "1.1"; null for leaf-unnumbered rows. */
  taskNo: string | null;
  /** Raw col C value including indentation + prefix. */
  rawLabel: string;
  /** Prefix-stripped, trimmed title. */
  title: string;
  /** Disambiguated title (suffixed with section when duplicated per §2.7); set by derivation. */
  resolvedTitle: string;
  /** ISO dates; null when cell empty or unparseable (unparseable also raises a flag). */
  startDate: string | null;
  endDate: string | null;
  /** Monday of startDate week (mirrors operations-writes-week getMonday). */
  weekOf: string | null;
  /** Col B checkbox. */
  completed: boolean;
  /** §2.4 CREATE-branch derived status. */
  derivedStatus: "completed" | "scheduled";
  /** Q1.12 keyword-derived category. */
  category: "delivery" | "review" | "kickoff" | "deadline" | "approval" | "launch";
  /** Enclosing section header title, if any. */
  section: string | null;
  priority: string | null;
  predecessorRow: number | null;
  lag: number | null;
  resource: string | null;
  /** Composed + cap-truncated notes string per §2.5. */
  notes: string;
  notesTruncated: boolean;
  /** Sequential index among leaf tasks → WeekItem.sortOrder. */
  sortOrder: number;
}

export interface SheetMeta {
  /** "A" = CIVILIZATION banner layout; "B" = "Client Name:" layout; "unknown" otherwise. */
  bannerVariant: "A" | "B" | "unknown";
  /** Engagement title parsed from banner (variant A row 5 / variant B row 2), if present. */
  engagementTitle: string | null;
  /** Project code found in banner content, if any. */
  bannerCode: string | null;
  /** True when bannerCode present and differs from config engagementCode (R7 drift). */
  codeDrift: boolean;
  headerRowNumber: number;
}

export interface ParsedSheet {
  config: SheetConfig;
  meta: SheetMeta;
  rows: ClassifiedRow[];
  leafTasks: LeafTask[];
  /** Shape-variance + data-quality flags vs the Appendix D contract. */
  flags: string[];
}

/** §2.9 — one ledger entry per sheet row identity. */
export interface LedgerEntry {
  /** Identity key: taskNo when present, else "t:<normalized title>". */
  key: string;
  taskNo: string | null;
  title: string;
  rowNumber: number;
  weekItemId: string | null;
  state: "matched" | "pending-create" | "collision-flagged" | "orphaned";
  lastSeenRunId: string;
  /**
   * sha256 of the row's structural content (sheet cols B–J: completed, title,
   * dates, priority, predecessor, lag, resource). Persisted to
   * `sheet_sync_ledger.last_seen_content_hash` so a later run can detect an
   * unchanged row and skip re-diff. Recomputed each run; null for entries that
   * predate the field (e.g. loaded from a file ledger written before E2).
   */
  lastSeenContentHash: string | null;
}

export interface Ledger {
  sheetId: string;
  updatedAt: string;
  lastRunId: string;
  entries: Record<string, LedgerEntry>;
}

export type Disposition =
  | "matched"
  | "missing-in-runway"
  | "mismatched-field"
  | "runway-only-orphan"
  | "skipped-empty"
  | "skipped-header"
  | "skipped-milestone"
  | "skipped-spacer";

export interface FieldDelta {
  field: string;
  sheet: string | null;
  runway: string | null;
  /** §2.4 update policy applied to this delta. */
  action: "write" | "protected-no-write" | "flag-for-review";
}

export interface RowDiff {
  disposition: Disposition;
  leaf?: LeafTask;
  weekItemId?: string;
  weekItemTitle?: string;
  /** The matched Runway WI's weekOf — update payloads must look up by THIS, not the sheet week. */
  weekItemWeekOf?: string | null;
  matchScore?: number;
  deltas?: FieldDelta[];
  /** Mid-week collision: WI matches (title, weekOf, client) but under another L1 / not in ledger. */
  collision?: boolean;
  note?: string;
}

/** Self-contained ready-to-apply operation (Q1.14 (a) — no downstream re-encoding). */
export interface SyncPayload {
  op: "createWeekItem" | "updateWeekItemField" | "addProject" | "flag-for-review";
  /** Params shaped EXACTLY for the operations.ts barrel helper named in `op` — consumed as-is. */
  params: Record<string, unknown>;
  source: { sheetId: string; rowNumber: number; taskNo: string | null };
  /** Ordering index — date writes are FORWARD endDate-first encoded per §2.8. */
  applyOrder: number;
  requiresReview: boolean;
  preflight: {
    notesLength?: number;
    notesTruncated?: boolean;
    titleDisambiguated?: boolean;
    /** True when start/end/weekOf could not be derived — createWeekItem would reject. */
    datesMissing?: boolean;
    statusValid: boolean;
    categoryValid: boolean;
  };
  /** Non-param context (verification WI id, advisory sortOrder) — NOT passed to the helper. */
  advisory?: Record<string, unknown>;
  reason: string;
}

export interface DiffResult {
  config: SheetConfig;
  runId: string;
  generatedAt: string;
  l1: {
    resolved: boolean;
    projectId?: string;
    projectName?: string;
    score?: number;
    method?: "code" | "fuzzy" | "none";
  };
  rowDiffs: RowDiff[];
  orphans: { weekItemId: string; title: string; weekOf: string | null; status: string | null }[];
  counts: Record<Disposition, number> & { "leaf-tasks": number; collisions: number };
  flags: string[];
}
