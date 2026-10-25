/**
 * L1 resolution: which Runway project a sheet belongs to. Named resolvers
 * run in order and the first hit wins.
 */
import { sorensenDice } from "../../src/lib/runway/fuzzy-match";
import { normalizeTitle } from "./ledger";
import {
  CARRY_CANDIDATE_THRESHOLD,
  CARRY_MATCH_THRESHOLD,
  WI_MATCH_THRESHOLD,
} from "./match-thresholds";
import type { RunwayClientBundle } from "./runway-read";
import type { DiffResult, Ledger, ParsedSheet } from "./types";

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
  // Config code first, the drifted banner code second. Rule R7: prod may track
  // the engagement under the code the sheet BODY carries, not the real one.
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
