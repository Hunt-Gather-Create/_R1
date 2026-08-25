# External Integrations

**Analysis Date:** 2026-08-04

## APIs & External Services

**AI / LLM:**
- Anthropic Claude - LLM inference via Vercel AI SDK
  - SDK/Client: `@ai-sdk/anthropic` (in `src/ai.ts`)
  - Auth: `ANTHROPIC_API_KEY` (implied)

**MCP (Model Context Protocol):**
- Smithery Registry - MCP tool/server discovery
  - SDK/Client: `@smithery/api`, `@modelcontextprotocol/sdk`
  - MCP client code: `src/lib/mcp/`

**Slack:**
- Slack Bot - Commands, interactivity, events, modals, proactive messages
  - SDK/Client: `@slack/web-api`
  - Integration code: `src/lib/slack/`, API routes at `src/app/api/slack/`
  - Auth: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` (implied by `src/lib/slack/verify.ts`)

**Email:**
- Resend - Transactional email delivery
  - SDK/Client: `resend`
  - Templates: `src/email/` (React Email components)
  - Auth: `RESEND_API_KEY` (implied)

**Background Jobs:**
- Inngest - Durable event-driven job queue
  - SDK/Client: `inngest`
  - Functions: `src/lib/inngest/functions/`
  - Dev endpoint: local Inngest CLI on separate port
  - Auth: `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` (implied)

**Document Processing:**
- Cloudflare Browser Rendering - Headless browser for PDF/document conversion
  - Client code: `src/lib/cloudflare-browser.ts`
  - Auth: Cloudflare credentials (env vars, exact names in `src/lib/cloudflare-browser.ts`)

## Data Storage

**Databases:**
- Turso (LibSQL cloud, SQLite dialect) - Primary production database
  - Connection: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`
  - Client: Drizzle ORM + `@libsql/client`
  - Schema: `src/lib/db/schema.ts`
  - Migrations: `drizzle/` directory

- Turso (second database instance) - Runway-specific data
  - Connection: `RUNWAY_DATABASE_URL`, `RUNWAY_AUTH_TOKEN`
  - Client: Drizzle ORM + `@libsql/client`
  - Schema: `src/lib/db/runway-schema.ts`
  - Migrations: `drizzle-runway/` directory
  - Separate config: `drizzle-runway.config.ts`

- SQLite (local file) - Local development fallback for both databases
  - Files: `local.db`, `runway-local.db`
  - Activated when Turso env vars are absent

**File Storage:**
- AWS S3 - File/asset storage
  - SDK: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`
  - Code: `src/lib/storage/`
  - Auth: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, bucket name (implied)

**Caching:**
- TanStack Query client-side cache - In-process; config at `src/lib/query-client.ts`

## Authentication & Identity

**Auth Provider:**
- WorkOS AuthKit - Authentication and session management
  - SDK: `@workos-inc/authkit-nextjs`
  - Implementation: `src/lib/auth.ts`
  - Callback route: `src/app/callback/`
  - Auth: `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_REDIRECT_URI` (implied)
- iron-session - Encrypted cookie-based session layer on top of WorkOS

## Monitoring & Observability

**Error Tracking:**
- Not detected (no Sentry, Datadog, or similar SDK in `package.json`)

**Logs:**
- Console logging; Inngest provides job execution logs via its dashboard

## CI/CD & Deployment

**Hosting:**
- Vercel - Primary hosting (`.vercel/` artifacts referenced in `eslint.config.mjs`)
- Cloudflare - Browser rendering worker in `cloudflare/` directory

**CI Pipeline:**
- Not detected in this snapshot (no `.github/workflows/` present)

**Smoke Testing:**
- Playwright against `https://runway.startround1.com`
- Run via `pnpm runway:smoke`
- Auth state stored in `playwright/.auth/runway.json`

## Environment Configuration

**Required env vars (confirmed by config files):**
- `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` - Main database
- `RUNWAY_DATABASE_URL` + `RUNWAY_AUTH_TOKEN` - Runway database
- `PLAYWRIGHT_RUNWAY_PASSWORD` - Smoke test login
- `RUNWAY_SMOKE_BASE_URL` - Smoke test base URL (defaults to `https://runway.startround1.com`)

**Secrets location:**
- `.env.local` (local dev, not committed)
- Vercel environment variables dashboard (production)

## Webhooks & Callbacks

**Incoming:**
- `/api/slack/commands` - Slash command handler
- `/api/slack/interactivity` - Block Kit interactivity (buttons, modals)
- `/api/slack/options` - Dynamic select option loading
- `/api/slack/events` - Slack Events API (mentions, reactions, etc.)
- Inngest webhook endpoint (standard Next.js Inngest route, likely `/api/inngest`)

**Outgoing:**
- Slack Web API calls (bot messages, modal opens, proactive messages via `src/lib/slack/`)
- Resend transactional emails
- Anthropic API (streaming AI responses)

---

*Integration audit: 2026-08-04*
