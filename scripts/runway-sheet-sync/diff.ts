/**
 * Diff engine — parsed sheet vs Runway prod. Produces disposition buckets,
 * §2.4-aware field deltas, orphans, and mid-week collision flags.
 *
 * First-run expectation (§3 Phase 1a): near-zero matches. Hand-created WIs
 * carry different titles; ~everything lands missing + orphaned. That IS the
 * delta, not a bug.
 */
import { sorensenDice } from "../../src/lib/runway/fuzzy-match";
import { ledgerKey, linkEntry, normalizeTitle } from "./ledger";
import type { RunwayClientBundle } from "./runway-read";
import type {
  DiffResult,
  Disposition,
  FieldDelta,
  LeafTask,
  Ledger,
  ParsedSheet,
  RowDiff,
} from "./types";

/** Accept as the same task at/above this similarity. */
const WI_MATCH_THRESHOLD = 0.75;
/** Mention as a near-miss candidate at/above this similarity. */
const WI_CANDIDATE_THRESHOLD = 0.55;

const CODE_NORM = /[^a-z0-9]/g;

function normCode(s: string): string {
  return s.toLowerCase().replace(CODE_NORM, "");
}

/**
 * Resolve the sheet's L1 project. Explicit code match beats fuzzy title.
 * Fuzzy runs against engagement title + config label (§2.3: fuzzy on first
 * resolve only — the ledger/report banks the id for later runs).
 */
export function resolveL1(
  parsed: ParsedSheet,
  bundle: RunwayClientBundle
): DiffResult["l1"] {
  // Config code first; the drifted banner code second (R7 — prod may track
  // the engagement under the code the sheet BODY carries, not the real one).
  const codes = [parsed.config.engagementCode, parsed.meta.codeDrift ? parsed.meta.bannerCode : null]
    .filter((c): c is string => c !== null)
    .map(normCode);
  for (const code of codes) {
    for (const p of bundle.projects) {
      const hay = normCode(`${p.name} ${p.notes ?? ""}`);
      if (code.length > 0 && hay.includes(code)) {
        return { resolved: true, projectId: p.id, projectName: p.name, score: 1, method: "code" };
      }
    }
  }

  const needles = [parsed.meta.engagementTitle, parsed.config.label].filter(
    (n): n is string => n !== null && n.length > 0
  );
  let best: { p: RunwayClientBundle["projects"][number]; score: number } | null = null;
  for (const p of bundle.projects) {
    for (const needle of needles) {
      const score = sorensenDice(normalizeTitle(needle), normalizeTitle(p.name));
      if (best === null || score > best.score) best = { p, score };
    }
  }
  if (best && best.score >= WI_MATCH_THRESHOLD) {
    return {
      resolved: true,
      projectId: best.p.id,
      projectName: best.p.name,
      score: Number(best.score.toFixed(3)),
      method: "fuzzy",
    };
  }
  return { resolved: false, method: "none", score: best ? Number(best.score.toFixed(3)) : 0 };
}

/**
 * §2.4 UPDATE policy applied to a matched pair. Only actionable deltas
 * become writes; protected statuses and completed-reverts become flags.
 */
export function statusDelta(sheetDerived: string, runway: string | null): FieldDelta | null {
  const rw = runway ?? "scheduled"; // NULL readable as scheduled during rollout (schema comment)
  if (rw === sheetDerived) return null;
  if (rw === "blocked" || rw === "at-risk" || rw === "in-progress") {
    return { field: "status", sheet: sheetDerived, runway: rw, action: "protected-no-write" };
  }
  if (rw === "completed" && sheetDerived === "scheduled") {
    // Sheet checkbox FALSE but Runway completed → editorial call, flag only.
    return { field: "status", sheet: sheetDerived, runway: rw, action: "flag-for-review" };
  }
  if (rw === "scheduled" && sheetDerived === "completed") {
    return { field: "status", sheet: sheetDerived, runway: rw, action: "write" };
  }
  return { field: "status", sheet: sheetDerived, runway: rw, action: "flag-for-review" };
}

function dateDeltas(leaf: LeafTask, wi: RunwayClientBundle["weekItems"][number]): FieldDelta[] {
  const deltas: FieldDelta[] = [];
  // FORWARD date-move ordering (§2.8): endDate first, then startDate —
  // emit in that order so payload applyOrder inherits it.
  if (leaf.endDate && leaf.endDate !== (wi.endDate ?? null)) {
    deltas.push({ field: "endDate", sheet: leaf.endDate, runway: wi.endDate ?? null, action: "write" });
  }
  if (leaf.startDate && leaf.startDate !== (wi.startDate ?? null)) {
    deltas.push({ field: "startDate", sheet: leaf.startDate, runway: wi.startDate ?? null, action: "write" });
  }
  return deltas;
}

export function diffSheet(
  parsed: ParsedSheet,
  bundle: RunwayClientBundle,
  ledger: Ledger,
  runId: string
): DiffResult {
  const l1 = resolveL1(parsed, bundle);
  const rowDiffs: RowDiff[] = [];
  const flags = [...parsed.flags];
  const matchedWiIds = new Set<string>();

  // Skipped-row dispositions from the classifier.
  for (const row of parsed.rows) {
    if (row.type === "section-header" || row.type === "rollup") {
      rowDiffs.push({ disposition: "skipped-header" });
    } else if (row.type === "milestone") {
      rowDiffs.push({ disposition: "skipped-milestone" });
    } else if (row.type === "empty-template") {
      rowDiffs.push({ disposition: "skipped-empty" });
    } else if (row.type === "spacer") {
      rowDiffs.push({ disposition: "skipped-spacer" });
    }
  }

  const l1Wis = l1.resolved
    ? bundle.weekItems.filter((w) => w.projectId === l1.projectId)
    : [];
  const clientWis = bundle.weekItems;

  for (const leaf of parsed.leafTasks) {
    // Ledger-first: a prior run may have banked the WI id.
    const banked = ledger.entries[ledgerKey(leaf)];
    if (banked?.weekItemId) {
      const wi = clientWis.find((w) => w.id === banked.weekItemId);
      if (wi) {
        matchedWiIds.add(wi.id);
        const deltas = [...dateDeltas(leaf, wi)];
        const sd = statusDelta(leaf.derivedStatus, wi.status);
        if (sd) deltas.push(sd);
        rowDiffs.push({
          disposition: deltas.length > 0 ? "mismatched-field" : "matched",
          leaf,
          weekItemId: wi.id,
          weekItemTitle: wi.title,
          matchScore: 1,
          deltas,
          note: "ledger-banked match",
        });
        linkEntry(ledger, leaf, wi.id, "matched");
        continue;
      }
      flags.push(
        `LEDGER: entry ${banked.key} points at WI ${banked.weekItemId} which no longer exists in prod`
      );
    }

    // Fuzzy match within the resolved L1's WIs first, then client-wide.
    const pool = l1Wis.length > 0 ? l1Wis : clientWis;
    let best: { wi: RunwayClientBundle["weekItems"][number]; score: number } | null = null;
    for (const wi of pool) {
      if (matchedWiIds.has(wi.id)) continue;
      const score = sorensenDice(normalizeTitle(leaf.title), normalizeTitle(wi.title));
      if (best === null || score > best.score) best = { wi, score };
    }

    if (best && best.score >= WI_MATCH_THRESHOLD) {
      matchedWiIds.add(best.wi.id);
      const deltas = [...dateDeltas(leaf, best.wi)];
      const sd = statusDelta(leaf.derivedStatus, best.wi.status);
      if (sd) deltas.push(sd);
      rowDiffs.push({
        disposition: deltas.length > 0 ? "mismatched-field" : "matched",
        leaf,
        weekItemId: best.wi.id,
        weekItemTitle: best.wi.title,
        matchScore: Number(best.score.toFixed(3)),
        deltas,
      });
      linkEntry(ledger, leaf, best.wi.id, "matched");
      continue;
    }

    // Mid-week collision (§2.7/§2.9): exact (title, weekOf) exists at client
    // level outside the resolved L1 and outside the ledger — flag, don't adopt.
    const collision = clientWis.find(
      (w) =>
        !matchedWiIds.has(w.id) &&
        normalizeTitle(w.title) === normalizeTitle(leaf.title) &&
        (w.weekOf ?? null) === leaf.weekOf &&
        (!l1.resolved || w.projectId !== l1.projectId)
    );
    if (collision) {
      rowDiffs.push({
        disposition: "missing-in-runway",
        leaf,
        collision: true,
        note: `collision: WI ${collision.id} ("${collision.title}") matches (title, weekOf) under a different L1 — flagged for AM, not adopted`,
      });
      linkEntry(ledger, leaf, null, "collision-flagged");
      continue;
    }

    rowDiffs.push({
      disposition: "missing-in-runway",
      leaf,
      note:
        best && best.score >= WI_CANDIDATE_THRESHOLD
          ? `near-miss candidate: "${best.wi.title}" (score ${best.score.toFixed(3)})`
          : undefined,
    });
    linkEntry(ledger, leaf, null, "pending-create");
  }

  // Orphans: WIs under the resolved L1 no sheet row claimed. Skipped for
  // unfilled templates — 0 leaf tasks would mark every prod WI "orphaned".
  const orphans =
    parsed.leafTasks.length > 0
      ? l1Wis
          .filter((w) => !matchedWiIds.has(w.id))
          .map((w) => ({ weekItemId: w.id, title: w.title, weekOf: w.weekOf ?? null, status: w.status ?? null }))
      : [];
  if (parsed.leafTasks.length === 0 && l1.resolved && l1Wis.length > 0) {
    flags.push(
      `L1: resolved to "${l1.projectName}" with ${l1Wis.length} prod WIs, but sheet has no leaf tasks — orphan analysis skipped (unfilled template)`
    );
  }
  if (!l1.resolved && parsed.leafTasks.length > 0) {
    flags.push("L1: no matching Runway project resolved — orphan analysis skipped, L1 create proposed in payloads");
  }

  const counts = {
    "leaf-tasks": parsed.leafTasks.length,
    matched: 0,
    "missing-in-runway": 0,
    "mismatched-field": 0,
    "runway-only-orphan": orphans.length,
    "skipped-empty": 0,
    "skipped-header": 0,
    "skipped-milestone": 0,
    "skipped-spacer": 0,
    collisions: 0,
  } as DiffResult["counts"];
  for (const rd of rowDiffs) {
    counts[rd.disposition as Disposition]++;
    if (rd.collision) counts.collisions++;
  }

  return {
    config: parsed.config,
    runId,
    generatedAt: new Date().toISOString(),
    l1,
    rowDiffs,
    orphans,
    counts,
    flags,
  };
}
