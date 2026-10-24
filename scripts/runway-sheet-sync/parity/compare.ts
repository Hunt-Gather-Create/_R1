/**
 * Parity harness core, _R1#151, the second instrument.
 *
 * `diffSheet`, thread B, read-only here, resolves WHICH prod row a sheet
 * leaf matches. That resolution work is reused as-is. What is NOT reused
 * is diff.ts's own field verdict: diff.ts decides what to write, this
 * module decides whether the tool and the hand walk agree. Measured
 * 2026-09-07: `matched: 18, mismatched-field: 0` while three fields
 * differed on every one of those 18 rows.
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
import { planPeople, type RoleMap } from "../role-map";
import { PEOPLE_FIELDS, type PeopleField } from "../sync-fields";
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
 * The tool's own plan for one row. status, startDate and endDate come from
 * the sheet leaf, category is the sheet's derived value, and owner and
 * resources are whatever the role map planned for the row, null when the
 * row has no label or a label the map refused.
 */
function toolPlannedFields(rd: RowDiff & { leaf: LeafTask }): ParityFieldValues {
  const people = rd.people?.kind === "planned" ? rd.people : null;
  return {
    status: rd.leaf.derivedStatus,
    startDate: rd.leaf.startDate,
    endDate: rd.leaf.endDate,
    category: rd.leaf.category,
    owner: people?.owner ?? null,
    resources: people?.resources ?? null,
  };
}

/** The owner or resources value a payload would set, or undefined when it sets neither. */
function plannedPeopleValue(payload: SyncPayload, field: PeopleField): unknown {
  const direct = payload.params[field];
  if (direct !== undefined && direct !== null) return direct;
  if (payload.params.field === field) return payload.params.newValue ?? payload.params.sheetValue ?? null;
  return undefined;
}

/**
 * Rule R1 as amended 2026-10-24: owner and resources come only from the
 * role map. Every payload that plans either field is checked against an
 * independent re-resolution of its own source row's column J label, so a
 * value typed anywhere else in payloads.ts, or a stale plan, fails loudly.
 * Checked two ways, as the guard it replaces was: a key directly on params,
 * and `params.field` naming the field, under any op.
 */
export function assertPeopleFromRoleMap(
  payloads: SyncPayload[],
  clientSlug: string,
  leaves: LeafTask[],
  roleMap: RoleMap
): void {
  const leafByRow = new Map(leaves.map((l) => [l.rowNumber, l]));
  for (const payload of payloads) {
    for (const field of PEOPLE_FIELDS) {
      const value = plannedPeopleValue(payload, field);
      if (value === undefined) continue;
      const leaf = leafByRow.get(payload.source.rowNumber);
      const plan = leaf ? planPeople(leaf.resource, clientSlug, roleMap) : null;
      if (plan?.kind !== "planned" || plan[field] !== value) {
        throw new Error(
          `PARITY INTEGRITY: op "${payload.op}" on row ${payload.source.rowNumber} plans "${field}" = ${JSON.stringify(value)} without a role map source. Owner and resources come only from role-map.ts, rule R1 as amended 2026-10-24.`
        );
      }
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

    const tool = toolPlannedFields({ ...rd, leaf });
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
      owner: w.owner,
      resources: w.resources,
      notes: w.notes,
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
 * is empty whenever every compared field already agrees. A guard keyed
 * only to a live run's output is unreachable on precisely the data it
 * exists to protect. The probe leaf has no column J label, so any owner
 * or resources value on a probe payload is unsourced. This probe forces both the
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
      "role-map-refusals": 0,
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
export interface ParityOptions {
  runId: string;
  sheetFrozenAt?: string;
  roleMap: RoleMap;
}

export function computeParity(
  parsed: ParsedSheet,
  prodSnapshot: ProdSnapshot,
  { runId, sheetFrozenAt = "", roleMap }: ParityOptions
): ParityResult {
  const bundle = toMatchingBundle(prodSnapshot);
  const ledger: Ledger = { sheetId: parsed.config.sheetId, updatedAt: "", lastRunId: "", entries: {} };
  const diff = diffSheet(parsed, bundle, ledger, { runId, roleMap });
  const payloads = buildPayloads(diff, runId);
  const probe = structuralProbeDiff();
  // Checked against this run's real output, which can legitimately be
  // empty, and against the unconditional structural probe, which cannot.
  assertPeopleFromRoleMap(payloads, parsed.config.clientSlug, parsed.leafTasks, roleMap);
  assertPeopleFromRoleMap(buildPayloads(probe, "structural-probe"), probe.config.clientSlug, [STRUCTURAL_PROBE_LEAF], roleMap);
  const prodById = new Map(prodSnapshot.weekItems.map((w) => [w.id, w]));
  const rows = reconcileVerdicts(diff.rowDiffs, diff.orphans, prodById);

  const counts: Record<ParityVerdict, number> = { AGREE: 0, DISAGREE: 0, TOOL_ONLY: 0, HAND_ONLY: 0 };
  for (const r of rows) counts[r.verdict]++;

  // _R1#156 intervention count, defined ONCE, here: HAND_ONLY + DISAGREE,
  // the rows the tool could not resolve on its own. HAND_ONLY is a row the
  // tool never even proposed; DISAGREE is a row the tool proposed something
  // for but got wrong. Both needed a person to notice and reason about the
  // row, which is the bar the ticket sets. TOOL_ONLY and AGREE are excluded
  // on purpose: TOOL_ONLY means the tool proposed something prod has never
  // seen, not that it was wrong, and AGREE means it needed no help at all.
  // This number must never be reduced by a post-run tidy — a row that
  // needed a human to reason about it during the walk stays counted even
  // after someone fixes it by hand afterwards, per the ticket's "the trap
  // to design out".
  const interventions = counts.HAND_ONLY + counts.DISAGREE;

  return {
    sheetId: parsed.config.sheetId,
    clientSlug: parsed.config.clientSlug,
    runId,
    sheetFrozenAt,
    prodFrozenAt: prodSnapshot.capturedAt,
    l1: diff.l1,
    rows,
    counts,
    interventions,
  };
}
