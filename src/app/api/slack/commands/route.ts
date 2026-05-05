/**
 * Slack slash-command webhook handler — Wave 3 / Builder 3.
 *
 * POST /api/slack/commands
 *
 * Handles 6 commands per pre-plan v7 §C / Wave 3:
 *   Create: /runway-new-task, /runway-new-project, /runway-new-team-member
 *   Edit:   /runway-edit-task, /runway-edit-project, /runway-edit-team-member
 *
 * Flow per pre-plan v7 §A3 §2 + §C4:
 *   - HMAC-verify the request (mirror /api/slack/events). Reject 403 on fail.
 *   - Parse `application/x-www-form-urlencoded` body via URLSearchParams.
 *   - Dispatch by `command` field.
 *
 * Create flow:
 *   1. Best-effort parse of `text` to extract a candidate parent-project name.
 *   2. If a parent name is present, fetch the parent candidate list and run
 *      `fuzzyMatchCandidates`. If matches.length > 1, compute
 *      `multiMatchHint = formatMultiMatchHint(matches.length, name, "project")`.
 *   3. Insert a fresh `pending` proposal via `insertProposal`.
 *   4. Build the modal view (stubbed below — Builders 4/5/6 own the real view
 *      builders; this stub exists so the route compiles + tests can assert
 *      the hint/proposalId pass-through. Replace once Phase 1 merges).
 *   5. `slack.views.open(trigger_id, view)`.
 *   6. Return 200 within the 3s budget.
 *
 * Edit flow:
 *   1. Parse `text` as `<name-or-id>`.
 *   2. If text matches the ulid pattern (`^[a-z0-9_-]{20,}$`), look up by id.
 *   3. Otherwise, fuzzy-match by name across the entity list.
 *   4. Single match -> proposal kind=`edit` + targetEntityId/Type +
 *      currentValues populated. Open modal in `mode: "edit"`.
 *   5. Multi-match -> proposal kind=`edit` with no targetEntityId; open modal
 *      with target-entity picker as the first field. multiMatchHint set via
 *      `formatEditMultiMatchHint`.
 *   6. No-match -> 200 with `response_type: "ephemeral"` + `formatEditNoMatch`
 *      string. No proposal inserted, no views.open.
 *
 * Strict scope: this builder does NOT modify proxy.ts (Builder 2 owns that)
 * and does NOT depend on Builders 4/5/6 view builders (stubbed below).
 */
import { NextRequest } from "next/server";
import { verifySlackSignature } from "@/lib/slack/verify";
import { getSlackClient } from "@/lib/slack/client";
import {
  generateProposalId,
  insertProposal,
  type ProposalTargetEntityType,
} from "@/lib/slack/modals/proposal";
import { fuzzyMatchCandidates } from "@/lib/runway/fuzzy-match";
import {
  BASELINE_PARENT_PICKER_HINT,
  formatMultiMatchHint,
  formatEditMultiMatchHint,
  formatEditNoMatch,
} from "@/lib/slack/modals/copy";
import { buildTaskModal } from "@/lib/slack/modals/task";
import { buildProjectModal } from "@/lib/slack/modals/project";
import { buildTeamMemberModal } from "@/lib/slack/modals/team-member";
import { getRunwayDb } from "@/lib/db/runway";
import {
  projects,
  weekItems,
  teamMembers,
} from "@/lib/db/runway-schema";
import { loadEntityById } from "@/lib/slack/load-entity-by-id";

// ────────────────────────────────────────────────────────────────────────────
// Slash command discriminator
// ────────────────────────────────────────────────────────────────────────────

type EntityKind = "task" | "project" | "team-member";
type CommandMode = "create" | "edit";

interface CommandSpec {
  kind: EntityKind;
  mode: CommandMode;
  toolName: string;
  /** Whether this modal has a parent-project picker (Team Member modal does not). */
  hasParentPicker: boolean;
}

const COMMAND_MAP: Record<string, CommandSpec> = {
  "/runway-new-task": {
    kind: "task",
    mode: "create",
    toolName: "create_week_item",
    hasParentPicker: true,
  },
  "/runway-new-project": {
    kind: "project",
    mode: "create",
    toolName: "create_project",
    hasParentPicker: true,
  },
  "/runway-new-team-member": {
    kind: "team-member",
    mode: "create",
    toolName: "create_team_member",
    hasParentPicker: false,
  },
  "/runway-edit-task": {
    kind: "task",
    mode: "edit",
    toolName: "update_week_item",
    hasParentPicker: true,
  },
  "/runway-edit-project": {
    kind: "project",
    mode: "edit",
    toolName: "update_project",
    hasParentPicker: true,
  },
  "/runway-edit-team-member": {
    kind: "team-member",
    mode: "edit",
    toolName: "update_team_member",
    hasParentPicker: false,
  },
};

const ULID_LIKE = /^[a-z0-9_-]{20,}$/i;

// ────────────────────────────────────────────────────────────────────────────
// Real view-builder dispatch — routes to Builders 4/5/6 outputs by entity
// kind. The Project modal also takes a `retainerMode` flag; the slash
// dispatcher cannot yet detect retainer intent, so we default to false. The
// `is_retainer` checkbox in the rendered modal lets the user toggle in-place;
// the `block_actions` handler (Wave 8) then re-renders.
// ────────────────────────────────────────────────────────────────────────────

interface ViewBuilderInput {
  kind: EntityKind;
  mode: CommandMode;
  proposalId: string;
  args: Record<string, unknown>;
  baselineHint?: string;
  multiMatchHint?: string;
  /** For edit-flow: prefilled current values from DB lookup. Single-match only. */
  currentValues?: Record<string, unknown>;
  /** For edit-flow multi-match: list of candidate entities for picker. */
  multiMatchCandidates?: { id: string; label: string }[];
}

function buildModalView(input: ViewBuilderInput): Record<string, unknown> {
  if (input.kind === "task") {
    return buildTaskModal({
      args: input.args,
      proposalId: input.proposalId,
      mode: input.mode,
      currentValues: input.currentValues,
      baselineHint: input.baselineHint,
      multiMatchHint: input.multiMatchHint,
    }) as unknown as Record<string, unknown>;
  }
  if (input.kind === "project") {
    return buildProjectModal({
      args: input.args,
      proposalId: input.proposalId,
      mode: input.mode,
      // Retainer mode defaults to false from slash entry; the in-modal
      // checkbox + block_actions handler flips it in place.
      retainerMode: false,
      currentValues: input.currentValues,
      baselineHint: input.baselineHint,
      multiMatchHint: input.multiMatchHint,
    }) as unknown as Record<string, unknown>;
  }
  return buildTeamMemberModal({
    args: input.args,
    proposalId: input.proposalId,
    mode: input.mode,
    currentValues: input.currentValues,
  }) as unknown as Record<string, unknown>;
}

// ────────────────────────────────────────────────────────────────────────────
// Slash arg parsing — best-effort heuristic to extract a candidate parent
// project name from the trailing tokens of `text`. Real production text
// handling lives downstream; this just gives the multi-match hint a chance
// to fire on common cases like "Concept Writeup AG1 Pro".
// ────────────────────────────────────────────────────────────────────────────

function extractParentNameCandidate(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const tokens = trimmed.split(/\s+/);
  if (tokens.length < 2) return undefined;
  // Heuristic: take the last 3 tokens as a parent-name guess. The fuzzy
  // matcher tolerates partial matches via Sørensen-Dice, so a noisy guess
  // is fine — it'll either find candidates or yield zero hits (no hint).
  // The actual matching uses suffix windows in `fuzzyMatchParents` to pick
  // the strongest signal across last-1, last-2, last-3 token slices.
  return tokens.slice(-3).join(" ");
}

// Slash-arg fuzzy threshold. Looser than the default 0.6 because slash text
// like "Brand" against "Brand Refresh" yields ~0.5 — still a meaningful
// signal for the parent-picker hint. The downstream view builder + actual
// picker UI let the user disambiguate, so a few extra candidates is fine.
const SLASH_FUZZY_THRESHOLD = 0.4;

/**
 * Best-effort parent-project fuzzy match. Tries last-1, last-2, last-3 token
 * suffixes against the candidate list and returns the window that yields
 * the strongest signal (most matches at SLASH_FUZZY_THRESHOLD). Returns the
 * matched candidates and the window string actually matched (for hint copy
 * interpolation).
 */
function fuzzyMatchParents(
  text: string,
  candidates: FuzzyEntity[],
): { matches: FuzzyEntity[]; usedName: string } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const tokens = trimmed.split(/\s+/);
  // Try widest window first (catches "AG1 Pro Subscriber 2026"), then narrow.
  const windows = [
    tokens.slice(-3).join(" "),
    tokens.slice(-2).join(" "),
    tokens.slice(-1).join(" "),
  ].filter((w, i, a) => w && a.indexOf(w) === i);
  let best: { matches: FuzzyEntity[]; usedName: string } | null = null;
  for (const w of windows) {
    const matches = fuzzyMatchCandidates(
      w,
      candidates,
      (c) => c.label,
      SLASH_FUZZY_THRESHOLD,
    );
    if (matches.length > 0) {
      if (!best || matches.length > best.matches.length) {
        best = { matches, usedName: w };
      }
    }
  }
  return best;
}

// ────────────────────────────────────────────────────────────────────────────
// Edit-flow target lookup
// ────────────────────────────────────────────────────────────────────────────

interface FuzzyEntity {
  id: string;
  label: string;
}

async function loadFuzzyEntitiesByKind(kind: EntityKind): Promise<FuzzyEntity[]> {
  const db = getRunwayDb();
  if (kind === "project") {
    const rows = await db.select().from(projects);
    return rows.map((r) => ({ id: r.id, label: r.name }));
  }
  if (kind === "task") {
    const rows = await db.select().from(weekItems);
    return rows.map((r) => ({ id: r.id, label: r.title }));
  }
  const rows = await db.select().from(teamMembers);
  return rows.map((r) => ({ id: r.id, label: r.fullName ?? r.name }));
}

function targetEntityType(kind: EntityKind): ProposalTargetEntityType {
  if (kind === "project") return "project";
  if (kind === "task") return "week_item";
  return "team_member";
}

// Small alias mapping our internal entity-kind discriminator to the
// `formatEditNoMatch` / `formatEditMultiMatchHint` copy taxonomy
// (`task` | `project` | `team-member`).
function copyKind(kind: EntityKind): "task" | "project" | "team-member" {
  return kind;
}

// Map internal kind to the parent-picker copy taxonomy used by
// formatMultiMatchHint, which only accepts "project" | "retainer".
function parentCopyKind(): "project" | "retainer" {
  // Retainer mode is determined by isRetainer args at the project create
  // level — for the slash dispatcher we don't have that signal, so the
  // generic "project" wording is correct.
  return "project";
}

// ────────────────────────────────────────────────────────────────────────────
// POST handler
// ────────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    console.error("[Slack Commands] SLACK_SIGNING_SECRET not configured");
    return jsonResponse({ error: "Server misconfigured" }, 500);
  }

  const signature = request.headers.get("x-slack-signature");
  const timestamp = request.headers.get("x-slack-request-timestamp");
  if (!verifySlackSignature(signingSecret, signature, timestamp, rawBody)) {
    return jsonResponse({ error: "Invalid signature" }, 403);
  }

  const params = new URLSearchParams(rawBody);
  const command = params.get("command") ?? "";
  const text = params.get("text") ?? "";
  const userSlackId = params.get("user_id") ?? "";
  const channelId = params.get("channel_id") ?? "";
  const triggerId = params.get("trigger_id") ?? "";

  const spec = COMMAND_MAP[command];
  if (!spec) {
    return jsonResponse({ error: `Unknown command '${command}'` }, 400);
  }

  if (spec.mode === "create") {
    return handleCreate(spec, { text, userSlackId, channelId, triggerId });
  }
  return handleEdit(spec, { text, userSlackId, channelId, triggerId });
}

// ────────────────────────────────────────────────────────────────────────────
// Create handler
// ────────────────────────────────────────────────────────────────────────────

interface SlashContext {
  text: string;
  userSlackId: string;
  channelId: string;
  triggerId: string;
}

async function handleCreate(
  spec: CommandSpec,
  ctx: SlashContext,
): Promise<Response> {
  const args: Record<string, unknown> = {};

  let multiMatchHint: string | undefined;
  let baselineHint: string | undefined;

  // Parent-name fuzzy match — only relevant for modals that have a parent
  // picker (Task + Project; Team Member has none).
  if (spec.hasParentPicker) {
    const parentNameCandidate = extractParentNameCandidate(ctx.text);
    if (parentNameCandidate) {
      // We only need names + ids for the fuzzy match. Project picker is
      // shared across Task + Project modals (project nests under retainer
      // wrapper, task nests under project).
      const candidates = await loadFuzzyEntitiesByKind("project");
      const best = fuzzyMatchParents(ctx.text, candidates);
      // Per pre-plan v7 §A3 §2: hint only fires on N>1. 0 / 1 candidate cases
      // both leave multiMatchHint undefined (fuzzy match resolved itself).
      if (best && best.matches.length > 1) {
        multiMatchHint = formatMultiMatchHint(
          best.matches.length,
          best.usedName,
          parentCopyKind(),
        );
      }
      // Stash the parent-name guess on the proposal args so the modal can
      // pre-fill the picker on render.
      args.parentNameCandidate = parentNameCandidate;
    }
    // The baseline hint is always rendered above the picker per §A3 §3-§4.
    baselineHint = BASELINE_PARENT_PICKER_HINT;
  }

  // Generate the proposal id locally so views.open and the DB insert can
  // run in parallel. trigger_id is only valid for ~3 seconds; gating
  // views.open behind the Turso write put us at the edge (2.9s on a cold
  // connection => expired_trigger_id => Slack "operation_timeout").
  const proposalId = generateProposalId();

  const view = buildModalView({
    kind: spec.kind,
    mode: "create",
    proposalId,
    args,
    baselineHint,
    multiMatchHint,
  });

  await Promise.all([
    getSlackClient().views.open({ trigger_id: ctx.triggerId, view: view as never }),
    insertProposal({
      id: proposalId,
      kind: "create",
      toolName: spec.toolName,
      args,
      userSlackId: ctx.userSlackId,
      channelId: ctx.channelId,
    }),
  ]);
  // Empty 200 ack. Slack renders nothing; the modal opened by views.open
  // is the only user-visible artifact. A JSON body with `{ ok: true }` was
  // being shown by some Slack clients as ephemeral text in the DM.
  return new Response(null, { status: 200 });
}

// ────────────────────────────────────────────────────────────────────────────
// Edit handler
// ────────────────────────────────────────────────────────────────────────────

async function handleEdit(
  spec: CommandSpec,
  ctx: SlashContext,
): Promise<Response> {
  const query = ctx.text.trim();
  if (!query) {
    return jsonResponse(
      {
        response_type: "ephemeral",
        text: `Add a name or id after the command (e.g. /runway-edit-${spec.kind === "team-member" ? "team-member" : spec.kind} <name>).`,
      },
      200,
    );
  }

  // 1. Try ID lookup first (ulid-shape).
  if (ULID_LIKE.test(query)) {
    const row = await loadEntityById(spec.kind, query);
    if (row) {
      return openEditModalSingleMatch(spec, ctx, query, row);
    }
    // Fall through to fuzzy name match — a 20+ char free-text could still be
    // a long real-world name (e.g. retainer wrapper "AG1 Pro Subscriber 2026").
  }

  // 2. Fuzzy name match across the entity list. Same loose threshold as the
  //    create-flow parent picker so partial names like "Brand" surface
  //    "Brand Refresh" + "Brand Strategy" as multi-match candidates.
  const candidates = await loadFuzzyEntitiesByKind(spec.kind);
  const matches = fuzzyMatchCandidates(
    query,
    candidates,
    (c) => c.label,
    SLASH_FUZZY_THRESHOLD,
  );

  if (matches.length === 0) {
    return jsonResponse(
      {
        response_type: "ephemeral",
        text: formatEditNoMatch(copyKind(spec.kind), query),
      },
      200,
    );
  }

  if (matches.length === 1) {
    const single = matches[0];
    const row = await loadEntityById(spec.kind, single.id);
    if (!row) {
      // Race: the entity vanished between the candidate fetch and the lookup.
      return jsonResponse(
        {
          response_type: "ephemeral",
          text: formatEditNoMatch(copyKind(spec.kind), query),
        },
        200,
      );
    }
    return openEditModalSingleMatch(spec, ctx, single.id, row);
  }

  // 3. Multi-match -> proposal w/o targetEntityId, modal renders picker.
  // Slack's static_select option list caps at 100, so the modal builders
  // silently slice candidates above that limit. Surface the truncation in
  // the hint so the user knows to refine their search to see the rest.
  const multiMatchHint = formatEditMultiMatchHint(
    matches.length,
    copyKind(spec.kind),
    query,
    { truncated: matches.length > 100 },
  );
  const args: Record<string, unknown> = {
    multiMatchQuery: query,
    candidates: matches.map((m) => ({ id: m.id, label: m.label })),
  };
  const proposalId = generateProposalId();
  const view = buildModalView({
    kind: spec.kind,
    mode: "edit",
    proposalId,
    args,
    multiMatchHint,
    multiMatchCandidates: matches.map((m) => ({ id: m.id, label: m.label })),
  });
  await Promise.all([
    getSlackClient().views.open({ trigger_id: ctx.triggerId, view: view as never }),
    insertProposal({
      id: proposalId,
      kind: "edit",
      toolName: spec.toolName,
      args,
      userSlackId: ctx.userSlackId,
      channelId: ctx.channelId,
    }),
  ]);
  // Empty 200 ack. Slack renders nothing; the modal opened by views.open
  // is the only user-visible artifact. A JSON body with `{ ok: true }` was
  // being shown by some Slack clients as ephemeral text in the DM.
  return new Response(null, { status: 200 });
}

async function openEditModalSingleMatch(
  spec: CommandSpec,
  ctx: SlashContext,
  entityId: string,
  row: Record<string, unknown>,
): Promise<Response> {
  const proposalId = generateProposalId();
  const view = buildModalView({
    kind: spec.kind,
    mode: "edit",
    proposalId,
    args: { ...row },
    currentValues: { ...row },
    baselineHint: spec.hasParentPicker ? BASELINE_PARENT_PICKER_HINT : undefined,
  });
  await Promise.all([
    getSlackClient().views.open({ trigger_id: ctx.triggerId, view: view as never }),
    insertProposal({
      id: proposalId,
      kind: "edit",
      toolName: spec.toolName,
      args: { ...row },
      userSlackId: ctx.userSlackId,
      channelId: ctx.channelId,
      targetEntityId: entityId,
      targetEntityType: targetEntityType(spec.kind),
    }),
  ]);
  // Empty 200 ack. Slack renders nothing; the modal opened by views.open
  // is the only user-visible artifact. A JSON body with `{ ok: true }` was
  // being shown by some Slack clients as ephemeral text in the DM.
  return new Response(null, { status: 200 });
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
