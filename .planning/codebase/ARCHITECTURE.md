<!-- refreshed: 2026-08-04 -->
# Architecture

**Analysis Date:** 2026-08-04

## System Overview

```text
┌──────────────────────────────────────────────────────────────────┐
│                  Next.js 15 App (src/app/)                        │
│   /w/[slug]  |  /dashboard  |  /login  |  /runway  |  /beta      │
└───────┬──────────────┬──────────────┬──────────────┬─────────────┘
        │              │              │              │
        ▼              ▼              ▼              ▼
┌──────────────────────────────────────────────────────────────────┐
│              API Routes (src/app/api/)                            │
│  /chat/*  /skills/*  /slack/*  /ai/*  /mcp/runway  /runway/*     │
└───────┬──────────────┬──────────────┬──────────────┬─────────────┘
        │              │              │              │
        ▼              ▼              ▼              ▼
┌────────────┐  ┌─────────────┐  ┌──────────┐  ┌───────────────┐
│ src/lib/   │  │ Inngest      │  │ Slack    │  │ MCP Server    │
│ chat/      │  │ Background   │  │ Bot      │  │ /api/mcp/     │
│ (AI layer) │  │ Jobs         │  │ Layer    │  │ runway        │
└─────┬──────┘  └──────┬──────┘  └────┬─────┘  └───────────────┘
      │                │              │
      ▼                ▼              ▼
┌──────────────────────────────────────────────────────────────────┐
│                  Data Layer (src/lib/db/)                         │
│  Main DB: Turso/libSQL (schema.ts)                               │
│  Runway DB: Turso/libSQL (runway-schema.ts) - separate instance  │
└──────────────────────────────────────────────────────────────────┘
        │                              │
        ▼                              ▼
┌──────────────┐              ┌─────────────────┐
│ Main Turso   │              │ Runway Turso DB  │
│ (app data:   │              │ (agency ops:     │
│ workspaces,  │              │ clients, projs,  │
│ issues, etc.)│              │ week_items, etc.)│
└──────────────┘              └─────────────────┘
```

## Component Responsibilities

| Component | Responsibility | Key Files |
|-----------|----------------|-----------|
| Next.js App Router | Page routing, SSR, layouts | `src/app/` |
| Workspace UI | Kanban board, issue management, chat | `src/app/w/[slug]/` |
| Server Actions | Mutation layer for DB writes from UI | `src/lib/actions/` |
| AI/Chat Layer | Streaming chat, tool dispatch, skill loading | `src/lib/chat/index.ts` |
| Inngest Functions | Durable background jobs (AI tasks, Slack, brand research) | `src/lib/inngest/functions/` |
| Slack Bot | Slash commands, events, interactive modals | `src/lib/slack/`, `src/app/api/slack/` |
| MCP Server | Runway data exposed as MCP tools to AI agents | `src/lib/mcp/runway-server.ts` |
| Main DB (schema.ts) | App data: workspaces, issues, users, skills, memories | `src/lib/db/schema.ts` |
| Runway DB (runway-schema.ts) | Agency ops data: clients, projects, week items | `src/lib/db/runway-schema.ts` |
| Auth Middleware | WorkOS AuthKit, session gating | `proxy.ts` |

## Pattern Overview

**Overall:** Next.js full-stack app with two distinct data domains separated into two Turso databases. AI operations run via Vercel AI SDK (streaming) in route handlers, and via Inngest (durable async) for long-running jobs.

**Key Characteristics:**
- App Router with server components and server actions; no pages/ directory.
- Two completely separate Turso/libSQL database instances: one for the "workspace" product (issues, kanban, chat), one for the "Runway" agency operations system (clients, projects, week items).
- AI layer built on `@ai-sdk/anthropic` + Vercel AI SDK `streamText`. Skills loaded lazily via a `load_skill` tool to reduce token costs.
- Background jobs (brand research, AI task execution, audience generation, Slack processing) run durably via Inngest at `src/app/api/inngest/`.
- Slack bot exposed via four webhook routes; events fan out to Inngest for durable processing.
- Runway data is also exposed as an MCP server at `POST /api/mcp/runway` (Bearer token auth).

## Layers

**UI Layer:**
- Purpose: Pages, layouts, and workspace-specific components.
- Location: `src/app/`, `src/components/`
- Contains: React server/client components, page routes, Next.js layouts.
- Depends on: Server actions, API routes, DB (via server components).

**API Route Layer:**
- Purpose: Edge/server HTTP endpoints for AI chat, Slack webhooks, Inngest, MCP, skills.
- Location: `src/app/api/`
- Contains: Next.js `route.ts` files, each exporting HTTP method handlers.
- Depends on: `src/lib/chat`, `src/lib/slack`, `src/lib/inngest`, `src/lib/db`, `src/lib/actions`.

**AI/Chat Library:**
- Purpose: Shared `createChatResponse()` factory; handles model selection, prompt caching, MCP tool injection, skill lazy-loading, token tracking.
- Location: `src/lib/chat/index.ts`, `src/lib/chat/tools/`
- Contains: `createChatResponse`, tool factories (`issue-tools.ts`, `planning-tools.ts`, `memory-tools.ts`, `skill-tools.ts`).
- Depends on: `@ai-sdk/anthropic`, `src/lib/db`, `src/lib/mcp`, `src/lib/token-usage`.

**Inngest Background Jobs:**
- Purpose: Durable, retryable async jobs outside the 30s request window.
- Location: `src/lib/inngest/functions/`, registered at `src/app/api/inngest/route.ts`.
- Contains: `executeAITask`, `researchBrandGuidelines`, `generateAudienceMembers`, `generateSoul`, `processRunwaySlackMessage`, `sweepExpiredProposals`, `runwayAutoPromote`, `slackModalSubmit`.
- Depends on: Inngest client, `src/lib/db`, Anthropic SDK directly (not via `createChatResponse`).

**Server Actions:**
- Purpose: Typed server-side mutations callable from client components without explicit fetch.
- Location: `src/lib/actions/`
- Contains: One file per domain: `issues.ts`, `board.ts`, `brand.ts`, `audience.ts`, `workspace.ts`, `skills.ts`, `memories.ts`, `knowledge.ts`, `chat.ts`, `workspace-chat.ts`, `users.ts`, `invite-codes.ts`, etc.
- Depends on: `src/lib/db`.

**Slack Layer:**
- Purpose: Slack bot: signature verification, slash commands, events, interactive modals, proactive messages.
- Location: `src/lib/slack/`
- Contains: `bot.ts`, `client.ts`, `verify.ts`, `bot-tools.ts`, `bot-proactive.ts`, `updates-channel.ts`, modal handlers.
- Depends on: Inngest (events fan out to `processRunwaySlackMessage`, `slackModalSubmit`).

**Data Layer (Dual DB):**
- Purpose: Typed ORM access via Drizzle.
- Location: `src/lib/db/`
- Main DB client: `src/lib/db/index.ts` - exports `db`, uses `TURSO_DATABASE_URL`.
- Runway DB client: `src/lib/db/runway.ts` - exports `runwayDb`, uses `RUNWAY_DATABASE_URL`. Lazy singleton.
- Main schema: `src/lib/db/schema.ts`.
- Runway schema: `src/lib/db/runway-schema.ts`.

**MCP Server:**
- Purpose: Expose Runway agency data as MCP tools for external AI agents.
- Location: `src/lib/mcp/runway-server.ts`, exposed at `src/app/api/mcp/runway/route.ts`.
- Auth: Bearer token (`RUNWAY_MCP_API_KEY`).

## Data Flow

### AI Chat Request (workspace chat)

1. User sends message - `POST /api/chat/workspace` (`src/app/api/chat/workspace/route.ts`).
2. Route loads workspace context (brand, soul, memories), resolves skills via `loadSkillsForWorkspace()`.
3. Calls `createChatResponse()` in `src/lib/chat/index.ts`.
4. `createChatResponse` injects MCP tools from enabled integrations, adds Anthropic built-in tools, adds `load_skill` lazy-loader tool, applies prompt-cache breakpoints.
5. `streamText` streams back via `result.toUIMessageStreamResponse()`.
6. Token usage recorded asynchronously via `recordTokenUsage()`.

### AI Task Execution (background)

1. Issue marked `aiAssignable = true` in DB.
2. Client posts to `POST /api/ai/send` or a server action triggers the Inngest event.
3. Inngest picks up `executeAITask` function (`src/lib/inngest/functions/ai-task-execution.ts`).
4. Function runs full AI loop, writes result back to issue (`aiExecutionResult`, `aiExecutionStatus`).

### Slack Event Flow

1. Slack posts event to `POST /api/slack/events`.
2. Route verifies HMAC signature, then sends Inngest event.
3. `processRunwaySlackMessage` Inngest function handles the message durably, calling Runway DB and posting responses.

### Runway MCP Flow

1. External AI agent sends `POST /api/mcp/runway` with Bearer token.
2. Route creates `RunwayMcpServer`, handles MCP protocol message.
3. MCP tools query `runwayDb` (Runway Turso instance) and return structured data.

## Key Abstractions

**Workspace:**
- Purpose: Multi-tenant container; scopes all issues, columns, skills, chat, memories, audience.
- Schema: `workspaces` table in main DB; accessed by slug in URL (`/w/[slug]`).
- Purpose field: `"software" | "marketing"` - gates which AI system prompts and skills load.

**Issue:**
- Purpose: Core work item. Supports subtasks (1 level), cycles, epics, labels, assignees, AI execution fields.
- Schema: `issues` table; `aiAssignable`, `aiExecutionStatus`, `aiExecutionResult` fields for agentic execution.

**Skills:**
- Purpose: Reusable AI instruction sets. Loaded lazily during chat to minimize token cost.
- Two layers: workspace-scoped skills in DB (`workspaceSkills` table) and file-system bundled skills (`src/skills/`).
- Lazy-loaded via `load_skill` tool call during chat.

**Runway (Agency Ops):**
- Purpose: Entirely separate data domain. Tracks Civilization Agency's clients, projects, week items, proposals. Not related to workspace/issue product.
- DB: `RUNWAY_DATABASE_URL` (separate Turso instance). Schema: `src/lib/db/runway-schema.ts`.

## Entry Points

**Web App:**
- Location: `src/app/layout.tsx` (root), `src/app/w/[slug]/layout.tsx` (workspace shell).
- Triggers: Browser navigation, Next.js server rendering.

**Auth Middleware:**
- Location: `proxy.ts` (Next.js middleware, matched via `config.matcher`).
- Responsibilities: WorkOS AuthKit session gating; excludes Slack webhook paths, MCP endpoint, gantt-share tokens.

**Inngest Webhook:**
- Location: `src/app/api/inngest/route.ts`.
- Triggers: Inngest cloud calls back to run registered functions.

**Slack Webhooks:**
- Locations: `src/app/api/slack/events`, `commands`, `interactivity`, `options`.
- Triggers: Slack platform posts to these on user actions.

**MCP Server:**
- Location: `src/app/api/mcp/runway/route.ts`.
- Triggers: External AI agents calling via MCP protocol over HTTP.

## Architectural Constraints

- **Two databases:** Main app data and Runway agency ops data are strictly separate Turso instances. Never mix `db` and `runwayDb` for the same entity. `db` = `TURSO_DATABASE_URL`; `runwayDb` = `RUNWAY_DATABASE_URL`.
- **Streaming timeout:** Chat route handlers set `export const maxDuration = 30` (Vercel function limit). Long-running AI work must go through Inngest.
- **Subtask depth:** Issues support exactly 1 level of subtasks. Subtasks cannot have subtasks - enforced at application layer, not DB constraint.
- **Skill lazy-loading:** Skills are NOT injected into the system prompt wholesale. Only name + description go in the initial prompt; full content loads on `load_skill` tool call. Do not break this pattern - it controls token costs.
- **Global state:** `runwayDb` is a lazy singleton module-level proxy (`src/lib/db/runway.ts`). `db` is a module-level Drizzle instance (`src/lib/db/index.ts`).
- **Auth bypass list:** Slack routes, `/api/mcp/runway`, and gantt-share token routes are excluded from WorkOS middleware - each handles its own auth internally.

## Anti-Patterns

### Mixing the two databases
**What happens:** Querying `runwayDb` (agency ops) from workspace product logic, or vice versa.
**Why it's wrong:** The two Turso instances are separate tenants with no foreign key relationship. Mixing them will cause runtime errors or cross-domain data corruption.
**Do this instead:** Workspace/issue/user queries use `db` from `src/lib/db/index.ts`. Runway client/project/week-item queries use `runwayDb` from `src/lib/db/runway.ts`.

### Injecting full skill content into system prompt upfront
**What happens:** Passing full skill markdown into the system prompt before the user even triggers a skill.
**Why it's wrong:** Wastes tokens on every request. The lazy-loading architecture exists specifically to avoid this.
**Do this instead:** Use `loadSkillsForWorkspace()` to get skill metadata, pass to `createChatResponse` as `skills`, and let the `load_skill` tool fetch full content on demand.

### Doing long AI work inside a route handler
**What happens:** Calling Anthropic API in a route handler for tasks that may take more than 30 seconds.
**Why it's wrong:** Vercel functions time out at 30s (`maxDuration = 30`). The call will be killed mid-execution.
**Do this instead:** Dispatch an Inngest event from the route handler; implement the work in an Inngest function under `src/lib/inngest/functions/`.

## Error Handling

**Strategy:** Each layer handles its own errors independently; API routes return structured JSON errors with HTTP status codes.

**Patterns:**
- Slack routes: verify signature first, return 403 on failure; return 200 immediately for async events then dispatch to Inngest.
- MCP route: Bearer token check returns 401; missing env var returns 500.
- Chat layer: MCP tool loading failures are caught and logged; chat continues without those tools.
- Inngest functions: Rely on Inngest's built-in retry logic (max 3 attempts per `backgroundJobs` schema).

## Cross-Cutting Concerns

**Logging:** `console.error` / `console.log` throughout. No structured logging library detected.
**Validation:** Zod schemas used extensively in chat tool definitions (`src/lib/chat/tools/schemas.ts`) and API route bodies.
**Authentication:** WorkOS AuthKit via `proxy.ts` middleware. Per-route auth for Slack (HMAC) and MCP (Bearer token).
**Token Tracking:** All `createChatResponse` calls record usage asynchronously via `recordTokenUsage()` in `src/lib/token-usage.ts`; stored in `tokenUsage` table scoped to workspace.

---

*Architecture analysis: 2026-08-04*
