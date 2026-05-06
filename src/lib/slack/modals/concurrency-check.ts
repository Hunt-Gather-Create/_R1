/**
 * Concurrency soft-warn helper (Wave 11 / Builder 11).
 *
 * Fires at modal-open time. When a user opens a `create` modal we look up
 * other PENDING `bot_modal_proposals` in the SAME channel for the SAME
 * toolName authored by a DIFFERENT user within the LAST 60 SECONDS. If any
 * candidate's title fuzzy-matches the title we're about to render, we surface
 * a non-blocking soft-warn back to the caller, who renders it as a Block Kit
 * context block above the parent picker (or top of modal for non-parent
 * modals).
 *
 * This is intentionally a SOFT warn - the modal still opens. Users can dismiss
 * the soft-warn implicitly by submitting; the goal is to nudge two teammates
 * who happened to start the same form within ~1 minute of each other to talk
 * before saving duplicates.
 *
 * Design notes:
 *   - We pull a small candidate set with the cheap filters (status / channel /
 *     toolName / time-window / not-self) at the SQL boundary, then run the
 *     fuzzy-match in JS so we can reuse the shared Sørensen-Dice utility.
 *     Cardinality is bounded by the 60s window; this is fine for production
 *     load.
 *   - Title extraction is toolName-discriminated: tasks store `title`,
 *     projects store `name`, team-members store `fullName`. JSON parse errors
 *     and missing fields short-circuit to "no match" so a malformed args row
 *     can't crash the open path.
 *   - Empty `fuzzyTitle` returns `hasConcurrent: false` immediately - there's
 *     no meaningful match to compute and surfacing a warn pinned to a blank
 *     title would be noise.
 */

import { and, eq, gt, ne } from "drizzle-orm";
import { getRunwayDb } from "@/lib/db/runway";
import { botModalProposals } from "@/lib/db/runway-schema";
import { fuzzyMatchCandidates } from "@/lib/runway/fuzzy-match";

const CONCURRENCY_WINDOW_MS = 60 * 1000;

/**
 * Inputs for the concurrency check. `toolName` mirrors the staged proposal's
 * `toolName` column (e.g. `create_week_item`). `fuzzyTitle` is the title /
 * name / fullName extracted from THIS user's args - the value we want to
 * compare against pending peers.
 */
export interface CheckConcurrentProposalParams {
  toolName: string;
  fuzzyTitle: string;
  currentUserSlackId: string;
  currentChannelId: string;
}

export type ConcurrentProposalResult =
  | { hasConcurrent: false }
  | {
      hasConcurrent: true;
      otherUser: string;
      otherTitle: string;
      createdAt: Date;
    };

/** Candidate row shape — tightly scoped to the columns this helper reads. */
interface ConcurrencyCandidate {
  id: string;
  userSlackId: string;
  channelId: string;
  toolName: string;
  status: string;
  args: string;
  createdAt: Date;
}

/**
 * Pull pending peers from the DB, filter by fuzzy match, return the first
 * match (or `{hasConcurrent: false}`).
 */
export async function checkConcurrentProposal(
  params: CheckConcurrentProposalParams,
): Promise<ConcurrentProposalResult> {
  const { toolName, fuzzyTitle, currentUserSlackId, currentChannelId } = params;

  // No title to match against -> nothing to warn about.
  if (typeof fuzzyTitle !== "string" || fuzzyTitle.trim().length === 0) {
    return { hasConcurrent: false };
  }

  const cutoff = new Date(Date.now() - CONCURRENCY_WINDOW_MS);

  // SQL-side filters keep candidate cardinality minimal. The createdAt > cutoff
  // filter alone is a fast index scan via the (user_slack_id, created_at)
  // covering index when the row counts grow.
  const candidates = (await getRunwayDb()
    .select()
    .from(botModalProposals)
    .where(
      and(
        eq(botModalProposals.status, "pending"),
        eq(botModalProposals.toolName, toolName),
        eq(botModalProposals.channelId, currentChannelId),
        ne(botModalProposals.userSlackId, currentUserSlackId),
        gt(botModalProposals.createdAt, cutoff),
      ),
    )) as ConcurrencyCandidate[];

  if (candidates.length === 0) {
    return { hasConcurrent: false };
  }

  // Defensive in-JS re-filter: the DB stub used in tests returns rows verbatim
  // without applying the SQL filter; production drizzle obeys the .where()
  // clause. Re-applying here makes the helper hermetic against either driver
  // path and keeps the contract obvious to readers.
  const filtered = candidates.filter((row) => {
    if (row.userSlackId === currentUserSlackId) return false;
    if (row.channelId !== currentChannelId) return false;
    if (row.toolName !== toolName) return false;
    if (row.status !== "pending") return false;
    if (row.createdAt instanceof Date) {
      if (row.createdAt.getTime() <= cutoff.getTime()) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    return { hasConcurrent: false };
  }

  // Fuzzy match against the toolName-appropriate title field.
  const matches = fuzzyMatchCandidates(
    fuzzyTitle,
    filtered,
    (c) => extractTitle(toolName, c.args),
  );

  if (matches.length === 0) {
    return { hasConcurrent: false };
  }

  const winner = matches[0];
  return {
    hasConcurrent: true,
    otherUser: winner.userSlackId,
    otherTitle: extractTitle(toolName, winner.args),
    createdAt: winner.createdAt,
  };
}

/**
 * Pull the title-equivalent field out of a candidate's args JSON. The field
 * name is toolName-discriminated:
 *   - create_week_item / update_week_item -> `title`
 *   - create_project / update_project     -> `name`
 *   - create_team_member / update_team_member -> `fullName`
 *
 * Returns "" on any failure so fuzzyMatchCandidates filters the row out
 * cleanly (sorensenDice("X", "") -> 0, below threshold).
 */
function extractTitle(toolName: string, argsRaw: string): string {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(argsRaw) as Record<string, unknown>;
  } catch {
    return "";
  }
  if (toolName === "create_project" || toolName === "update_project") {
    return typeof parsed.name === "string" ? parsed.name : "";
  }
  if (toolName === "create_team_member" || toolName === "update_team_member") {
    return typeof parsed.fullName === "string" ? parsed.fullName : "";
  }
  return typeof parsed.title === "string" ? parsed.title : "";
}
