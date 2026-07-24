/**
 * Human-readable diff report (markdown) — per-row disposition, summary
 * counts, shape-variance flags, orphans, and the first-run expectation note.
 */
import type { DiffResult, SyncPayload } from "./types";

export function renderReport(diff: DiffResult, payloads: SyncPayload[]): string {
  const c = diff.counts;
  const lines: string[] = [];

  lines.push(`# Runway Sheet Sync — Diff Report`);
  lines.push("");
  lines.push(`- Sheet: \`${diff.config.sheetId}\``);
  lines.push(`- Engagement: ${diff.config.label} (${diff.config.engagementCode})`);
  lines.push(`- Client: ${diff.config.clientSlug}`);
  lines.push(`- Run: \`${diff.runId}\` at ${diff.generatedAt}`);
  lines.push(
    `- L1 resolution: ${
      diff.l1.resolved
        ? `**${diff.l1.projectName}** (method: ${diff.l1.method}, score: ${diff.l1.score})`
        : `**UNRESOLVED** (best fuzzy score: ${diff.l1.score ?? 0}) — L1 create proposed in payloads`
    }`
  );
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
    lines.push(
      `> **Expected on a first run:** near-zero matches. Existing Runway WIs were hand-created ` +
        `with different titles, so sheet tasks land "missing" and Runway items land "orphaned". ` +
        `That IS the delta — not a bug. The mismatched-field bucket becomes meaningful once the ` +
        `identity ledger has a clean run behind it (§3 Phase 1a).`
    );
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
        ? rd.deltas.map((d) => `${d.field}: ${d.runway ?? "null"}→${d.sheet ?? "null"} [${d.action}]`).join("; ")
        : (rd.note ?? "");
    const title = l.resolvedTitle === l.title ? l.title : `${l.resolvedTitle} (disambiguated)`;
    lines.push(
      `| ${l.rowNumber} | ${l.taskNo ?? "—"} | ${title} | ${dates} | ${l.derivedStatus}/${l.category} | ${rd.disposition}${rd.collision ? " ⚠️" : ""} | ${detail} |`
    );
  }
  lines.push("");

  if (diff.orphans.length > 0) {
    lines.push(`## Runway-only items under this L1 (no sheet counterpart)`);
    lines.push("");
    lines.push(`| WeekItem | Title | weekOf | Status |`);
    lines.push(`|---|---|---|---|`);
    for (const o of diff.orphans) {
      lines.push(`| ${o.weekItemId} | ${o.title} | ${o.weekOf ?? "—"} | ${o.status ?? "—"} |`);
    }
    lines.push("");
    lines.push(`> Policy: orphans are FLAGGED only. The sync never deletes Runway items (§2.9).`);
    lines.push("");
  }

  return lines.join("\n");
}
