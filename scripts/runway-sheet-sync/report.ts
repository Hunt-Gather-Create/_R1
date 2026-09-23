/**
 * Human-readable diff report (markdown) — per-row disposition, summary
 * counts, shape-variance flags, orphans, and the first-run expectation note.
 */
import type { DiffResult, FieldDelta, RowDiff, SyncPayload } from "./types";
import type { ParityResult } from "./parity/types";

/**
 * _R1#160 item 4: the report must distinguish "compared and equal" from
 * "not compared" for every field the tool can write. Today both print
 * blank. status/startDate/endDate/weekOf/title all run a real sheet-vs-
 * Runway comparison on a matched row, so absent a delta they read "compared,
 * equal". category never runs that comparison on an update, TP ruling
 * 2026-09-22: the sheet has no category column to compare against. Its
 * own flag, when one exists, is visible in the Detail column instead.
 * owner/resources have no comparator at all (rule R1, _R1#159).
 */
const COMPARED_FIELDS: FieldDelta["field"][] = [
  "status",
  "startDate",
  "endDate",
  "weekOf",
  "title",
];
const NEVER_COMPARED_FIELDS = ["category", "owner", "resources"] as const;

function fieldComparisonLines(rd: RowDiff): string[] {
  const deltaByField = new Map((rd.deltas ?? []).map((d) => [d.field, d]));
  const lines: string[] = [];
  for (const f of COMPARED_FIELDS) {
    const d = deltaByField.get(f);
    lines.push(
      d
        ? `- ${f}: sheet=${d.sheet ?? "null"} runway=${d.runway ?? "null"} [${d.action}]`
        : `- ${f}: compared, equal`
    );
  }
  for (const f of NEVER_COMPARED_FIELDS) {
    lines.push(`- ${f}: not compared`);
  }
  return lines;
}

export interface RenderedReport {
  report: string;
  /**
   * True when `matched` is 0 against a ledger that already held rows from a
   * prior run — a matcher stuck at zero produces the same counts a genuine
   * first run would, so this is the signal a caller must treat as failure
   * (_R1#152). False for a true first run (empty ledger) or any non-zero
   * match count.
   */
  error: boolean;
}

/**
 * L1 resolution line. Named resolvers (_R1#153): when one fires, name it
 * and its score. When none fires, say so plainly and list every resolver's
 * best evidence instead of quoting one low score as if it were the answer.
 */
function l1ResolutionSummary(l1: DiffResult["l1"]): string {
  if (l1.resolved) {
    return `**${l1.projectName}** (method: ${l1.method}, score: ${l1.score})`;
  }
  if (l1.reviewCandidate) {
    const rc = l1.reviewCandidate;
    return (
      `**ROUTED TO REVIEW**: week-item-carry candidate "${rc.weekItemTitle}" (score ${rc.score}) ` +
      `under "${rc.projectName}", no L1 create proposed`
    );
  }
  const evidence = (l1.evidence ?? [])
    .map((e) => `${e.resolver}: ${e.detail}`)
    .join("; ");
  return `**UNRESOLVED: no resolver fired** (${evidence || "no evidence"}), L1 create proposed in payloads`;
}

export function renderReport(
  diff: DiffResult,
  payloads: SyncPayload[],
  priorLedgerRowCount = 0
): RenderedReport {
  const c = diff.counts;
  const lines: string[] = [];
  let error = false;

  lines.push(`# Runway Sheet Sync — Diff Report`);
  lines.push("");
  lines.push(`- Sheet: \`${diff.config.sheetId}\``);
  lines.push(
    `- Engagement: ${diff.config.label} (${diff.config.engagementCode})`
  );
  lines.push(`- Client: ${diff.config.clientSlug}`);
  lines.push(`- Run: \`${diff.runId}\` at ${diff.generatedAt}`);
  lines.push(`- L1 resolution: ${l1ResolutionSummary(diff.l1)}`);
  lines.push("");

  lines.push(`## Summary`);
  lines.push("");
  lines.push(`| Bucket | Count |`);
  lines.push(`|---|---|`);
  lines.push(`| Sheet leaf tasks | ${c["leaf-tasks"]} |`);
  lines.push(`| matched | ${c.matched} |`);
  lines.push(`| missing-in-runway | ${c["missing-in-runway"]} |`);
  lines.push(`| mismatched-field | ${c["mismatched-field"]} |`);
  lines.push(`| runway-only-orphan | ${c["runway-only-orphan"]} |`);
  lines.push(`| mid-week collisions | ${c.collisions} |`);
  lines.push(
    `| skipped (header/milestone/empty/spacer) | ${c["skipped-header"]}/${c["skipped-milestone"]}/${c["skipped-empty"]}/${c["skipped-spacer"]} |`
  );
  lines.push(`| ready-to-apply payloads emitted | ${payloads.length} |`);
  lines.push("");

  if (c.matched === 0 && c["leaf-tasks"] > 0) {
    if (priorLedgerRowCount === 0) {
      lines.push(
        `> **Expected on a first run:** near-zero matches. Existing Runway WIs were hand-created ` +
          `with different titles, so sheet tasks land "missing" and Runway items land "orphaned". ` +
          `That IS the delta — not a bug. The mismatched-field bucket becomes meaningful once the ` +
          `identity ledger has a clean run behind it (§3 Phase 1a).`
      );
    } else {
      error = true;
      lines.push(
        `> **ERROR: ledger populated, nothing matched.** The identity ledger already holds ` +
          `${priorLedgerRowCount} row(s) banked from a prior run, but this run matched 0 sheet ` +
          `tasks. A matcher stuck at zero would print the same counts a genuine first run does, so ` +
          `this is a failure, not a note. Do not apply these payloads until the matcher is fixed.`
      );
    }
    lines.push("");
  }

  if (diff.flags.length > 0) {
    lines.push(`## Shape-variance + data flags`);
    lines.push("");
    for (const f of diff.flags) lines.push(`- ${f}`);
    lines.push("");
  }

  lines.push(`## Sheet leaf tasks`);
  lines.push("");
  lines.push(`| Row | Task | Title | Dates | Status→ | Disposition | Detail |`);
  lines.push(`|---|---|---|---|---|---|---|`);
  for (const rd of diff.rowDiffs) {
    if (!rd.leaf) continue;
    const l = rd.leaf;
    const dates = `${l.startDate ?? "?"} → ${l.endDate ?? "?"}`;
    const detail =
      rd.deltas && rd.deltas.length > 0
        ? rd.deltas
            .map(
              (d) =>
                `${d.field}: ${d.runway ?? "null"}→${d.sheet ?? "null"} [${d.action}]`
            )
            .join("; ")
        : (rd.note ?? "");
    const title =
      l.resolvedTitle === l.title
        ? l.title
        : `${l.resolvedTitle} (disambiguated)`;
    lines.push(
      `| ${l.rowNumber} | ${l.taskNo ?? "—"} | ${title} | ${dates} | ${l.derivedStatus}/${l.category} | ${rd.disposition}${rd.collision ? " ⚠️" : ""} | ${detail} |`
    );
  }
  lines.push("");

  const comparedRows = diff.rowDiffs.filter(
    (rd) =>
      rd.leaf &&
      (rd.disposition === "matched" || rd.disposition === "mismatched-field")
  );
  if (comparedRows.length > 0) {
    lines.push(`## Field comparison`);
    lines.push("");
    for (const rd of comparedRows) {
      const l = rd.leaf!;
      lines.push(`### Row ${l.rowNumber} (${l.taskNo ?? "n/a"}): ${l.title}`);
      lines.push("");
      for (const line of fieldComparisonLines(rd)) lines.push(line);
      lines.push("");
    }
  }

  if (diff.orphans.length > 0) {
    lines.push(`## Runway-only items under this L1 (no sheet counterpart)`);
    lines.push("");
    lines.push(`| WeekItem | Title | weekOf | Status |`);
    lines.push(`|---|---|---|---|`);
    for (const o of diff.orphans) {
      lines.push(
        `| ${o.weekItemId} | ${o.title} | ${o.weekOf ?? "-"} | ${o.status ?? "-"} |`
      );
    }
    lines.push("");
    lines.push(
      `> Policy: orphans are FLAGGED only. The sync never deletes Runway items (§2.9).`
    );
    lines.push("");
  }

  return { report: lines.join("\n"), error };
}

/**
 * Human-readable rendering of a parity verdict file, _R1#151. The verdict
 * JSON is the artifact of record. This is a reader's aid over it and is
 * never re-parsed as an input, so it carries no byte-identical requirement.
 */
/**
 * _R1#156 cost line. Deliberately NOT part of ParityResult (parity/types.ts)
 * or the verdict .json cli.ts writes — that file's bytes feed
 * computeParityRunId and the CLI's own "byte-identical on the same inputs"
 * rule, and wall-clock time is never the same between two runs. Cost lives
 * only in this reader's aid, which carries no byte-identical requirement.
 */
export interface ParityCost {
  wallClockMs: number;
  /** Always 0 today — nothing in the sync pipeline calls a model
   * (_R1#156). Printed honestly rather than omitted, so "how token
   * efficient is this" has a real answer instead of silence. */
  tokens: number;
}

export function renderParityReport(
  result: ParityResult,
  cost?: ParityCost
): string {
  const lines: string[] = [];
  lines.push(`# Runway Sheet Sync, Parity Report`);
  lines.push("");
  lines.push(`- Sheet: \`${result.sheetId}\``);
  lines.push(`- Client: ${result.clientSlug}`);
  lines.push(`- Run: \`${result.runId}\``);
  lines.push(`- Sheet frozen at: ${result.sheetFrozenAt || "n/a"}`);
  lines.push(`- Prod frozen at: ${result.prodFrozenAt}`);
  lines.push("");

  lines.push(`## Summary`);
  lines.push("");
  lines.push(`| Verdict | Count |`);
  lines.push(`|---|---|`);
  lines.push(`| AGREE | ${result.counts.AGREE} |`);
  lines.push(`| DISAGREE | ${result.counts.DISAGREE} |`);
  lines.push(`| TOOL_ONLY | ${result.counts.TOOL_ONLY} |`);
  lines.push(`| HAND_ONLY | ${result.counts.HAND_ONLY} |`);
  lines.push("");
  lines.push(`interventions: ${result.interventions}`);
  lines.push("");

  if (cost) {
    lines.push(`## Cost`);
    lines.push("");
    lines.push(`- wall-clock: ${cost.wallClockMs}ms`);
    lines.push(`- tokens: ${cost.tokens}, no model in the path`);
    lines.push("");
  }

  lines.push(`## Rows`);
  lines.push("");
  lines.push(`| Row | Task | Title | Verdict | Match | Mismatched fields |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const r of result.rows) {
    const match = r.match
      ? `${r.match.method}, score ${r.match.score ?? "n/a"}`
      : "n/a";
    const mismatched = r.mismatchedFields
      .map(
        (f) => `${f.field}: tool=${f.tool ?? "null"} hand=${f.hand ?? "null"}`
      )
      .join("; ");
    lines.push(
      `| ${r.rowNumber ?? "n/a"} | ${r.taskNo ?? "n/a"} | ${r.title} | ${r.verdict} | ${match} | ${mismatched} |`
    );
  }
  lines.push("");

  return lines.join("\n");
}
