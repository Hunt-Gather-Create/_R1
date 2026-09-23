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

/** Same two floors, applied to week-item-carry's title-vs-WI-title score. */
const CARRY_MATCH_THRESHOLD = 0.75;
const CARRY_CANDIDATE_THRESHOLD = 0.55;

const CODE_NORM = /[^a-z0-9]/g;

function normCode(s: string): string {
  return s.toLowerCase().replace(CODE_NORM, "");
}

type L1Method = "code" | "ledger-identity" | "fuzzy" | "week-item-carry";

interface L1Hit {
  resolved: true;
  projectId: string;
  projectName: string;
  score: number;
  method: L1Method;
  weekItemCarry?: { weekItemId: string; weekItemTitle: string };
}

interface L1Miss {
  resolved: false;
  resolver: L1Method;
  detail: string;
  score: number;
  /** week-item-carry only: a below-match-threshold candidate. */
  reviewCandidate?: {
    weekItemId: string;
    weekItemTitle: string;
    projectId: string;
    projectName: string;
    score: number;
  };
}

type L1Outcome = L1Hit | L1Miss;

function engagementTitleNeedles(parsed: ParsedSheet): string[] {
  return [parsed.meta.engagementTitle, parsed.config.label].filter(
    (n): n is string => n !== null && n.length > 0
  );
}

/** Resolver 1: explicit code match against project name/notes (§2.3, R7). */
function resolveByEngagementCode(
  parsed: ParsedSheet,
  bundle: RunwayClientBundle
): L1Outcome {
  // Config code first; the drifted banner code second (R7 — prod may track
  // the engagement under the code the sheet BODY carries, not the real one).
  const codes = [
    parsed.config.engagementCode,
    parsed.meta.codeDrift ? parsed.meta.bannerCode : null,
  ]
    .filter((c): c is string => c !== null)
    .map(normCode);
  for (const code of codes) {
    for (const p of bundle.projects) {
      const hay = normCode(`${p.name} ${p.notes ?? ""}`);
      if (code.length > 0 && hay.includes(code)) {
        return {
          resolved: true,
          projectId: p.id,
          projectName: p.name,
          score: 1,
          method: "code",
        };
      }
    }
  }
  return {
    resolved: false,
    resolver: "code",
    detail:
      codes.length > 0
        ? `no project name/notes contained code(s) ${codes.join(", ")}`
        : "no engagement code available on this sheet",
    score: 0,
  };
}

/** Resolver 2: an L1 the ledger already banked a WI under, for this sheet. */
function resolveByLedgerIdentity(
  bundle: RunwayClientBundle,
  ledger: Ledger
): L1Outcome {
  const bankedWiIds = Object.values(ledger.entries)
    .map((e) => e.weekItemId)
    .filter((id): id is string => id !== null);
  if (bankedWiIds.length === 0) {
    return {
      resolved: false,
      resolver: "ledger-identity",
      detail: "no ledger entries carry a banked week item",
      score: 0,
    };
  }
  const projectIds = new Set<string>();
  for (const id of bankedWiIds) {
    const wi = bundle.weekItems.find((w) => w.id === id);
    if (wi) projectIds.add(wi.projectId);
  }
  if (projectIds.size === 1) {
    const [projectId] = [...projectIds];
    const project = bundle.projects.find((p) => p.id === projectId);
    if (project) {
      return {
        resolved: true,
        projectId: project.id,
        projectName: project.name,
        score: 1,
        method: "ledger-identity",
      };
    }
  }
  return {
    resolved: false,
    resolver: "ledger-identity",
    detail:
      projectIds.size === 0
        ? `${bankedWiIds.length} banked week item(s), none found in the current bundle`
        : `${bankedWiIds.length} banked week item(s) resolve to ${projectIds.size} distinct projects: no single L1`,
    score: 0,
  };
}

/** Resolver 3: fuzzy title vs project names (§2.3: fuzzy on first resolve only). */
function resolveByProjectNameFuzzy(
  parsed: ParsedSheet,
  bundle: RunwayClientBundle
): L1Outcome {
  const needles = engagementTitleNeedles(parsed);
  let best: {
    p: RunwayClientBundle["projects"][number];
    score: number;
  } | null = null;
  for (const p of bundle.projects) {
    for (const needle of needles) {
      const score = sorensenDice(
        normalizeTitle(needle),
        normalizeTitle(p.name)
      );
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
  return {
    resolved: false,
    resolver: "fuzzy",
    detail: best
      ? `best project-name fuzzy score ${best.score.toFixed(3)} ("${best.p.name}")`
      : "no projects to fuzzy match against",
    score: best ? Number(best.score.toFixed(3)) : 0,
  };
}

/**
 * Resolver 4: the engagement is carried as a WEEK ITEM under a live L1 of
 * this client, not as its own L1 project (standing limit, §7 of the
 * authority rules doc: the tool cannot tell an L1-as-project miss from an
 * L1-as-week-item miss, so it never invents the distinction; it only
 * surfaces the WI and names the parent). A strong title match resolves to
 * the parent with a flag; a weak one is too uncertain to resolve and routes
 * to review instead, naming the candidate.
 */
function resolveByWeekItemCarry(
  parsed: ParsedSheet,
  bundle: RunwayClientBundle
): L1Outcome {
  const needles = engagementTitleNeedles(parsed);
  let best: {
    wi: RunwayClientBundle["weekItems"][number];
    score: number;
  } | null = null;
  for (const wi of bundle.weekItems) {
    for (const needle of needles) {
      const score = sorensenDice(
        normalizeTitle(needle),
        normalizeTitle(wi.title)
      );
      if (best === null || score > best.score) best = { wi, score };
    }
  }
  if (!best) {
    return {
      resolved: false,
      resolver: "week-item-carry",
      detail: "no week items to compare against",
      score: 0,
    };
  }
  const project = bundle.projects.find((p) => p.id === best!.wi.projectId);
  const score = Number(best.score.toFixed(3));
  if (best.score >= CARRY_MATCH_THRESHOLD && project) {
    return {
      resolved: true,
      projectId: project.id,
      projectName: project.name,
      score,
      method: "week-item-carry",
      weekItemCarry: { weekItemId: best.wi.id, weekItemTitle: best.wi.title },
    };
  }
  if (best.score >= CARRY_CANDIDATE_THRESHOLD && project) {
    return {
      resolved: false,
      resolver: "week-item-carry",
      detail: `candidate "${best.wi.title}" (score ${score}) under "${project.name}": below confidence, routed to review`,
      score,
      reviewCandidate: {
        weekItemId: best.wi.id,
        weekItemTitle: best.wi.title,
        projectId: project.id,
        projectName: project.name,
        score,
      },
    };
  }
  return {
    resolved: false,
    resolver: "week-item-carry",
    detail: `best week-item-carry score ${score} ("${best.wi.title}")`,
    score,
  };
}

/**
 * Resolve the sheet's L1 project by trying each named resolver in order.
 * First hit wins and nothing after it runs; when none fires, every resolver
 * has necessarily run and its evidence is carried in `evidence` for the
 * report (§ report req, _R1#153) instead of quoting one resolver's score as
 * if it were the answer.
 */
export function resolveL1(
  parsed: ParsedSheet,
  bundle: RunwayClientBundle,
  ledger: Ledger = {
    sheetId: parsed.config.sheetId,
    updatedAt: "",
    lastRunId: "",
    entries: {},
  }
): DiffResult["l1"] {
  const steps: (() => L1Outcome)[] = [
    () => resolveByEngagementCode(parsed, bundle),
    () => resolveByLedgerIdentity(bundle, ledger),
    () => resolveByProjectNameFuzzy(parsed, bundle),
    () => resolveByWeekItemCarry(parsed, bundle),
  ];
  const misses: L1Miss[] = [];
  let reviewCandidate: L1Miss["reviewCandidate"];
  for (const step of steps) {
    const outcome = step();
    if (outcome.resolved) {
      return {
        resolved: true,
        projectId: outcome.projectId,
        projectName: outcome.projectName,
        score: outcome.score,
        method: outcome.method,
        ...(outcome.weekItemCarry
          ? { weekItemCarry: outcome.weekItemCarry }
          : {}),
      };
    }
    misses.push(outcome);
    if (outcome.reviewCandidate && !reviewCandidate)
      reviewCandidate = outcome.reviewCandidate;
  }
  return {
    resolved: false,
    method: "none",
    score: misses.reduce((max, m) => Math.max(max, m.score), 0),
    evidence: misses.map((m) => ({ resolver: m.resolver, detail: m.detail })),
    ...(reviewCandidate ? { reviewCandidate } : {}),
  };
}

/**
 * §2.4 UPDATE policy applied to a matched pair. Only actionable deltas
 * become writes; protected statuses and completed-reverts become flags.
 */
export function statusDelta(
  sheetDerived: string,
  runway: string | null
): FieldDelta | null {
  const rw = runway ?? "scheduled"; // NULL readable as scheduled during rollout (schema comment)
  if (rw === sheetDerived) return null;
  if (rw === "blocked" || rw === "at-risk" || rw === "in-progress") {
    return {
      field: "status",
      sheet: sheetDerived,
      runway: rw,
      action: "protected-no-write",
    };
  }
  if (rw === "completed" && sheetDerived === "scheduled") {
    // Sheet checkbox FALSE but Runway completed → editorial call, flag only.
    return {
      field: "status",
      sheet: sheetDerived,
      runway: rw,
      action: "flag-for-review",
    };
  }
  if (rw === "scheduled" && sheetDerived === "completed") {
    return {
      field: "status",
      sheet: sheetDerived,
      runway: rw,
      action: "write",
    };
  }
  return {
    field: "status",
    sheet: sheetDerived,
    runway: rw,
    action: "flag-for-review",
  };
}

/**
 * §2.4-style UPDATE policy for weekOf (_R1#160). No protected states here:
 * a card in the wrong week bucket is corrected to the Monday the sheet row
 * derives, the same way a date correction is a plain write.
 */
export function weekOfDelta(
  sheetWeekOf: string | null,
  runwayWeekOf: string | null
): FieldDelta | null {
  if (!sheetWeekOf) return null;
  if (sheetWeekOf === (runwayWeekOf ?? null)) return null;
  return {
    field: "weekOf",
    sheet: sheetWeekOf,
    runway: runwayWeekOf ?? null,
    action: "write",
  };
}

/**
 * _R1#160, TP ruling 2026-09-22: the schedule sheet has no category column,
 * so it never authorizes a category value (same logic as rule R1). The tool
 * never plans a category on an update, ever. A non-null Runway category on
 * a matched row was put there by a person or an earlier tool run; null is
 * not a correction of it, it is a deletion on no authority. So a non-null
 * value is a flag naming the row and the value, never a write; a null
 * value has nothing to flag and nothing to write.
 */
export function categoryDelta(runwayCategory: string | null): FieldDelta | null {
  if (runwayCategory === null) return null;
  return {
    field: "category",
    sheet: null,
    runway: runwayCategory,
    action: "flag-for-review",
  };
}

/**
 * _R1#160, depends on #153: title is correctable only once identity, not
 * fuzzy title similarity, established the match. On a ledger-identity match
 * the sheet title is authoritative and gets written. On a fuzzy-only match,
 * title IS the key that produced the match. Writing over it fights the
 * matcher (the wrinkle the ticket names), so a drift is flagged, not fixed.
 */
export function titleDelta(
  sheetTitle: string,
  runwayTitle: string,
  matchedViaLedgerIdentity: boolean
): FieldDelta | null {
  if (normalizeTitle(sheetTitle) === normalizeTitle(runwayTitle)) return null;
  return {
    field: "title",
    sheet: sheetTitle,
    runway: runwayTitle,
    action: matchedViaLedgerIdentity ? "write" : "flag-for-review",
  };
}

function dateDeltas(
  leaf: LeafTask,
  wi: RunwayClientBundle["weekItems"][number]
): FieldDelta[] {
  const deltas: FieldDelta[] = [];
  // FORWARD date-move ordering (§2.8): endDate first, then startDate —
  // emit in that order so payload applyOrder inherits it.
  if (leaf.endDate && leaf.endDate !== (wi.endDate ?? null)) {
    deltas.push({
      field: "endDate",
      sheet: leaf.endDate,
      runway: wi.endDate ?? null,
      action: "write",
    });
  }
  if (leaf.startDate && leaf.startDate !== (wi.startDate ?? null)) {
    deltas.push({
      field: "startDate",
      sheet: leaf.startDate,
      runway: wi.startDate ?? null,
      action: "write",
    });
  }
  return deltas;
}

export function diffSheet(
  parsed: ParsedSheet,
  bundle: RunwayClientBundle,
  ledger: Ledger,
  runId: string
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
        const deltas = [...dateDeltas(leaf, wi)];
        const sd = statusDelta(leaf.derivedStatus, wi.status);
        if (sd) deltas.push(sd);
        const wd = weekOfDelta(leaf.weekOf, wi.weekOf ?? null);
        if (wd) deltas.push(wd);
        const td = titleDelta(leaf.title, wi.title, true);
        if (td) deltas.push(td);
        const cd = categoryDelta(wi.category ?? null);
        if (cd) deltas.push(cd);
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
      const deltas = [...dateDeltas(leaf, best.wi)];
      const sd = statusDelta(leaf.derivedStatus, best.wi.status);
      if (sd) deltas.push(sd);
      const wd = weekOfDelta(leaf.weekOf, best.wi.weekOf ?? null);
      if (wd) deltas.push(wd);
      const td = titleDelta(leaf.title, best.wi.title, false);
      if (td) deltas.push(td);
      const cd = categoryDelta(best.wi.category ?? null);
      if (cd) deltas.push(cd);
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
