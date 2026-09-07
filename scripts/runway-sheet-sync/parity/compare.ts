/**
 * Parity harness core (_R1#151) — the second instrument.
 *
 * `diffSheet` (thread B, read-only here) resolves WHICH prod row a sheet
 * leaf matches — that resolution work is reused as-is. What is NOT reused
 * is diff.ts's own field comparison: it emits a FieldDelta on exactly three
 * fields (status, startDate, endDate) and never looks at owner, resources
 * or category, which is the defect this ticket exists to make visible
 * (measured 2026-09-07: `matched: 18, mismatched-field: 0` while three
 * fields differed on every one of those 18 rows).
 *
 * So this module re-derives AGREE/DISAGREE itself, field by field, against
 * an independently frozen prod snapshot that was read by a query this file
 * owns (see prod-snapshot.ts) — never via runway-read.ts's narrower
 * projection.
 */
import { diffSheet } from "../diff";
import type { Ledger, ParsedSheet, RowDiff } from "../types";
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

/** The tool never plans owner/resources on any payload (payloads.ts never
 * sets them) and always derives a non-null category on CREATE — those are
 * facts about the tool, not read from data, same reasoning as
 * KNOWN_TEMPLATE_IDS in render.js (plan §2.4). */
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
 * snapshot into parity verdicts. Pure and directly testable — no DB, no
 * fixture parsing — so the broken-matcher guards below can be exercised with
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
    if (!rd.leaf) continue; // skipped-header/milestone/spacer/empty — no verdict
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
        `PARITY INTEGRITY: row ${leaf.rowNumber} ("${leaf.title}") disposition "${rd.disposition}" carries no weekItemId — matcher is broken`
      );
    }
    // Broken-matcher guard: a real matcher never assigns the same prod row to
    // two different sheet rows. If it does, the harness reds instead of
    // silently reporting a plausible-looking verdict for both.
    if (claimed.has(rd.weekItemId)) {
      throw new Error(
        `PARITY INTEGRITY: weekItemId ${rd.weekItemId} claimed by more than one sheet row — matcher is broken`
      );
    }
    const prodRow = prodById.get(rd.weekItemId);
    if (!prodRow) {
      // Broken-matcher guard: a real match always resolves inside the same
      // frozen bundle the snapshot was built from. A weekItemId absent from
      // the snapshot means the resolution is stale or corrupt — never
      // downgrade this to a verdict.
      throw new Error(
        `PARITY INTEGRITY: row ${leaf.rowNumber} ("${leaf.title}") matched weekItemId ${rd.weekItemId}, absent from the frozen prod snapshot`
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
      // owner/resources deliberately dropped — RunwayClientBundle (diff.ts's
      // matching input) has no such fields, and matching never needs them.
    })),
  };
}

/**
 * Compute a full ParityResult from one frozen parsed sheet and one frozen
 * prod snapshot. A fresh, never-persisted ledger is used each call — the
 * parity harness re-derives everything from the two frozen inputs every
 * time, so two calls on the same inputs are byte-identical (ticket,
 * "Re-running on the same snapshots produces a byte-identical file").
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
