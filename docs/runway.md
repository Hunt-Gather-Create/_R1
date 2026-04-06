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
| `projects` | Work items under each client, with status and category |
| `week_items` | Calendar entries by date, linked to clients |
| `pipeline_items` | Unsigned SOWs and new business, linked to clients |
| `updates` | Audit log of all changes (idempotency-keyed) |
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
| `operations.ts` | Shared queries (client cache, name map, fuzzy match), utilities (`groupBy`, `clientNotFoundError`), re-exports from split modules |
| `operations-reads.ts` | Read operations: clients with counts, filtered projects, week items, pipeline |
| `operations-writes.ts` | Status updates with idempotency and audit logging |
| `operations-add.ts` | New projects and free-form updates |
| `operations-context.ts` | Team members, client contacts, update history |

### Client Cache

`operations.ts` uses a 5-second in-memory cache for client rows to avoid repeated DB round-trips within a single request. The cache expires so concurrent requests don't serve stale data.

### Shared Utilities

`operations.ts` exports two helpers used across write modules:

- `clientNotFoundError(slug)` — standard error result for missing clients (used by writes + add operations)
- `groupBy(items, keyFn)` — generic array grouping (used by reads and board queries)

### Idempotency

All write operations generate a deterministic idempotency key (SHA-256 hash of operation parts). Duplicate requests return success without writing.

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
  → Promise.all([getClientsWithProjects(), getWeekItems(), getPipeline()])
  → Splits week items into thisWeek/upcoming by current Monday
  → Maps DB shapes to UI types (src/app/runway/types.ts)
  → RunwayBoard (client component)
    → Pre-computes todayColumn, restOfWeek from thisWeek
    → mergeWeekendDays() combines Sat+Sun into single Weekend column
    → groupByWeek() groups upcoming days under "w/o M/D" headers
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

`DayItemCard` renders fields in this order: account name (uppercase, prominent), project/task title, owner (if present), notes. The type tag (delivery, review, kickoff, etc.) appears on the right. Both `sm` (day columns) and `lg` (today section) sizes share the same `ACCOUNT_CLASS` constant for the account label.

### Scroll Constraints

Day columns use `max-h-[60vh] overflow-y-auto` so they scroll internally instead of growing infinitely. The Today section uses `max-h-[70vh]`. This keeps the TV display readable when a day has many items.

### Account View

`AccountSection` shows projects as divider-separated sections (border-t between items) sorted by target date. Key behaviors:

- **Date sorting**: `targetSortKey()` parses `M/D` patterns from free-text target strings. Items with no parseable date sort to the end.
- **Short date display**: `extractDate()` pulls the first `M/D` from the target and shows it on the right side of each project card.
- **Contract label expansion**: `formatContractTerm()` expands abbreviations (MSA, SOW, NDA) in contract term strings for readability.
- **Graceful nulls**: Missing `contractValue` or `contractTerm` fields are simply not rendered (no empty elements).

Both `targetSortKey` and `extractDate` share a single `DATE_PATTERN` regex.

### Pipeline View

`PipelineRow` displays unsigned SOWs with these behaviors:

- **Status labels**: `no-sow` displays as "Drafting" (same label as `drafting`, different color). `sow-sent` displays as "SOW Sent", `verbal` as "Verbal".
- **Waiting on fallback**: `getWaitingOnDisplay()` returns the explicit `waitingOn` name if set. For `sow-sent` and `verbal` statuses without a name, falls back to "Client". Other statuses show nothing.
- **Next Steps prefix**: Notes are shown with a "Next Steps:" label prefix.

### Shared Display Components

`status-badge.tsx` exports reusable badge and label components:

- `StatusBadge` — project status (in-production, blocked, etc.)
- `ContractBadge` — contract state (expired, unsigned)
- `StaleBadge` — stale-days indicator
- `MetadataLabel` — "Label: Value" pattern with configurable color (used by AccountSection and PipelineRow)

### Blocked Override

`DayItemCard` uses `getEffectiveType(item)` to override the display type to `"blocked"` (red) when notes contain hold/blocked language ("holds until", "on hold", "blocked", "not starting until"). This prevents items like "AARP API meeting" from showing as KICKOFF when they're actually held pending SOW signature.

### Types

UI types are in `src/app/runway/types.ts`. DB types are inferred from Drizzle schema. `page.tsx` maps between them to keep schema imports out of client components.

## MCP Server

Documented in [MCP Integration](./mcp-integration.md#standalone-mcp-servers-runway). Bearer token auth at `POST /api/mcp/runway`. 10 tools wrapping the operations layer.

## Slack Bot

### Flow

1. Team member DMs the bot
2. `POST /api/slack/events` verifies HMAC signature, dispatches to Inngest
3. Inngest function (`runway/slack.message`) calls `handleDirectMessage`
4. `handleDirectMessage` uses Haiku with 6 tools to interpret the message
5. Bot responds in thread, posts formatted update to updates channel

### Bot Tools

Defined in `src/lib/slack/bot-tools.ts`. Same operations as MCP but wrapped as AI SDK `tool()` calls with `postUpdate` side effect:

| Tool | Purpose |
|------|---------|
| `get_clients` | List clients with project counts |
| `get_projects` | List projects for a client |
| `get_pipeline` | List unsigned SOWs |
| `get_week_items` | Calendar items for a week |
| `update_project_status` | Change status + post to updates channel |
| `add_update` | Log free-form update + post to updates channel |

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
export const runwaySlackMessage = inngest.createFunction(
  { id: "runway-slack-message" },
  { event: "runway/slack.message" },
  async ({ event }) => {
    await handleDirectMessage(
      event.data.slackUserId,
      event.data.channelId,
      event.data.messageText,
      event.data.messageTs,
    );
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
| `src/lib/runway/operations.ts` | Shared operations entry point |
| `src/lib/mcp/runway-server.ts` | MCP server factory |
| `src/lib/mcp/runway-tools.ts` | MCP tool registrations |
| `src/app/api/mcp/runway/route.ts` | MCP HTTP endpoint |
| `src/app/api/slack/events/route.ts` | Slack webhook handler |
| `src/lib/slack/bot.ts` | AI bot orchestration |
| `src/lib/slack/bot-tools.ts` | Bot tool definitions |
| `src/lib/slack/verify.ts` | Slack signature verification |
| `src/lib/slack/updates-channel.ts` | Updates channel posting |
| `src/app/runway/page.tsx` | Board page (RSC, data transformation) |
| `src/app/runway/runway-board.tsx` | Board client component (3 views) |
| `src/app/runway/queries.ts` | Board-specific DB queries |
| `src/app/runway/date-utils.ts` | `parseISODate`, `getMondayISODate` |
| `src/app/runway/components/day-item-card.tsx` | Card component (account-first hierarchy, blocked override) |
| `src/app/runway/components/status-badge.tsx` | Shared badge and label components |
| `src/app/runway/data.ts` | Seed data (13 clients, typed exports) |
| `scripts/seed-runway.ts` | Seed script (imports from date-utils) |

## Related Documentation

- [MCP Integration](./mcp-integration.md#standalone-mcp-servers-runway) - MCP server details
- [AI SDK Integration](./ai-sdk.md) - How `generateText` and tools work
