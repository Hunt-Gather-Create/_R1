# Slack Modal CRUD

Slash-command-driven Slack modals for creating and editing the four core runway entities (tasks, projects, retainers, team members). Sibling system to the LLM-intercept Slack bot in [Runway System](./runway.md#slack-bot); the modal flow is preferred when users want a deterministic, schema-validated edit without phrasing a prompt.

## Overview

Two surfaces, one runway DB:

- **Slack bot (LLM intercept)** — natural-language DMs, `handleDirectMessage` parses intent, AI tool calls write through the operations layer. See [runway.md](./runway.md#slack-bot).
- **Slack modals (this doc)** — slash commands open a Block Kit modal pre-filled from the DB; user edits + submits; validator + Inngest consumer write through the same operations layer with a `slack-modal` source tag.

Both paths share the same operations layer (`src/lib/runway/operations*`) so any field-level invariant lives in one place.

## Surface

```
Slash command:        /runway-new-task     /runway-edit-task <name>
                      /runway-new-project  /runway-edit-project <name>
                      /runway-new-team-member  /runway-edit-team-member <name>

POST /api/slack/commands         → HMAC verify → fuzzy match (edit) → views.open
POST /api/slack/interactivity    → block_actions (cascade rebuild, dateType toggle, retainer toggle)
                                 → view_submission → emit slack-modal/submit Inngest event → ack 200
POST /api/slack/options          → external_select options provider (Client / Parent / Owner / Resources)

Inngest: slack-modal/submit      → idempotency check → validator → write through operations
                                 → mark proposal submitted → post Civ-voice DM confirmation
```

## Schema additions

| Table / column | Purpose |
|---|---|
| `bot_modal_proposals` | Staged proposals from slash commands. Lifecycle: `pending → submitted | cancelled | expired | failed`. 24h TTL cron cleanup. |
| `updates.source` | Write provenance tag (`slack-modal`, `slack-bot`, `mcp`, etc.). Plumbed through every `create_*` / `update_*` operations helper. |

## Modal flow lifecycle

1. **Slash command** opens `views.open` with row data prefilled (single match) or a candidate picker (multi-match).
2. **Disambiguation phase** (multi-match only): user picks a candidate from a static_select; `block_actions` rebuilds the view via `views.update` with full row data.
3. **In-modal interaction** (cascade rebuilds): selecting a Client repopulates the Parent project external_select; toggling Date type swaps single Date picker for Start + End; toggling the retainer wrapper checkbox rebuilds the project modal in retainer mode.
4. **Submit** (`view_submission`): interactivity ack'd 200 with a "Saving your changes" ephemeral; Inngest consumer runs validator → write → confirmation DM.
5. **Idempotency**: re-fired submissions on already-`submitted | cancelled | expired | failed` proposals short-circuit and return `{ skipped: true, reason }` without touching operations.

## Modal builders

Pure functions: `(params) → SlackView`. One per entity kind:

- `src/lib/slack/modals/task.ts` — `buildTaskModal`
- `src/lib/slack/modals/project.ts` — `buildProjectModal` (handles both project and retainer variants via `retainerMode` flag)
- `src/lib/slack/modals/team-member.ts` — `buildTeamMemberModal`

Shared infrastructure:

- `helpers.ts` — `plainText`, `mrkdwn`, `truncate`, `asString`, `asStringArray`, `findOption`, `staticOption`
- `constants.ts` — `BLOCK_IDS` central registry of all block_id literals
- `picker-block.ts` — multi-match candidate picker (shared across kinds)
- `picker-state.ts` — `hasPickedEntity` (per-kind picked predicate), `inferDateTypeFromArgs`
- `copy.ts` — Civ-voice strings (`MODAL_HEADERS`, `MODAL_SAVE_IN_FLIGHT`, etc.)

## Validator

`src/lib/slack/modals/validate-submission.ts` runs server-side after `view_submission`:

1. **Extract** field values from `state.values` per kind (`extractTaskFields`, `extractProjectFields`, `extractTeamMemberFields`)
2. **Convert to canonical** write-layer keys (`taskExtractToCanonical`, etc.)
3. **Apply args fallback** — Slack omits untouched `initial_value` / `initial_option` blocks from `view.state.values`; backfill from `proposal.args` (persisted at multi-match-pick time) so the diff doesn't flag untouched fields as change-to-null
4. **Compute changed fields** — diff canonical against the target row; reject if no changes detected (edit flow only)
5. **Field-level validation** — required-ness, status × category compatibility, date order, required-conditional rules per Wave 9 matrix

Rejections return `errors[block_id]` so Slack inline-renders the message under the offending field.

## Inngest consumer

`src/lib/inngest/functions/slack-modal-submit.ts` — single function fires on `slack-modal/submit` event:

1. Status check (idempotency)
2. Submitter validation (event `userId` matches `proposal.userSlackId`)
3. Validate (calls `validateModalSubmission`); on reject → mark `failed` + post ephemeral
4. Dispatch write (`writeCreate*` / `writeUpdate*` per kind + mode)
5. Mark `submitted` (separate transaction, idempotent on re-fire)
6. Post Civ-voice confirmation DM (`{ entityName, clientName? }` interpolated)

## Civ voice rules (locked 2026-04-30)

- Hyphens, not em-dashes. ASCII hyphen-minus (`' - '`).
- All user-facing strings flow through `MODAL_HEADERS` / dedicated copy module where possible.
- A grep guard test in `src/lib/slack/modals/copy.test.ts` rejects em-dashes in `task.ts`, `project.ts`, `copy.ts`.

## Known limitations + deferred work

- **Bug X2 — retainer edit demotes engagement_type.** `/runway-edit-project` on a retainer row opens the wrapper checkbox unchecked; submitting any unrelated edit silently rewrites `engagement_type` back to `"project"`. Tracked as Batch K1; full investigation log + fix-pattern candidates at [`docs/plans/slack-modal-bug-x2-retainer-edit-fix.md`](./plans/slack-modal-bug-x2-retainer-edit-fix.md).
- **Bug X3 — retainer toggle wipes state in edit mode.** Toggling the wrapper during edit re-renders as "New retainer" create-mode with all fields blanked. Different root cause than X2 (in-modal toggle handler losing currentValues). Tracked as Batch K2.
- **`updates.source` back-population** of historic rows is out of scope; broader Wave-0d audit gap branch.

## Key files

| File | Purpose |
|---|---|
| `src/app/api/slack/commands/route.ts` | Slash command HMAC + fuzzy match + view-builder dispatch |
| `src/app/api/slack/interactivity/route.ts` | block_actions handlers (cascade, toggle) + view_submission |
| `src/app/api/slack/options/route.ts` | external_select options provider |
| `src/lib/slack/modals/task.ts` | Task modal builder |
| `src/lib/slack/modals/project.ts` | Project + retainer modal builder |
| `src/lib/slack/modals/team-member.ts` | Team-member modal builder |
| `src/lib/slack/modals/helpers.ts` | Shared `plainText` / `mrkdwn` / `truncate` / `asString` / `staticOption` |
| `src/lib/slack/modals/constants.ts` | `BLOCK_IDS` central registry |
| `src/lib/slack/modals/picker-block.ts` | Multi-match candidate picker |
| `src/lib/slack/modals/picker-state.ts` | `hasPickedEntity`, `inferDateTypeFromArgs` |
| `src/lib/slack/modals/validate-submission.ts` | Server-side validator (extract + diff + field rules) |
| `src/lib/slack/modals/copy.ts` | Civ-voice user-facing strings |
| `src/lib/slack/load-entity-by-id.ts` | Row loader (single-match path + multi-match post-pick) |
| `src/lib/inngest/functions/slack-modal-submit.ts` | Inngest consumer (idempotent, source-tagged writes, DM confirmation) |
| `src/lib/db/runway-schema.ts` | `bot_modal_proposals` table + `updates.source` column |

## Related Documentation

- [Runway System](./runway.md) - Schema, operations layer, dashboard, MCP server
- [Runway System / Slack Bot](./runway.md#slack-bot) - LLM-intercept DM flow (sibling surface)
- [`docs/plans/slack-modal-bug-x2-retainer-edit-fix.md`](./plans/slack-modal-bug-x2-retainer-edit-fix.md) - Batch K deferred-fix investigation
