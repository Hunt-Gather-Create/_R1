/**
 * Slack block_suggestion (Options Load URL) handler — Phase 4.
 *
 * POST /api/slack/options
 *
 * Slack invokes this endpoint when a user opens an `external_select`
 * dropdown in our modals. It returns the option list for that picker.
 *
 * Pickers handled (per src/lib/slack/modals/{task,project,team-member}.ts):
 *   - client_select            → all clients
 *   - parent_project_select    → projects, cascaded by client_select
 *   - parent_retainer_picker   → retainer-mode projects, cascaded by client_select
 *   - owner_select             → active team members
 *   - resources_name_<N>       → team members, cascaded by resources_role_<N>
 *
 * Response shape: `{options: [{text: {type: "plain_text", text}, value}, ...]}`.
 * Slack rejects empty options arrays, so the route always returns at least
 * one option — a placeholder when no candidates match or a cascade
 * dependency is unset (e.g. parent_project asked before client picked).
 *
 * Performance: must respond within Slack's 3-second window.
 *   - getAllClients() is cached (5-min TTL via getCachedClients)
 *   - Other queries are simple SELECTs against indexed columns
 *   - Result set capped at MAX_OPTIONS (Slack's hard limit is 100)
 */

import type { NextRequest } from "next/server";
import { verifySlackSignature } from "@/lib/slack/verify";
import { getAllClients } from "@/lib/runway/operations-utils";
import {
  getProjectsForFuzzy,
  getTeamMembersForFuzzy,
  type ProjectForFuzzy,
  type TeamMemberForFuzzy,
} from "@/lib/runway/data-for-commands";

const MAX_OPTIONS = 100;

// ---------------------------------------------------------------------------
// Resources-Role short-code → teamMembers.roleCategory mapping
// ---------------------------------------------------------------------------
//
// Modal pickers use short codes (AM/CD/Dev/CW/PM/CM/Strat/Vendor); the
// teamMembers.roleCategory column uses long codes
// (creative/dev/am/pm/leadership/community/contractor/strategy).
//
// Mapping locked with operator on 2026-05-03. Strategy is a new bucket added
// to roleCategory's documented values for the Strat short code. Operator
// confirmed CD→creative, CW→creative, Strat→strategy. Future short codes or
// roleCategory values should extend this map together.
const ROLE_SHORT_TO_LONG: Record<string, string> = {
  AM: "am",
  CD: "creative",
  Dev: "dev",
  CW: "creative",
  PM: "pm",
  CM: "community",
  Strat: "strategy",
  Vendor: "contractor",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SlackOption {
  text: { type: "plain_text"; text: string; emoji?: boolean };
  value: string;
}

interface BlockSuggestionPayload {
  type: "block_suggestion";
  action_id: string;
  block_id?: string;
  value?: string;
  view?: {
    state?: { values?: Record<string, Record<string, unknown>> };
  };
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function optionsResponse(options: SlackOption[]): Response {
  // Slack rejects empty options arrays; always emit at least one entry.
  const safe = options.length > 0
    ? options.slice(0, MAX_OPTIONS)
    : [placeholder("No matches", "_no_matches")];
  return jsonResponse({ options: safe });
}

function placeholder(text: string, value: string): SlackOption {
  return { text: { type: "plain_text", text, emoji: false }, value };
}

function toOption(value: string, label: string): SlackOption {
  // Slack option label is hard-capped at 75 chars. Truncate defensively.
  const trimmed = label.length > 75 ? label.slice(0, 72) + "..." : label;
  return { text: { type: "plain_text", text: trimmed, emoji: false }, value };
}

/**
 * Case-insensitive substring filter for typeahead UX. The slash dispatcher
 * uses Sørensen-Dice fuzzy match because users type a single guess and we
 * need typo tolerance; here the user is filtering interactively as they
 * type, so substring matching is the standard expectation.
 */
function filterByQuery<T>(
  query: string,
  candidates: T[],
  getName: (c: T) => string,
): T[] {
  if (!query) return candidates;
  const q = query.toLowerCase();
  return candidates.filter((c) => getName(c).toLowerCase().includes(q));
}

// ---------------------------------------------------------------------------
// Cascade reads — pull dependent picker values from view.state.values
// ---------------------------------------------------------------------------

function readSelectedValue(
  payload: BlockSuggestionPayload,
  blockId: string,
  actionId: string,
): string | undefined {
  const block = payload.view?.state?.values?.[blockId];
  if (!block) return undefined;
  const action = block[actionId] as { selected_option?: { value?: string } } | undefined;
  return action?.selected_option?.value;
}

// ---------------------------------------------------------------------------
// Picker handlers
// ---------------------------------------------------------------------------

async function handleClientSelect(payload: BlockSuggestionPayload): Promise<Response> {
  const query = (payload.value ?? "").trim();
  const clients = await getAllClients();
  const matches = filterByQuery(query, clients, (c) => c.name);
  return optionsResponse(matches.map((c) => toOption(c.id, c.name)));
}

async function handleParentProjectPicker(
  payload: BlockSuggestionPayload,
  opts: { engagementType?: "retainer" } = {},
): Promise<Response> {
  const clientId = readSelectedValue(payload, "client_block", "client_select");
  if (!clientId) {
    return optionsResponse([placeholder("Select a client first", "_no_client")]);
  }

  const projects: ProjectForFuzzy[] = await getProjectsForFuzzy(
    clientId,
    opts.engagementType ? { engagementType: opts.engagementType } : undefined,
  );

  const query = (payload.value ?? "").trim();
  const matches = filterByQuery(query, projects, (p) => p.name);
  return optionsResponse(matches.map((p) => toOption(p.id, p.name)));
}

async function handleOwnerSelect(payload: BlockSuggestionPayload): Promise<Response> {
  // Owners are staff only — exclude the contractor bucket (freelancers/Vendors).
  // Resources Name picker keeps contractors (handled below).
  const members = await getActiveTeamMembers({ excludeRoleCategory: "contractor" });
  const query = (payload.value ?? "").trim();
  const matches = filterByQuery(query, members, getMemberLabel);
  return optionsResponse(matches.map((m) => toOption(m.id, getMemberLabel(m))));
}

async function handleResourcesNamePicker(
  payload: BlockSuggestionPayload,
): Promise<Response> {
  // action_id is `resources_name_<N>`; parse N to find the sibling role block.
  const actionId = payload.action_id;
  const match = /^resources_name_(\d+)$/.exec(actionId);
  if (!match) {
    return optionsResponse([]);
  }
  const idx = match[1];
  const roleShort = readSelectedValue(
    payload,
    `resources_block_${idx}`,
    `resources_role_${idx}`,
  );

  const all = await getActiveTeamMembers();
  let candidates: TeamMemberForFuzzy[] = all;

  if (roleShort) {
    const longCode = ROLE_SHORT_TO_LONG[roleShort];
    if (longCode) {
      candidates = all.filter((m) => m.roleCategory === longCode);
    }
    // Unknown short code → fall through to all active members (defensive).
  }

  const query = (payload.value ?? "").trim();
  const matches = filterByQuery(query, candidates, getMemberLabel);
  return optionsResponse(matches.map((m) => toOption(m.id, getMemberLabel(m))));
}

// ---------------------------------------------------------------------------
// Team-member helpers
// ---------------------------------------------------------------------------

interface ActiveMemberRow extends TeamMemberForFuzzy {
  isActive?: number;
}

async function getActiveTeamMembers(
  opts?: { excludeRoleCategory?: string },
): Promise<TeamMemberForFuzzy[]> {
  const rows = (await getTeamMembersForFuzzy(opts)) as ActiveMemberRow[];
  return rows.filter((m) => m.isActive !== 0);
}

function getMemberLabel(m: TeamMemberForFuzzy): string {
  return m.fullName ?? m.name;
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<Response> {
  const rawBody = await request.text();

  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    console.error("[Slack Options] SLACK_SIGNING_SECRET not configured");
    return jsonResponse({ error: "Server misconfigured" }, 500);
  }

  const signature = request.headers.get("x-slack-signature");
  const timestamp = request.headers.get("x-slack-request-timestamp");
  if (!verifySlackSignature(signingSecret, signature, timestamp, rawBody)) {
    return jsonResponse({ error: "Invalid signature" }, 403);
  }

  const params = new URLSearchParams(rawBody);
  const payloadRaw = params.get("payload");
  if (!payloadRaw) {
    return jsonResponse({ error: "Missing payload" }, 400);
  }

  let payload: BlockSuggestionPayload;
  try {
    payload = JSON.parse(payloadRaw) as BlockSuggestionPayload;
  } catch {
    return jsonResponse({ error: "Invalid JSON in payload" }, 400);
  }

  switch (payload.action_id) {
    case "client_select":
      return handleClientSelect(payload);
    case "parent_project_select":
      return handleParentProjectPicker(payload);
    case "parent_retainer_picker":
      return handleParentProjectPicker(payload, { engagementType: "retainer" });
    case "owner_select":
      return handleOwnerSelect(payload);
    default:
      // resources_name_<N> matches a regex; everything else is unknown.
      if (/^resources_name_\d+$/.test(payload.action_id)) {
        return handleResourcesNamePicker(payload);
      }
      return optionsResponse([]);
  }
}
