# Runway System

Civilization Agency's triage board for tracking client work, pipeline, and weekly schedules. Designed for the office TV and web access. Phase 0 of the full PM tool.

## Overview

Runway shows everything in flight on one screen: this week's calendar, project status by account, and unsigned SOWs. Team members update it via Slack DMs to a bot that uses AI to interpret updates and write to the database.

```
Browser (/runway)
  → page.tsx (RSC, queries DB)
    → RunwayBoard (client component, 3 views)

Slack DM
  → /api/slack/events (HMAC verified)
    → Inngest (durable processing)
      → bot.ts (Haiku + tools)
        → operations layer → DB
        → updates channel post

Claude Code / Open Brain
  → /api/mcp/runway (Bearer token)
    → MCP server with tools
      → operations layer → DB
```

## Database

Runway uses a **separate Turso database** (`RUNWAY_DATABASE_URL`), not the main R1 database. Schema is in `src/lib/db/runway-schema.ts`, client factory in `src/lib/db/runway.ts`.

### Tables

| Table | Purpose |
|-------|---------|
| `clients` | Agency clients (Convergix, LPPC, etc.) with contract info |
| `projects` | Work items under each client, with status, owner, and resources |
| `week_items` | Calendar entries by date, with owner/resources separation |
| `pipeline_items` | Unsigned SOWs and new business, with owner and pipeline status lifecycle |
| `updates` | Audit log of all changes (idempotency-keyed, `metadata` JSON for structured undo) |
| `team_members` | Civilization team with Slack user IDs |

### Separate Drizzle Config

```bash
pnpm runway:generate  # Generate migrations
pnpm runway:push      # Push schema to Turso
pnpm runway:studio    # Open Drizzle Studio
pnpm runway:seed      # Seed from src/app/runway/data.ts
```

All Runway DB scripts export env vars from `.env.local` because drizzle-kit and tsx don't auto-load it.

## Operations Layer

All database reads and writes go through `src/lib/runway/operations*.ts`. No consumer (MCP tools, bot tools, queries) imports from `@/lib/db/` directly.

| File | Purpose |
|------|---------|
| `operations.ts` | Shared queries (client cache, name map, fuzzy match), utilities (`groupBy`, `matchesSubstring`, `getClientOrFail`), re-exports from split modules |
| `operations-reads.ts` | Barrel re-export for read operations (split into clients, week, pipeline modules) |
| `operations-reads-clients.ts` | Client/project queries: clients with counts, filtered projects |
| `operations-reads-week.ts` | Week items (filterable by owner/resource), person workload, `getLinkedWeekItems(projectId)`, and `getLinkedDeadlineItems(projectId)` (deadline-category items only) |
| `operations-reads-pipeline.ts` | Pipeline data and stale items detection |
| `operations-writes.ts` | Status updates with idempotency, audit logging, and cascade to linked week items |
| `operations-writes-project.ts` | Project field updates with forward deadline cascade (dueDate changes propagate to linked deadline week items) |
| `operations-writes-week.ts` | Create week items and update week item fields with reverse deadline cascade (deadline date changes sync back to project.dueDate) |
| `operations-writes-undo.ts` | Undo last status or field change by user (reads field from `metadata` JSON, regex fallback for pre-migration records) |
| `operations-reads-updates.ts` | Recent updates query (powers "what did I change?" recall) |
| `operations-add.ts` | New projects (with duplicate name guard, expanded fields: resources, dueDate, waitingOn) and free-form updates (with disambiguation on ambiguous project matches) |
| `operations-context.ts` | Team members (with roleCategory/accountsLed), client contacts, update history |

### Client Cache

`operations.ts` uses a 5-second in-memory cache for client rows to avoid repeated DB round-trips within a single request. The cache expires so concurrent requests don't serve stale data.

### Shared Utilities

`operations.ts` exports helpers used across modules:

- `getClientOrFail(slug)` — looks up client, returns `{ ok, client }` or standard error result (used by writes + add operations)
- `matchesSubstring(value, search)` — case-insensitive substring match (used by read operations for owner/waitingOn filters)
- `groupBy(items, keyFn)` — generic array grouping (used by reads and board queries)
- `clientNotFoundError(slug)` — standard error result for missing clients
- `resolveProjectOrFail(clientId, clientName, projectName)` — fuzzy-match project with full disambiguation error handling (ambiguous, not-found with available list)
- `resolveWeekItemOrFail(weekOf, weekItemTitle)` — fuzzy-match week item with disambiguation, mirrors `resolveProjectOrFail`
- `validateField(field, allowedFields)` — validate a field name against an allowed list, return error result or null
- `insertAuditRecord(params)` — insert an audit record into the `updates` table (used by all write operations for change tracking)
- `checkDuplicate(idemKey, duplicateResult)` — check idempotency key; returns `duplicateResult` if key exists, `null` otherwise (replaces inline `checkIdempotency` + if-block pattern)
- `fuzzyMatch(items, searchTerm, getText)` — generic ranked fuzzy match (exact > starts-with > substring), returns `match`, `ambiguous`, or `none`
- `fuzzyMatchProject` / `fuzzyMatchWeekItem` — convenience wrappers for `.name` and `.title` fields
- `CASCADE_STATUSES` — statuses that cascade from projects to linked week items: `completed`, `blocked`, `on-hold`
- `TERMINAL_ITEM_STATUSES` — week item statuses that block cascade: `completed`, `canceled`

### Field Constants

Centralized in `operations-utils.ts` so field allowlists are defined once and shared across write, undo, and validation code:

- `PROJECT_FIELDS` — editable project fields: `name`, `dueDate`, `owner`, `resources`, `waitingOn`, `notes`
- `PROJECT_FIELD_TO_COLUMN` — maps each `ProjectField` to its Drizzle column key
- `WEEK_ITEM_FIELDS` — editable week item fields: `title`, `status`, `date`, `dayOfWeek`, `owner`, `resources`, `notes`, `category`
- `WEEK_ITEM_FIELD_TO_COLUMN` — maps each `WeekItemField` to its Drizzle column key
- `UNDO_FIELDS` — derived from `[...PROJECT_FIELDS, "status", "category"]` so new project fields automatically become undoable

### Status Cascade

When a project status changes to a cascade status (`completed`, `blocked`, `on-hold`), linked week items automatically update to match. Week items already in a terminal state (`completed`, `canceled`) are left alone. Non-terminal project statuses (`in-production`, `awaiting-client`) do NOT cascade because individual week items may be at different stages.

The cascade is implemented in `operations-writes.ts` using `getLinkedWeekItems(projectId)` from `operations-reads-week.ts`. The result includes a `cascadedItems: string[]` field listing which week item titles were updated. The bot surfaces this in its response and in the updates channel post.

### Deadline Cascade

When a project's `dueDate` is changed via `updateProjectField`, all linked week items with `category === "deadline"` have their `date` updated to match (**forward cascade**). The bot's response lists which calendar items were updated. This prevents the bug where `projects.dueDate` changes but the board (which reads from `week_items`) still shows the old date.

The reverse also applies: when a deadline week item's `date` is changed via `updateWeekItemField`, the linked project's `dueDate` syncs back automatically (**reverse cascade**). This only fires when all three conditions are met: `field === "date"`, `item.category === "deadline"`, and `item.projectId` is not null.

Both forward and reverse cascades are wrapped in `db.transaction()` for atomicity — if any write fails mid-cascade, all changes roll back.

**No circular cascade risk:** Forward cascade writes directly to `weekItems` table via `tx.update()`. Reverse cascade writes directly to `projects` table via `tx.update()`. Neither function calls the other -- they use raw DB writes, not the operation functions.

Week items must be linked to projects (via `projectId` FK) for cascades to work. Use `scripts/backfill-week-item-links.ts` to link existing unlinked items (`--verbose` shows match reasoning, `--apply` commits).

### FK Deletion Pattern

Delete operations null out FK references in sibling tables (inside the same transaction) before deleting the target row. See [`docs/runway-fk-deletion-pattern.md`](./runway-fk-deletion-pattern.md) for the full pattern and guidance for future `deleteClient` / `deleteTeamMember` / `deletePipelineItem` operations.

### Idempotency

All write operations generate a deterministic idempotency key (SHA-256 hash of operation parts). Duplicate requests return success without writing.

### Structured Undo via Metadata

Field-change audit records store `metadata: JSON.stringify({ field })` so `undoLastChange` can read the field name from structured data instead of parsing it from the summary string. For records created before the migration (no `metadata` column), the regex fallback (`/: (\w+) changed from/`) is used.

Undo handles null/empty `previousValue` gracefully: status reverts to `"not-started"`, fields revert to `null`. Sequential undos work correctly — the scan loop skips records that already have an undo audit entry (checked via idempotency key), always reverting the most recent un-undone change first. The query uses `orderBy(desc(createdAt), desc(id))` for stable ordering when timestamps collide. The scan is bounded to `MAX_UNDO_SCAN` (50) most recent records to prevent unbounded DB queries.

### Fuzzy Matching with Disambiguation

Project and week item lookups use ranked fuzzy matching via `fuzzyMatch()`:

1. **Exact match** (case-insensitive) -- single result, highest confidence
2. **Starts-with match** -- single if only one, else returns `ambiguous` with options
3. **Substring match** -- single if only one, else returns `ambiguous` with options

All comparisons normalize dashes and whitespace via `normalizeForMatch()`: em dashes (—), en dashes (–), and hyphens (-) are replaced with spaces, then whitespace is collapsed. This means "Impact Report Dev" matches "Impact Report — Dev" in the database. Items are pre-normalized once per `fuzzyMatch` call for performance.

When a match is ambiguous, write operations return an error like `"Multiple projects match 'Impact Report': Impact Report Dev, Impact Report Design. Which one?"` with an `available` list so the bot can ask clearly. The `resolveProjectOrFail()` helper encapsulates this pattern for all project write operations.

## Reference Data

Static lookup tables for clients and team members, used by the bot system prompt and contact tools. Easier to edit than DB rows.

| File | Purpose |
|------|---------|
| `src/lib/runway/reference/clients.ts` | 13 clients with slugs, nicknames, and contacts |
| `src/lib/runway/reference/team.ts` | 11 team members with roles, accountsLed, titles (includes contractors) |
| `src/lib/runway/date-constants.ts` | Shared `DAY_NAMES`, `MONTH_NAMES`, `MONTH_NAMES_SHORT` |

### Client References

Each entry has `slug`, `fullName`, `nicknames[]`, and `contacts[]`. Used by `buildBotSystemPrompt` for the client map section and by the `get_client_contacts` bot tool.

### Team References

Each entry has `fullName`, `firstName`, `nicknames[]`, `roleCategory` (creative/dev/am/pm/leadership/community/contractor), `accountsLed[]`, and `title`. Used by the system prompt for the team roster and name disambiguation. Contractors (Chris, Josefina) have empty `slackUserId` and `accountsLed`.

Key disambiguation: "Lane" defaults to Lane Jordan (Creative Director), not Ronan Lane (PM).

## Board UI

Server-rendered page at `/runway` with three client-side views:

| View | Component | Data Source |
|------|-----------|-------------|
| This Week | `TodaySection` + `DayColumn` | `getWeekItems()` split by current week |
| By Account | `AccountSection` | `getClientsWithProjects()` |
| Pipeline | `PipelineRow` | `getPipeline()` |

### Data Flow

```
page.tsx (RSC)
  → Promise.all([getClientsWithProjects(), getWeekItems(), getPipeline(), getStaleWeekItems()])
  → Splits week items into thisWeek/upcoming by current Monday
  → analyzeFlags() generates AI flags from board data
  → Maps DB shapes to UI types (src/app/runway/types.ts)
  → RunwayBoard (client component)
    → NeedsUpdateSection: stale items from previous days (above Today)
    → Pre-computes todayColumn, restOfWeek from thisWeek
    → mergeWeekendDays() combines Sat+Sun into single Weekend column
    → groupByWeek() groups upcoming days under "w/o M/D" headers
    → FlagsPanel: AI flags sidebar (resource conflicts, stale items, deadlines, bottlenecks)
    → Tab state selects view
    → Leaf components render data
```

### Auto-Refresh

`RunwayBoard` uses a `useEffect` with `setInterval` to call `router.refresh()` every 5 minutes. This keeps the TV display current without manual browser refresh. The RSC re-fetches all data on refresh.

### Weekend Merge

`mergeWeekendDays(days)` scans for adjacent Saturday + Sunday `DayItem` entries and combines them into a single "Weekend" column. If only one weekend day has items, it passes through unchanged. Applied to both the This Week and Upcoming sections.

### Week Dividers

`groupByWeek(days)` groups upcoming day columns by their week's Monday, rendering each group under an "Upcoming w/o M/D" header (e.g., "Upcoming w/o 4/13"). This visually separates weeks in the Upcoming section.

### Card Hierarchy

`DayItemCard` renders fields in this order: account name (uppercase, prominent), project/task title, resources via `MetadataLabel` (who does the work), notes with parsed "Next Step:" labels and "(Risk: ...)" in amber, then owner (muted, only when different from resources). The type tag (delivery, review, kickoff, etc.) appears on the right. Owner/resources display logic is in `display-utils.ts` (`getOwnerResourcesDisplay`). Both `sm` (day columns) and `lg` (today section) sizes share the same `ACCOUNT_CLASS` constant.

### Scroll Constraints

Day columns use `max-h-[60vh] overflow-y-auto` so they scroll internally instead of growing infinitely. The Today section uses `max-h-[70vh]`. This keeps the TV display readable when a day has many items.

### Account View

`AccountSection` shows projects as divider-separated sections (border-t between items) sorted by startDate. Key behaviors:

- **Date sorting**: `startDateSortKey()` returns the ISO `startDate` (YYYY-MM-DD), falling back to a high-sentinel string so items without a startDate sort to the end. Lexicographic ISO comparison preserves chronological order without parsing Dates.
- **Contract label expansion**: `formatContractTerm()` expands abbreviations (MSA, SOW, NDA) in contract term strings for readability.
- **Graceful nulls**: Missing `contractValue` or `contractTerm` fields are simply not rendered (no empty elements).

### Pipeline View

`PipelineRow` displays SOWs and new business with these behaviors:

- **Pipeline status lifecycle**: `scoping` -> `drafting` -> `sow-sent` -> `verbal` -> `signed`, with `at-risk` as a branch (work happening without formal agreement). Statuses: `scoping` (gray), `drafting` (violet), `sow-sent` (amber), `verbal` (green), `signed` (sky), `at-risk` (red).
- **Owner display**: Owner shown as muted metadata alongside waitingOn.
- **Waiting on fallback**: `getWaitingOnDisplay()` returns the explicit `waitingOn` name if set. For `sow-sent` and `verbal` statuses without a name, falls back to "Client". Other statuses show nothing.
- **Next Steps prefix**: Notes are shown with a "Next Steps:" label prefix.

### Shared Display Components

`status-badge.tsx` exports reusable badge and label components:

- `StatusBadge` — project status (in-production, blocked, etc.)
- `ContractBadge` — contract state (expired, unsigned)
- `StaleBadge` — stale-days indicator
- `MetadataLabel` — "Label: Value" pattern with configurable color (used by AccountSection, PipelineRow, and DayItemCard)

### Blocked Override

`DayItemCard` uses `getEffectiveType(item)` to override the display type to `"blocked"` (red) when notes contain hold/blocked language ("holds until", "on hold", "blocked", "not starting until"). This prevents items like "AARP API meeting" from showing as KICKOFF when they're actually held pending SOW signature.

### Types

UI types are in `src/app/runway/types.ts`. DB types are inferred from Drizzle schema. `page.tsx` maps between them to keep schema imports out of client components.

## MCP Server

Documented in [MCP Integration](./mcp-integration.md#standalone-mcp-servers-runway). Bearer token auth at `POST /api/mcp/runway`. 11 tools wrapping the operations layer (includes `get_person_workload` for cross-client workload queries).

## Slack Bot

### Flow

1. Team member DMs the bot (text and/or images), possibly in a thread
2. `POST /api/slack/events` verifies HMAC signature, extracts image file metadata and `thread_ts`, dispatches to Inngest
3. Inngest function (`runway/slack.message`) downloads images via Slack API (with `Promise.allSettled` for graceful failure), then calls `handleDirectMessage` with `threadTs`
4. `handleDirectMessage` fetches thread history if in a thread (capped at 20 messages), builds a dynamic system prompt via `buildBotSystemPrompt`, sends full conversation + images as AI SDK content blocks to Sonnet with 14 tools (MAX_STEPS=12)
5. Bot responds in thread, posts formatted update to updates channel
6. Proactive follow-up fires only on first message (not thread replies), excludes projects touched by any mutation tool in the current response (`MUTATION_TOOLS` constant), filtered by the user's owned/resourced items

### Dynamic System Prompt

`src/lib/runway/bot-context.ts` composes sections from `bot-context-sections.ts` (data builders) and `bot-context-behaviors.ts` (behavior rules) into a context-rich prompt with 12 sections:

1. Core rules (project statuses, pipeline statuses, update workflow)
2. Date context (today, this week's Monday, yesterday, tomorrow)
3. Identity context (who's talking -- name, role, accounts led)
4. Query recipes (owner vs resource, "what did I update" recall, cascade behavior)
5. Team roster (all members with roles and accounts)
6. Client map (nicknames, slugs, contacts)
7. Natural language glossary ("out the door" = delivered, "sitting on it" = awaiting client, etc.)
8. Role-based behavior (AM vs creative vs PM query interpretation)
9. Proactive behavior (suggest related updates, flag contradictions, multi-update handling)
10. Confirmation rules (confirm before completing/on-hold, changing owner, creating projects; ambiguity handling)
11. Tone rules (no AI voice, acknowledge frustration)
12. Capability boundaries (what the bot CAN and CANNOT do, critical add_update vs update_project_field distinction)

The prompt is built per-message using the team member's record from the DB and the current date. Unknown Slack users get a null record and the bot asks who they are.

### Prompt Caching

The system prompt is sent as the first message in the `messages` array (not via the `system` parameter) with Anthropic ephemeral cache control:

```typescript
const cacheControl = { cacheControl: { type: "ephemeral" as const } };
const messages = [
  {
    role: "system" as const,
    content: systemPrompt,
    providerOptions: { anthropic: cacheControl },
  },
  ...threadHistory,
  { role: "user" as const, content: userContent },
];
```

This matches the `addCacheBreakpoints` pattern in `src/lib/chat/index.ts`. Cache control must be on the message object via `providerOptions`, not at the `generateText` call level (top-level `providerOptions` is silently ignored for caching). The system prompt is large (~3K tokens with roster, client map, and behavior rules), so caching it across multi-turn thread conversations reduces cost significantly.

### Thread History

When a user replies in a Slack thread, the bot fetches the full conversation (up to 20 most recent messages) via `conversations.replies` and includes them as prior `user`/`assistant` messages in the AI call. This gives the bot multi-turn context so users don't repeat themselves. The `threadTs` flows from the Slack event through Inngest to `handleDirectMessage`. Responses and proactive follow-ups are posted to the same thread via `thread_ts`.

### Image Attachments

When a user sends images in a DM:

1. `route.ts` extracts `event.files`, filters to `image/*` mimetypes
2. Messages with only images (no text) are dispatched normally
3. Inngest downloads each image using `SLACK_BOT_TOKEN` auth, converts to base64
4. Failed downloads are skipped gracefully (`Promise.allSettled`)
5. `bot.ts` sends images as AI SDK `ImagePart` content blocks alongside text

### Bot Tools

Defined in `src/lib/slack/bot-tools.ts`. Same operations as MCP but wrapped as AI SDK `tool()` calls with `postUpdate` side effect:

| Tool | Purpose |
|------|---------|
| `get_clients` | List clients with project counts |
| `get_projects` | List projects filtered by client, owner, or waitingOn |
| `get_pipeline` | List unsigned SOWs |
| `get_week_items` | Calendar items for a week, filterable by owner (accountable) or resource (doing the work) |
| `get_person_workload` | Cross-client view of a person's projects and week items (searches both owner and resource fields) |
| `get_client_contacts` | Contact names and roles for a client (from reference data) |
| `update_project_status` | Change status + cascade to linked week items + post to updates channel. Returns before/after in response. |
| `add_update` | Log free-form update + post to updates channel. Does NOT change any DB field. |
| `create_project` | Create a new project under a client (with owner, resources, dueDate, waitingOn). Rejects duplicate names under same client. |
| `update_project_field` | Update a specific project field (name, dueDate, owner, resources, waitingOn, notes). ACTUALLY changes the DB. dueDate changes cascade to linked deadline week items. |
| `create_week_item` | Add a new item to the weekly calendar |
| `undo_last_change` | Revert the user's most recent status or field change |
| `get_recent_updates` | Look up recent changes (powers "what did I change?" queries) |
| `update_week_item` | Update a field on an existing week item + post to updates channel |

### No-Op Guard

All write tool handlers (`update_project_status`, `update_project_field`, `update_week_item`) check if the previous value equals the new value before posting to the updates channel. True no-ops skip the channel post to prevent spam. However, meaningful side effects still trigger posts:

- **Cascade-only**: `update_project_field` posts when the field value is unchanged but linked deadline items were cascaded
- **Notes-only**: `update_project_status` posts when the status is unchanged but notes were provided
- **Reverse cascade**: `update_week_item` posts with a "(also updated project dueDate)" note when reverse cascade fired

### Structured Logging

`bot.ts` emits structured JSON logs for every bot interaction, visible in Vercel logs:

- `runway_bot_request` -- user, slackUserId, isThread, inputTokens, outputTokens, stepCount
- `runway_bot_tool_call` -- tool name and **sanitized** input (only safe structural fields like clientSlug, projectName, field, newValue; sensitive free-text fields like notes/summary are stripped)
- `runway_bot_tool_result` -- tool name and output for each tool result
- `runway_bot_error` -- user and error message on failure
- `runway_bot_proactive_error` -- proactive follow-up failures
- `runway_bot_post_error` -- updates channel post failures

Cascade operations emit their own structured logs from the operations layer:

- `runway_cascade_forward` -- projectId, field, newValue, cascadedItems[] (from `operations-writes-project.ts`)
- `runway_cascade_reverse` -- weekItemId, projectId, field, newValue (from `operations-writes-week.ts`)

### Token Usage Tracking

After each bot response, `recordTokenUsage()` persists token counts to the main app's `tokenUsage` table using `"runway-bot"` as the sentinel workspace ID. This is non-critical — failures are silently caught to avoid breaking bot responses.

### Updates Channel

`src/lib/slack/updates-channel.ts` posts formatted messages:

```
*Convergix*
_Project:_ CDS Messaging
_Update:_ In Production -> Sent to Client
_Updated by:_ Kathy Horn, Apr. 5 2026 at 10:14 AM
```

### Security

- **Signature verification**: `src/lib/slack/verify.ts` uses `crypto.timingSafeEqual` for HMAC-SHA256
- **Replay protection**: Rejects timestamps older than 5 minutes
- **Bot loop prevention**: Ignores messages with `bot_id` or `subtype`

## Inngest

The Slack bot uses Inngest for durable processing so the webhook can respond within Slack's 3-second timeout.

```typescript
// src/lib/inngest/functions/runway-slack-message.ts
export const processRunwaySlackMessage = inngest.createFunction(
  { id: "runway-slack-message", retries: 2, concurrency: { limit: 3 } },
  { event: "runway/slack.message" },
  async ({ event, step }) => {
    const { slackUserId, channelId, messageText, messageTs, threadTs, imageFiles } = event.data;

    // Download images (graceful failure via Promise.allSettled)
    const images = await step.run("download-images", async () => { /* ... */ });

    // Process message with text + images + thread context
    await step.run("process-message", async () => {
      await handleDirectMessage(slackUserId, channelId, messageText, messageTs, threadTs, images);
    });
  },
);
```

Requires `pnpm dev:inngest` (or `pnpm dev:all`) running alongside the dev server.

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `RUNWAY_DATABASE_URL` | Turso connection URL |
| `RUNWAY_AUTH_TOKEN` | Turso auth token |
| `RUNWAY_MCP_API_KEY` | Bearer token for MCP endpoint |
| `SLACK_BOT_TOKEN` | Slack app bot token |
| `SLACK_SIGNING_SECRET` | HMAC signing secret |
| `SLACK_UPDATES_CHANNEL_ID` | Channel for update logs |

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/db/runway-schema.ts` | Database schema (6 tables) |
| `src/lib/db/runway.ts` | Database client factory |
| `src/lib/runway/operations.ts` | Barrel re-export + shared utilities (groupBy, matchesSubstring, etc.) |
| `src/lib/runway/operations-utils.ts` | Shared utility implementations (client cache, fuzzy match, idempotency, field constants, insertAuditRecord, checkDuplicate, resolveProjectOrFail, resolveWeekItemOrFail, validateField) |
| `src/lib/runway/operations-writes-project.ts` | Project field update operations |
| `src/lib/runway/operations-writes-week.ts` | Week item create and field update operations |
| `src/lib/runway/operations-writes-undo.ts` | Undo last change operation |
| `src/lib/runway/operations-reads-updates.ts` | Recent updates query |
| `src/lib/runway/flags.ts` | AI flag analysis (resource conflicts, stale items, deadlines, bottlenecks) |
| `src/lib/runway/bot-context.ts` | Dynamic system prompt coordinator |
| `src/lib/runway/bot-context-sections.ts` | Prompt data builders (date, identity, roster, client map, recipes) |
| `src/lib/runway/bot-context-behaviors.ts` | Prompt behavior rules (glossary, roles, tone, capabilities, confirmation) |
| `src/lib/runway/date-constants.ts` | Shared date formatting constants |
| `src/lib/runway/reference/clients.ts` | Client reference data (nicknames, contacts) |
| `src/lib/runway/reference/team.ts` | Team reference data (roles, accounts led) |
| `src/lib/mcp/runway-server.ts` | MCP server factory |
| `src/lib/mcp/runway-tools.ts` | MCP tool registrations (11 tools) |
| `src/app/api/mcp/runway/route.ts` | MCP HTTP endpoint |
| `src/app/api/slack/events/route.ts` | Slack webhook handler (text + images) |
| `src/lib/slack/bot.ts` | AI bot orchestration (text + image content blocks, sanitized logging, token tracking) |
| `src/lib/slack/bot-tools.ts` | Bot tool definitions (14 tools) |
| `src/lib/slack/verify.ts` | Slack signature verification |
| `src/lib/slack/updates-channel.ts` | Updates channel posting |
| `src/app/runway/page.tsx` | Board page (RSC, data transformation) |
| `src/app/runway/runway-board.tsx` | Board client component (3 views) |
| `src/app/runway/queries.ts` | Board-specific DB queries |
| `src/app/runway/date-utils.ts` | `parseISODate`, `getMonday`, `getMondayISODate` |
| `src/app/runway/runway-board-utils.ts` | Board utilities (mergeWeekendDays, groupByWeek) |
| `src/app/runway/components/day-item-card.tsx` | Card component (resources-first, notes parsing, blocked override) |
| `src/app/runway/components/display-utils.ts` | Shared display helpers (getOwnerResourcesDisplay) |
| `src/app/runway/components/flags-panel.tsx` | AI flags sidebar panel |
| `src/app/runway/components/needs-update-section.tsx` | Stale items urgency section |
| `src/app/runway/components/status-badge.tsx` | Shared badge and label components |
| `src/app/runway/data.ts` | Seed data (13 clients, typed exports) |
| `scripts/seed-runway.ts` | Seed script (imports from date-utils, links week items to projects via `projectId` FK) |
| `scripts/backfill-week-item-links.ts` | One-time backfill: links unlinked week items to projects via fuzzy title matching. Dry-run by default, `--verbose` for match reasoning, `--apply` to commit. Warns about cascade risk from incorrect links. |

## Related Documentation

- [MCP Integration](./mcp-integration.md#standalone-mcp-servers-runway) - MCP server details
- [AI SDK Integration](./ai-sdk.md) - How `generateText` and tools work
