# Codebase Structure

**Analysis Date:** 2026-08-04

## Directory Layout

```
runway/
├── src/
│   ├── app/                    # Next.js App Router: pages + API routes
│   │   ├── api/                # HTTP endpoints
│   │   │   ├── ai/send/        # Trigger AI task execution
│   │   │   ├── attachments/    # File upload/confirm (R2/S3)
│   │   │   ├── audience/       # Audience member CRUD + suggestions
│   │   │   ├── brand/          # Brand research + summary generation
│   │   │   ├── chat/           # AI chat endpoints (issue, planning, workspace)
│   │   │   ├── dashboard/      # Dashboard summary API
│   │   │   ├── inngest/        # Inngest webhook receiver
│   │   │   ├── knowledge/      # Knowledge base assets + sync
│   │   │   ├── mcp/runway/     # MCP server endpoint (Bearer token)
│   │   │   ├── runway/         # Gantt chart generation/share/embed
│   │   │   ├── skills/         # Skill CRUD, generate, import
│   │   │   ├── slack/          # Slack webhooks (events, commands, interactivity, options)
│   │   │   └── workspace/      # Workspace config + soul
│   │   ├── w/[slug]/           # Workspace shell (board, chat, knowledge, settings)
│   │   │   ├── chat/           # Workspace AI chat UI
│   │   │   ├── knowledge/      # Knowledge base UI
│   │   │   └── settings/       # Workspace settings (brand, audience, skills, soul, etc.)
│   │   ├── dashboard/          # User dashboard
│   │   ├── login/              # Auth pages
│   │   ├── runway/             # Runway triage board UI (agency ops)
│   │   ├── beta/[token]/       # Beta invite claim flow
│   │   ├── invite/[token]/     # Workspace invitation claim
│   │   └── waitlist/           # Waitlist signup
│   ├── components/             # Shared React components
│   │   ├── board/              # Kanban board + context + hooks
│   │   ├── issues/             # Issue card, detail, properties, context
│   │   ├── epics/              # Epic management components
│   │   ├── planning/           # AI planning UI components
│   │   ├── filters/            # Filter bar components
│   │   ├── list/               # List view components + hooks
│   │   ├── knowledge/          # Knowledge base browser components
│   │   ├── workspace/          # Workspace switcher, context provider
│   │   ├── command/            # Command palette
│   │   ├── layout/             # Shell layout, sidebar, nav
│   │   ├── providers/          # React context providers
│   │   ├── ai-elements/        # AI-specific UI elements
│   │   └── ui/                 # Primitive UI (shadcn/Radix), Lexical editor
│   ├── lib/                    # Server-side libraries
│   │   ├── actions/            # Next.js Server Actions (one file per domain)
│   │   ├── ai-search/          # AI-powered search utilities
│   │   ├── chat/               # AI chat factory + tools
│   │   │   └── tools/          # Tool factories: issue, planning, memory, skill, chat
│   │   ├── db/                 # Database clients + schemas
│   │   │   ├── index.ts        # Main DB client (Turso, TURSO_DATABASE_URL)
│   │   │   ├── schema.ts       # Main DB schema (workspaces, issues, users, ...)
│   │   │   ├── runway.ts       # Runway DB client (RUNWAY_DATABASE_URL)
│   │   │   └── runway-schema.ts # Runway DB schema (clients, projects, week_items, ...)
│   │   ├── email/              # Transactional email + templates
│   │   ├── hooks/              # Shared React hooks
│   │   ├── inngest/            # Inngest client + background job functions
│   │   │   └── functions/      # One file per Inngest function
│   │   ├── mcp/                # MCP client (workspace integrations) + MCP server (Runway)
│   │   ├── runway/             # Runway-specific logic (Gantt generation, sync)
│   │   │   └── gantt/          # Gantt chart rendering assets
│   │   ├── schemas/            # Shared Zod schemas
│   │   ├── slack/              # Slack bot: client, verify, bot logic, modals
│   │   ├── storage/            # R2/S3 storage abstraction
│   │   └── utils/              # Shared utility functions
│   └── skills/                 # Bundled AI skill files (filesystem)
│       └── internal/           # Internal skills: brand-guidelines-short, skill-creator
├── scripts/                    # CLI scripts (migrations, sync, seed, Gantt)
│   ├── runway-migrations/      # Runway DB migration helpers
│   └── runway-sheet-sync/      # Google Sheets sync scripts
├── drizzle/                    # Drizzle migration files (main DB)
├── drizzle-runway/             # Drizzle migration files (Runway DB)
├── skills/                     # External skill packages (aio-geo-optimizer, marketing, etc.)
├── tests/                      # Integration/smoke tests
│   ├── runway/                 # Runway-specific Playwright tests
│   └── fixtures/               # Test fixtures (Slack payloads)
├── cloudflare/                 # Cloudflare Worker (doc-converter)
│   └── doc-converter/          # Document conversion worker
├── public/                     # Static assets
├── docs/                       # Internal docs, plans, brain
├── proxy.ts                    # Next.js middleware (WorkOS auth)
├── next.config.ts              # Next.js config
├── drizzle.config.ts           # Drizzle config (main DB)
├── drizzle-runway.config.ts    # Drizzle config (Runway DB)
├── vitest.config.mts           # Unit test config
└── playwright.config.ts        # E2E test config
```

## Directory Purposes

**`src/app/api/`:**
- Purpose: All HTTP API endpoints. Each subdirectory = one route group.
- Contains: `route.ts` files exporting Next.js HTTP method handlers.
- Key files: `src/app/api/inngest/route.ts` (Inngest receiver), `src/app/api/mcp/runway/route.ts` (MCP server), `src/app/api/slack/events/route.ts` (Slack events).

**`src/lib/actions/`:**
- Purpose: Server Actions - typed server-side mutations called from client components.
- Contains: One `.ts` file per domain (e.g. `issues.ts`, `board.ts`, `brand.ts`, `workspace.ts`).
- Pattern: Functions exported with `"use server"` directive; called directly from client components.

**`src/lib/chat/`:**
- Purpose: The shared AI layer. All chat endpoints call `createChatResponse()` from here.
- Contains: `index.ts` (main factory), `tools/` (tool set factories), `skills.ts` (skill loader), `context-prompt.ts`.

**`src/lib/db/`:**
- Purpose: Database clients and schemas. Two separate Turso instances.
- Key files: `index.ts` (main DB), `runway.ts` (Runway DB), `schema.ts`, `runway-schema.ts`.

**`src/lib/inngest/functions/`:**
- Purpose: One file per durable background job. Registered in `src/app/api/inngest/route.ts`.
- Add new background jobs here, then register in the route.

**`src/lib/mcp/`:**
- Purpose: Two roles. (1) MCP client - loads tools from external MCP servers (e.g. Exa) per workspace. (2) MCP server - `runway-server.ts` exposes Runway data as MCP tools.

**`skills/`** (repo root):
- Purpose: External/packaged skill directories (aio-geo-optimizer, marketing, etc.), separate from bundled internal skills.
- These are filesystem-based skills distinct from DB-stored `workspaceSkills`.

**`scripts/`:**
- Purpose: One-off and recurring CLI operations: DB seeding, Runway data sync, sheet sync, Gantt generation, migration helpers.
- Not part of the web app runtime.

## Key File Locations

**Entry Points:**
- `src/app/layout.tsx`: Root Next.js layout.
- `proxy.ts`: Auth middleware (WorkOS), runs on every non-static request.

**Database:**
- `src/lib/db/index.ts`: Main DB client - import `db` from here.
- `src/lib/db/runway.ts`: Runway DB client - import `runwayDb` from here.
- `src/lib/db/schema.ts`: All main DB table definitions.
- `src/lib/db/runway-schema.ts`: All Runway DB table definitions.

**AI Layer:**
- `src/lib/chat/index.ts`: `createChatResponse()` - the central AI call factory.
- `src/lib/chat/tools/`: Tool set factories consumed by chat route handlers.

**Background Jobs:**
- `src/lib/inngest/functions/`: Inngest function implementations.
- `src/app/api/inngest/route.ts`: Registers all Inngest functions.

**Auth:**
- `proxy.ts`: Middleware; WorkOS AuthKit session enforcement.

**Config:**
- `next.config.ts`: Next.js config.
- `drizzle.config.ts`: Drizzle config for main DB.
- `drizzle-runway.config.ts`: Drizzle config for Runway DB.

## Naming Conventions

**Files:**
- API routes: `route.ts` inside a directory named for the path segment.
- Server actions: `kebab-case.ts` (e.g. `invite-codes.ts`, `workspace-chat.ts`).
- Components: `PascalCase.tsx` for components; `kebab-case.tsx` for pages (`page.tsx`, `layout.tsx`).
- Lib modules: `kebab-case.ts`.

**Directories:**
- Route groups: lowercase kebab-case matching URL segments.
- Component subdirectories: `_components/` for route-local components, `_hooks/` for route-local hooks.

## Where to Add New Code

**New API endpoint:**
- Create `src/app/api/<route-name>/route.ts` exporting `GET`/`POST` as needed.
- Register in `proxy.ts` unauthenticatedPaths only if it handles its own auth.

**New server action (DB mutation from UI):**
- Add to existing file in `src/lib/actions/` if it fits an existing domain, or create `src/lib/actions/<domain>.ts`.

**New background job:**
- Implement in `src/lib/inngest/functions/<job-name>.ts`.
- Export from `src/lib/inngest/functions/index.ts`.
- Register in `src/app/api/inngest/route.ts`.

**New chat tool (AI can call it):**
- Add to `src/lib/chat/tools/` (pick the right file by domain: `issue-tools.ts`, `planning-tools.ts`, `memory-tools.ts`, or create a new one).

**New page/UI:**
- Workspace-scoped: `src/app/w/[slug]/<route>/page.tsx` + `layout.tsx` if needed.
- Shared components: `src/components/<category>/`.

**New DB table (main product):**
- Add to `src/lib/db/schema.ts`, run `pnpm db:generate && pnpm db:migrate`.

**New DB table (Runway agency ops):**
- Add to `src/lib/db/runway-schema.ts`, run `pnpm runway:generate && pnpm runway:push`.

**New MCP server integration (external tool source for workspaces):**
- Add server definition to `src/lib/mcp/servers.ts`.
- Add UI toggle under `src/app/w/[slug]/settings/integrations/`.

## Special Directories

**`drizzle/`:**
- Purpose: Auto-generated migration files for the main Turso DB.
- Generated: Yes (`pnpm db:generate`).
- Committed: Yes.

**`drizzle-runway/`:**
- Purpose: Auto-generated migration files for the Runway Turso DB.
- Generated: Yes (`pnpm runway:generate`).
- Committed: Yes.

**`cloudflare/doc-converter/`:**
- Purpose: Standalone Cloudflare Worker for document conversion. Separate from the Next.js app.
- Generated: No.
- Committed: Yes.

**`.claude/skills/`:**
- Purpose: Claude Code slash-command skills (code-review, canary, preflight, etc.). Dev tooling only, not app runtime.
- Generated: No.

---

*Structure analysis: 2026-08-04*
