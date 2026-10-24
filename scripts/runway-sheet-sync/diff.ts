/**
 * Diff engine — parsed sheet vs Runway prod. Produces disposition buckets,
 * §2.4-aware field deltas, orphans, and mid-week collision flags.
 *
 * First-run expectation (§3 Phase 1a): near-zero matches. Hand-created WIs
 * carry different titles; ~everything lands missing + orphaned. That IS the
 * delta, not a bug.
 */
import { sorensenDice } from "../../src/lib/runway/fuzzy-match";
import { matchedDeltas } from "./field-deltas";
import { resolveL1 } from "./l1-resolve";
import { ledgerKey, linkEntry, normalizeTitle } from "./ledger";
import { WI_CANDIDATE_THRESHOLD, WI_MATCH_THRESHOLD } from "./match-thresholds";
import { attachPeople } from "./people-delta";
import { planPeople, ROLE_MAP, type RoleMap } from "./role-map";
import type { RunwayClientBundle } from "./runway-read";
import type { DiffResult, Disposition, Ledger, ParsedSheet, RowDiff } from "./types";

export { resolveL1 } from "./l1-resolve";
export { categoryDelta, statusDelta, titleDelta, weekOfDelta } from "./field-deltas";

export function diffSheet(
  parsed: ParsedSheet,
  bundle: RunwayClientBundle,
  ledger: Ledger,
  runId: string,
  roleMap: RoleMap = ROLE_MAP
): DiffResult {
  const l1 = resolveL1(parsed, bundle, ledger);
  const rowDiffs: RowDiff[] = [];
  const flags = [...parsed.flags];
  const matchedWiIds = new Set<string>();

  if (l1.resolved && l1.weekItemCarry) {
    flags.push(
      `L1: resolved via week-item-carry, engagement carried as week item "${l1.weekItemCarry.weekItemTitle}" (id ${l1.weekItemCarry.weekItemId}) under "${l1.projectName}"`
    );
  }

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
        const deltas = matchedDeltas(leaf, wi, true, planPeople(leaf.resource, parsed.config.clientSlug, roleMap));
        rowDiffs.push({
          disposition: deltas.length > 0 ? "mismatched-field" : "matched",
          leaf,
          weekItemId: wi.id,
          weekItemTitle: wi.title,
          weekItemWeekOf: wi.weekOf ?? null,
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

    // Fuzzy match ONLY within the resolved L1's WIs — a client-wide pool
    // would let a leaf silently adopt a WI under a different L1 (§2.7/§2.9
    // never-silently-adopt hazard). Client-wide fuzzy is used only when no
    // L1 resolved at all; exact cross-L1 hits still route to the collision
    // branch below.
    const pool = l1.resolved ? l1Wis : clientWis;
    let best: {
      wi: RunwayClientBundle["weekItems"][number];
      score: number;
    } | null = null;
    for (const wi of pool) {
      if (matchedWiIds.has(wi.id)) continue;
      // Matching deliberately uses the ORIGINAL title, not resolvedTitle —
      // the disambiguation suffix exists only to keep future CREATES from
      // colliding; prod WIs were never created with it.
      const score = sorensenDice(
        normalizeTitle(leaf.title),
        normalizeTitle(wi.title)
      );
      if (best === null || score > best.score) best = { wi, score };
    }

    if (best && best.score >= WI_MATCH_THRESHOLD) {
      matchedWiIds.add(best.wi.id);
      const deltas = matchedDeltas(leaf, best.wi, false, planPeople(leaf.resource, parsed.config.clientSlug, roleMap));
      rowDiffs.push({
        disposition: deltas.length > 0 ? "mismatched-field" : "matched",
        leaf,
        weekItemId: best.wi.id,
        weekItemTitle: best.wi.title,
        weekItemWeekOf: best.wi.weekOf ?? null,
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
          .map((w) => ({
            weekItemId: w.id,
            title: w.title,
            weekOf: w.weekOf ?? null,
            status: w.status ?? null,
          }))
      : [];
  if (parsed.leafTasks.length === 0 && l1.resolved && l1Wis.length > 0) {
    flags.push(
      `L1: resolved to "${l1.projectName}" with ${l1Wis.length} prod WIs, but sheet has no leaf tasks — orphan analysis skipped (unfilled template)`
    );
  }
  if (!l1.resolved && parsed.leafTasks.length > 0) {
    flags.push(
      l1.reviewCandidate
        ? `L1: no resolver fired with confidence, week-item-carry candidate "${l1.reviewCandidate.weekItemTitle}" (score ${l1.reviewCandidate.score}) under "${l1.reviewCandidate.projectName}" routed to review, orphan analysis skipped, no create proposed`
        : "L1: no matching Runway project resolved, orphan analysis skipped, L1 create proposed in payloads"
    );
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
    "role-map-refusals": 0,
  } as DiffResult["counts"];
  for (const rd of rowDiffs) {
    counts[rd.disposition as Disposition]++;
    if (rd.collision) counts.collisions++;
    counts["role-map-refusals"] += attachPeople(rd, parsed.config.clientSlug, roleMap);
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
