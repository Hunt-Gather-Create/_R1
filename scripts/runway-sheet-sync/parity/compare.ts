/**
 * Parity harness core, _R1#151, the second instrument.
 *
 * `diffSheet`, thread B, read-only here, resolves WHICH prod row a sheet
 * leaf matches. That resolution work is reused as-is. What is NOT reused
 * is diff.ts's own field comparison: it emits a FieldDelta on exactly three
 * fields, status, startDate, endDate, and never looks at owner, resources
 * or category, which is the defect this ticket exists to make visible.
 * Measured 2026-09-07: `matched: 18, mismatched-field: 0` while three
 * fields differed on every one of those 18 rows.
 *
 * So this module re-derives AGREE/DISAGREE itself, field by field, against
 * an independently frozen prod snapshot that was read by a query this file
 * owns, see prod-snapshot.ts, never via runway-read.ts's narrower
 * projection.
 */
import { diffSheet } from "../diff";
import { buildPayloads } from "../payloads";
import type { DiffResult, LeafTask, Ledger, ParsedSheet, RowDiff, SheetConfig, SyncPayload } from "../types";
import type { RunwayClientBundle } from "../runway-read";
import {
  PARITY_FIELDS,
  type ParityFieldValues,
  type ParityResult,
  type ParityRowVerdict,
  type ParityVerdict,
  type ProdSnapshot,
  type ProdWeekItemRow,
} from "./types";

/**
 * _R1#159 will teach the tool to plan owner and resources. Until it does,
 * neither field has a real planning path this comparator can read, so
 * status/startDate/endDate come from the sheet leaf, category is the
 * sheet's own derived value, a genuine sheet-versus-prod comparison rather
 * than an assertion about a write, and owner/resources are hardcoded null.
 *
 * That hardcoded null is a claim about today's payloads.ts, not a
 * permanent fact, and a stale claim here would make _R1#159's own bar
 * unsatisfiable: once the tool starts planning owner or resources, this
 * comparator would keep reporting null and every row would stay DISAGREE
 * forever, even after the fix landed. assertToolNeverPlansField, called
 * from computeParity below on every run, turns that risk into a loud
 * failure instead of a silent one.
 */
function toolPlannedFields(leaf: { derivedStatus: string; startDate: string | null; endDate: string | null; category: string }): ParityFieldValues {
  return {
    status: leaf.derivedStatus,
    startDate: leaf.startDate,
    endDate: leaf.endDate,
    category: leaf.category,
    owner: null,
    resources: null,
  };
}

/**
 * Fails loudly the moment payloads.ts starts planning a field this
 * comparator still hardcodes to null. Checked two ways: a generic key on
 * the payload's own params, for an op that might carry the field directly,
 * and the updateWeekItemField convention, where `params.field` names which
 * WeekItem column is being written and `params.newValue` carries the
 * value.
 */
export function assertToolNeverPlansField(payloads: SyncPayload[], field: "owner" | "resources"): void {
  for (const payload of payloads) {
    const directValue = payload.params[field];
    if (directValue !== undefined && directValue !== null) {
      throw new Error(
        `PARITY INTEGRITY: payloads.ts now plans "${field}" via op "${payload.op}". toolPlannedFields' hardcoded null for "${field}" is stale, replace it with a real read of the tool's planning output before trusting this comparator.`
      );
    }
    if (payload.op === "updateWeekItemField" && payload.params.field === field) {
      throw new Error(
        `PARITY INTEGRITY: payloads.ts now proposes writing "${field}" via updateWeekItemField. toolPlannedFields' hardcoded null for "${field}" is stale, replace it with a real read of the tool's planning output before trusting this comparator.`
      );
    }
  }
}

function handActualFields(row: ProdWeekItemRow): ParityFieldValues {
  return {
    status: row.status,
    startDate: row.startDate,
    endDate: row.endDate,
    category: row.category,
    owner: row.owner,
    resources: row.resources,
  };
}

/**
 * Turn diff.ts's row-level matching output plus an independently frozen prod
 * snapshot into parity verdicts. Pure and directly testable, no DB, no
 * fixture parsing, so the broken-matcher guards below can be exercised with
 * hand-built inputs, never by weakening diff.ts itself.
 */
export function reconcileVerdicts(
  rowDiffs: RowDiff[],
  orphans: { weekItemId: string; title: string; weekOf: string | null; status: string | null }[],
  prodById: Map<string, ProdWeekItemRow>
): ParityRowVerdict[] {
  const rows: ParityRowVerdict[] = [];
  const claimed = new Set<string>();

  for (const rd of rowDiffs) {
    if (!rd.leaf) continue; // skipped-header/milestone/spacer/empty, no verdict
    const leaf = rd.leaf;

    if (rd.disposition === "missing-in-runway") {
      rows.push({
        rowNumber: leaf.rowNumber,
        taskNo: leaf.taskNo,
        title: leaf.title,
        verdict: "TOOL_ONLY",
        match: null,
        weekItemId: null,
        mismatchedFields: [],
        note: rd.note ?? null,
      });
      continue;
    }

    if (rd.disposition !== "matched" && rd.disposition !== "mismatched-field") continue;

    if (!rd.weekItemId) {
      throw new Error(
        `PARITY INTEGRITY: row ${leaf.rowNumber}, "${leaf.title}", disposition "${rd.disposition}" carries no weekItemId. Matcher is broken.`
      );
    }
    // Broken-matcher guard: a real matcher never assigns the same prod row to
    // two different sheet rows. If it does, the harness reds instead of
    // silently reporting a plausible-looking verdict for both.
    if (claimed.has(rd.weekItemId)) {
      throw new Error(
        `PARITY INTEGRITY: weekItemId ${rd.weekItemId} claimed by more than one sheet row. Matcher is broken.`
      );
    }
    const prodRow = prodById.get(rd.weekItemId);
    if (!prodRow) {
      // Broken-matcher guard: a real match always resolves inside the same
      // frozen bundle the snapshot was built from. A weekItemId absent from
      // the snapshot means the resolution is stale or corrupt. Never
      // downgrade this to a verdict.
      throw new Error(
        `PARITY INTEGRITY: row ${leaf.rowNumber}, "${leaf.title}", matched weekItemId ${rd.weekItemId}, absent from the frozen prod snapshot`
      );
    }
    claimed.add(rd.weekItemId);

    const tool = toolPlannedFields(leaf);
    const hand = handActualFields(prodRow);
    const mismatchedFields = PARITY_FIELDS.filter((f) => tool[f] !== hand[f]).map((f) => ({
      field: f,
      tool: tool[f],
      hand: hand[f],
    }));

    rows.push({
      rowNumber: leaf.rowNumber,
      taskNo: leaf.taskNo,
      title: leaf.title,
      verdict: mismatchedFields.length === 0 ? "AGREE" : "DISAGREE",
      match: {
        method: rd.note === "ledger-banked match" ? "ledger" : "fuzzy",
        score: rd.matchScore ?? null,
      },
      weekItemId: rd.weekItemId,
      mismatchedFields,
      note: rd.note ?? null,
    });
  }

  for (const orphan of orphans) {
    rows.push({
      rowNumber: null,
      taskNo: null,
      title: orphan.title,
      verdict: "HAND_ONLY",
      match: null,
      weekItemId: orphan.weekItemId,
      mismatchedFields: [],
      note: null,
    });
  }

  return rows;
}

function toMatchingBundle(snapshot: ProdSnapshot): RunwayClientBundle {
  return {
    client: snapshot.client,
    projects: snapshot.projects,
    weekItems: snapshot.weekItems.map((w) => ({
      id: w.id,
      projectId: w.projectId,
      title: w.title,
      weekOf: w.weekOf,
      startDate: w.startDate,
      endDate: w.endDate,
      status: w.status,
      category: w.category,
      notes: w.notes,
      // owner/resources deliberately dropped. RunwayClientBundle, diff.ts's
      // matching input, has no such fields, and matching never needs them.
    })),
  };
}

const STRUCTURAL_PROBE_LEAF: LeafTask = {
  rowNumber: 1,
  taskNo: "probe",
  rawLabel: "probe",
  title: "probe",
  resolvedTitle: "probe",
  startDate: "2026-01-01",
  endDate: "2026-01-01",
  weekOf: "2026-01-01",
  completed: false,
  derivedStatus: "scheduled",
  category: "kickoff",
  section: null,
  priority: null,
  predecessorRow: null,
  lag: null,
  resource: null,
  notes: "",
  notesTruncated: false,
  sortOrder: 0,
};

const STRUCTURAL_PROBE_CONFIG: SheetConfig = {
  sheetId: "structural-probe",
  clientSlug: "structural-probe",
  engagementCode: "PROBE-0000-00",
  label: "Structural Probe",
};

/**
 * A synthetic DiffResult engineered to force every payloads.ts branch that
 * can carry a field name, independent of what any one sheet or prod
 * snapshot happens to contain.
 *
 * A live run's own payloads are a valid thing to check too, but they are
 * not sufficient on their own: payloads.ts only emits a per-field payload
 * inside `disposition === "mismatched-field" && rd.deltas`, and that list
 * is empty whenever status, startDate and endDate all already agree,
 * exactly the shape every DISAGREE row on owner/resources/category takes
 * today, and the exact shape _R1#159's own NFM bar will take once it
 * lands. A guard keyed only to a live run's output is unreachable on
 * precisely the data it exists to protect. This probe forces both the
 * write branch and the flag-for-review branch, so a change to either one
 * is caught regardless of what any one sheet contains.
 */
export function structuralProbeDiff(): DiffResult {
  return {
    config: STRUCTURAL_PROBE_CONFIG,
    runId: "structural-probe",
    generatedAt: "",
    l1: { resolved: true, projectId: "p-probe", projectName: "Structural Probe" },
    rowDiffs: [
      {
        disposition: "mismatched-field",
        leaf: STRUCTURAL_PROBE_LEAF,
        weekItemId: "wi-probe",
        weekItemTitle: "probe",
        weekItemWeekOf: "2026-01-01",
        deltas: [
          { field: "status", sheet: "scheduled", runway: "completed", action: "write" },
          { field: "startDate", sheet: "2026-01-01", runway: "2026-01-02", action: "flag-for-review" },
        ],
      },
      { disposition: "missing-in-runway", leaf: STRUCTURAL_PROBE_LEAF },
    ],
    orphans: [],
    counts: {
      matched: 0,
      "missing-in-runway": 1,
      "mismatched-field": 1,
      "runway-only-orphan": 0,
      "skipped-empty": 0,
      "skipped-header": 0,
      "skipped-milestone": 0,
      "skipped-spacer": 0,
      "leaf-tasks": 2,
      collisions: 0,
    },
    flags: [],
  };
}

/**
 * Compute a full ParityResult from one frozen parsed sheet and one frozen
 * prod snapshot. A fresh, never-persisted ledger is used each call. The
 * parity harness re-derives everything from the two frozen inputs every
 * time, so two calls on the same inputs are byte-identical, per the
 * ticket's "Re-running on the same snapshots produces a byte-identical
 * file" rule.
 */
export function computeParity(
  parsed: ParsedSheet,
  prodSnapshot: ProdSnapshot,
  runId: string,
  sheetFrozenAt = ""
): ParityResult {
  const bundle = toMatchingBundle(prodSnapshot);
  const ledger: Ledger = { sheetId: parsed.config.sheetId, updatedAt: "", lastRunId: "", entries: {} };
  const diff = diffSheet(parsed, bundle, ledger, runId);
  const payloads = buildPayloads(diff, runId);
  const probePayloads = buildPayloads(structuralProbeDiff(), "structural-probe");
  for (const field of ["owner", "resources"] as const) {
    // Checked against this run's real output, which can legitimately be
    // empty, and against the unconditional structural probe, which cannot.
    assertToolNeverPlansField(payloads, field);
    assertToolNeverPlansField(probePayloads, field);
  }
  const prodById = new Map(prodSnapshot.weekItems.map((w) => [w.id, w]));
  const rows = reconcileVerdicts(diff.rowDiffs, diff.orphans, prodById);

  const counts: Record<ParityVerdict, number> = { AGREE: 0, DISAGREE: 0, TOOL_ONLY: 0, HAND_ONLY: 0 };
  for (const r of rows) counts[r.verdict]++;

  return {
    sheetId: parsed.config.sheetId,
    clientSlug: parsed.config.clientSlug,
    runId,
    sheetFrozenAt,
    prodFrozenAt: prodSnapshot.capturedAt,
    l1: diff.l1,
    rows,
    counts,
  };
}
