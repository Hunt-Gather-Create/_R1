---
updated_at: "2026-08-12T00:00:00Z"
last_mapped_commit: "435ebba5d6c22f986d28f3fb79c0f4258970e5ba"
---

# _R1 Intelligence: Architecture and Current State

**Date:** 2026-08-11
**Analyst:** GSD onboarding pass (OpEx sub-agent)

## Project Identity

- **Name in package.json:** auto-kanban
- **Canonical deployment:** `runway.startround1.com` (Runway board, password-gated per D-03)
- **Platform:** Next.js 15 App Router, TypeScript, deployed on Vercel
- **Primary branch:** `runway` (not main; main exists only as a legacy cleanup artifact)

## Two-Database Architecture

_R1 runs TWO separate Turso/SQLite databases:

1. **Main DB** (`src/lib/db/schema.ts`, `drizzle.config.ts`)
   - Tables: users, inviteCodes, inviteCodeClaims, brands, workspaces, knowledge (KB), AI chat history, attachments, skills
   - Auth via WorkOS (synced to users table)
   - Used by the broader R1 platform: chat, dashboard, workspace, settings

2. **Runway DB** (`src/lib/db/runway-schema.ts`, `drizzle-runway.config.ts`)
   - Tables: clients, projects, weekItems, sections, pipeline records, view preferences
   - Stores the project-management / agency operations data
   - Turso in production, local SQLite file (`runway-local.db`) in dev
   - The Runway bot (Slack), MCP server, and triage board all read/write here

Migration scripts live in `drizzle/` (main DB) and `drizzle-runway/` (Runway DB).

## Runway Data Model (key schema notes)

- **clients** -- slug-keyed, nicknames as JSON array, contract fields
- **projects** -- 4-level hierarchy: retainer wrapper L1 -> deliverable L1 (parentProjectId) -> section L2 -> task L4; engagementType enum (project | retainer | one-off) enforced at app layer only (no DB constraint); startDate/endDate derived from children and recomputed on write
- **weekItems** -- tasks with taskNo (sheet-sourced or auto-assigned), sectionId (no FK constraint per D-pattern), weekOf dating; pipeline records share this table
- **D-02 lock:** CASCADE_STATUSES never includes "canceled"; cascades only on completed/blocked/on-hold

## Entry Points

| Route | Purpose |
|-------|---------|
| `/runway` | Main triage/Gantt board (password-gated) |
| `/runway/auth` | Password auth endpoint |
| `/w/[slug]` | AI workspace per user |
| `/dashboard` | User dashboard |
| `/beta` | Beta access landing |
| `src/app/api/runway/*` | Runway REST API (gantt-embed, gantt-generate, gantt-share, version) |
| `src/app/api/chat/*` | AI SDK streaming chat |
| `src/app/api/mcp/runway` | MCP server for Runway (AI tools over Runway data) |
| `src/app/api/slack/*` | Slack bot integration |
| `src/app/api/inngest/*` | Inngest background job handler |

## Runway Business Logic Layer (`src/lib/runway/`)

96 files. Key modules:

- `operations-reads.ts` / `operations-writes.ts` -- main CRUD surface; reads return typed domain objects; writes are transactional with recompute
- `operations-writes-pipeline.ts` -- pipeline-specific mutations (week-item pipeline state)
- `operations-writes-cascade-drift.ts` -- drift detection; cascades status changes to children per D-02 rule
- `operations-writes-undo.ts` -- undo stack for reversible mutations
- `operations-writes-week.ts` / `operations-writes-week-recompute.ts` -- week-based planning writes and date recomputation
- `bot-context.ts` / `bot-context-sections.ts` / `bot-context-behaviors.ts` -- builds Slack bot context window from Runway DB state
- `flags.ts` / `flags-detectors.ts` -- feature flags + detector layer
- `runway-als.ts` -- AsyncLocalStorage context carrier (DB client + user) for per-request Runway access
- `clients-cache-als.ts` -- ALS-scoped client cache to avoid N+1 DB hits per request
- `retry.ts` -- retry wrapper for Turso transient errors

## Key External Integrations

| Integration | Package | Purpose |
|------------|---------|---------|
| Anthropic Claude | `@ai-sdk/anthropic`, `ai` | AI chat, workspace AI, Runway AI suggestions |
| Turso (libSQL) | `@libsql/client`, `drizzle-orm` | Both databases in production |
| WorkOS | `@workos-inc/authkit-nextjs` | SSO auth for main R1 platform |
| Slack | `@slack/web-api` | Runway bot: triage updates, weekly summaries |
| Inngest | `inngest` | Background job queue (long AI ops, email triggers) |
| MCP SDK | `@modelcontextprotocol/sdk`, `@ai-sdk/mcp` | Expose Runway as MCP server for AI agents |
| AWS S3 | `@aws-sdk/client-s3` | File attachment storage |
| Resend | `resend` | Transactional email |
| Smithery | `@smithery/api` | MCP registry / skill discovery |

## Auth Architecture

- **Runway deployment** (`runway.startround1.com`): password-only gate at `/runway/auth`. WorkOS middleware is in `proxy.ts` but WORKOS env vars intentionally unset (D-03, locked).
- **Main R1 platform**: WorkOS SSO via `@workos-inc/authkit-nextjs` iron-session cookie.
- **Iron-session** (`iron-session`): server-side encrypted session cookie used across both auth paths.

## Test Coverage

- Vitest is configured; test files co-located with source (`*.test.ts`)
- Runway lib has extensive unit tests: ~50+ test files in `src/lib/runway/`
- Playwright configured for E2E / visual QA (`playwright.config.ts`)
- Auth cookie, bot-context, operations (reads + writes + cascade), flags, fuzzy-match, gantt all have unit coverage

## Current Concerns (as of 2026-08-11)

1. **4-level hierarchy migration in progress** -- `engagementType` and parent project nesting added 2026-07-26; backfill (G2) not yet signed off; tolerant-read/strict-write posture active until then.
2. **No FK constraints for self-referencing + sectionId** -- enforced at application layer only; drift risk if write paths are bypassed (direct DB writes during incident, migrations).
3. **Runway DB separate from main DB** -- two connection pools, two migration tracks, two drizzle configs; keeping them in sync is a manual ops concern.
4. **feat/runway-schema-4level branches** -- active feature branches on origin suggest schema changes are ongoing; worktree-based work needed to avoid conflicts with shared Zone A checkout.
5. **MCP server over Runway** -- AI agents can read and mutate Runway data via MCP tools; the blast radius of a misfire or prompt injection includes production project/task records.
6. **Gantt embed / share routes** -- unauthenticated-by-design or lightly gated; review access posture before any public-facing expansion.
