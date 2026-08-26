# Decisions — Runway

> Architectural calls that are LOCKED. Immutable entries. Wrong decisions are not edited;
> they are superseded by a new entry that references the old one. Reading: scan this file
> before making any architectural / operational call to check what is already locked.
>
> Maintenance: when this file exceeds ~50 entries, archive the oldest cohort to
> `DECISIONS-archive.md` and leave a one-line pointer here.

---

## D-01 — Adopt the 9-layer planning structure for this project

Date: 2026-05-23
Decision: Runway adopts a 9-layer project structure (Layer 0 eager nav map; 8 lazy layers: VISION, DECISIONS, KNOWLEDGE, ROADMAP, TICKETS, PLANS, STATUS, SESSIONS).
Why: Cross-session design between Runway TP and a planning-architect session converged on the model after reviewing GSD / gstack / Superpowers frameworks. Lazy-load keeps Layer 0 (CLAUDE.md) under 2k tokens; the rest loads on trigger. Avoids the prior pattern where session context was scattered across CLAUDE.md, MEMORY.md, docs/plans/, and private memory with no clear contract.
Locks: All project planning artifacts must fit into one of the 9 layers. Layer 0 stays under 2k tokens, contains zero embedded content from other layers (pointers only). DECISIONS entries are immutable. TICKETS have ONE primary home (milestone XOR continuous-track label).
Refs: `VISION.md`, this file, private memory `project_planning_structure_9layer.md`.

## D-02 — CASCADE_STATUSES excludes "canceled"

Date: 2026-05-22
Decision: L1 status flips of `completed`, `blocked`, or `on-hold` cascade to child L2 statuses. `canceled` does NOT cascade.
Why: When an L1 is canceled, child L2 rows may be in valid intermediate states the operator wants to preserve. Auto-flipping them to `canceled` would erase context (which child tasks were already done, which were in progress, etc.). Operator-locked after the L1-canceled-status investigation; recco B in `docs/plans/l1-canceled-status-fix.md §3` codified the rule. Inline comment at `src/lib/runway/operations-utils.ts:24-35` enforces it.
Locks: Do not add `canceled` to `CASCADE_STATUSES`. Any future status that should cascade must be added explicitly with operator approval.
Refs: PR #104, `src/lib/runway/operations-utils.ts:24-35`, `.claude/MEMORY.md` Patterns.

## D-03 — /runway production = password-gate-only, by design

Date: 2026-05-23
Decision: The `/runway` deployment at `runway.startround1.com` is gated by a shared password at `/runway/auth` and NO additional auth layer. WorkOS middleware in `proxy.ts` is armed but no-ops because `WORKOS_*` env vars are intentionally unset on this Vercel project.
Why: Runway viewers (account managers Jill, Kathy, Allison; the operator) need zero-friction access — no SSO, no per-user login. The password gate is a deadbolt to keep former employees / random visitors out. WorkOS stays armed in code because the broader R1 platform (chat, workspaces, settings, knowledge) WILL need it when more of R1 ships to this deployment.
Locks: Do not modify `proxy.ts` to bypass `/runway` or add it to `unauthenticatedPaths`. Do not propose configuring `WORKOS_*` env vars on the runway.startround1.com Vercel project to "enable stacked gates." The middleware code stays as-is.
Refs: GH issue #61 (closed as not-a-decision), private memory `project_runway_auth_stacked_gates.md`, PR #103.

## D-04 — Planning files + visual-qa ship upstream on the runway branch

Date: 2026-05-23
Decision: Planning artifacts (VISION, DECISIONS, ROADMAP, STATUS, `.claude/sessions/`) and visual-qa infrastructure (Playwright + `runway-visual-qa` skill + tests) all live on the `runway` branch. They will land on `upstream/runway` (Hunt-Gather-Create) via feature-branch PRs in the normal flow.
Why: Earlier the visual-qa harness was parked on a side `main` branch to "hide from Tim." On 2026-05-23 the operator reversed this: markdown files have zero build cost, and Playwright as a devDep is acceptable carry-along. The `main` side branch becomes obsolete after this lands; it gets deleted in a follow-up cleanup (no PR — just `git branch -D main` + `git push origin --delete main`).
Locks: Do not create side branches for "local-only" project artifacts going forward. If something genuinely cannot ship upstream (e.g., secret keys, operator-private files), it goes in `~/.claude/projects/<slug>/memory/` (operator's private memory dir), not a side branch.
Refs: This PR, private memory `project_runway_visual_qa_infra.md` (historical), `.gitignore`.

## D-05 — AI defaults to Claude Haiku across all Runway features

Date: pre-2026-05-23 (formalized 2026-05-23)
Decision: Every AI feature in Runway (Slack bot interpretation, chat, background tasks) uses `claude-haiku-4-5-20251001` as the default model. Sonnet (`claude-sonnet-4-6`) is only used when the operator explicitly requests it.
Why: 12× cost gap (Haiku $0.25/$1.25 vs Sonnet $3.00/$15.00 per 1M tokens). Haiku is sufficient for the structured-output tool-use patterns Runway needs (parse natural language → call MCP/bot tool). Operator-locked to keep prod LLM costs predictable. Prompt caching is mandatory; tool usage caps via `maxUses` prevent runaway loops; token usage tracked per-workspace via `tokenUsage` table.
Locks: New AI features default to Haiku. Switching a feature to Sonnet requires operator approval and a tracked cost-monitoring plan.
Scope note (2026-08-13): D-05 governs the shipped product's runtime inference model only (cost control on prod Slack bot / chat / background tasks). It does NOT govern which model a development seat (Runway-TP, CC) runs on. Seat model routing is a separate operating mandate: base Opus orchestrates, Sonnet subagents do the building work under ~200k each, never Haiku for judgment. See `docs/planning/whats-changed-2026-08-13.md`.
Refs: `CLAUDE.md` (working agreements), `src/lib/chat/index.ts`, `tokenUsage` table.

## D-06 — All upstream PRs target `runway`, never `main`

Date: pre-2026-05-23 (formalized 2026-05-23)
Decision: Every PR from `jasonburks23/_R1` to `Hunt-Gather-Create/_R1` targets the `runway` branch. PRs targeting `Hunt-Gather-Create:main` are not allowed.
Why: `Hunt-Gather-Create/main` is Tim's kanban-app integration branch (unrelated to Runway). Runway production ships from `Hunt-Gather-Create/runway`. Mixing destinations causes scope confusion and accidental merges of Runway code into Tim's kanban codebase.
Locks: `gh pr create` must always pass `--base runway`. If a PR is accidentally opened against `main`, close it and re-open with `--base runway`.
Refs: `CLAUDE.md` Pull Request Rules section.

## D-07 — Cross-repo issue auto-close via `Fixes jasonburks23/_R1#<n>`

Date: pre-2026-05-23 (formalized 2026-05-23)
Decision: When an upstream PR closes a tracked issue on `jasonburks23/_R1`, the PR body includes `Fixes jasonburks23/_R1#<issue-number>`. Branch names use the convention `fix/<issue>-...` or `feat/<issue>-...` to encode the issue number for traceability.
Why: GitHub's auto-close mechanism normally fires on same-repo references. The cross-repo `Fixes jasonburks23/_R1#N` line is recognized by GitHub and closes the linked issue on merge, keeping the issue tracker clean without manual follow-up.
Locks: Not every PR has a linked issue (that's fine). When one exists, the `Fixes` line is required. PRs that close multiple issues use `Fixes #A, #B, #C` syntax.
Refs: `CLAUDE.md` Pull Request Rules section, recent PR bodies (#103, #104).

## D-08 — Runway uses a separate Turso DB, not the R1 main database

Date: pre-2026-05-23 (formalized 2026-05-23)
Decision: Runway reads/writes a dedicated Turso database via `RUNWAY_DATABASE_URL`. Schema lives in `src/lib/db/runway-schema.ts`; client factory in `src/lib/db/runway.ts`. The kanban-app database (`DATABASE_URL`) is untouched by any Runway code path.
Why: Runway is Phase 0 of the agency PM tool and has different scaling, backup, and access patterns from the R1 kanban app. Running on a separate DB lets Runway iterate on schema without coupling to Tim's kanban migrations. On Jason's free Turso tier currently; will migrate to a dedicated R1 instance later.
Locks: No Runway code imports from `@/lib/db/` directly. All Runway DB access goes through `src/lib/runway/operations*.ts`. drizzle-kit + tsx need `RUNWAY_DATABASE_URL` exported from `.env.local` because they don't auto-load it.
Refs: `docs/runway.md` Database section, `drizzle-runway.config.ts`.

## D-09 — Runway MCP server is the central access layer for AI consumers

Date: pre-2026-05-23 (formalized 2026-05-23)
Decision: `/api/mcp/runway` exposes Runway operations as MCP tools, gated by bearer-token auth. Slack bot, Claude Code sessions, and Open Brain all reach Runway data through this same MCP server.
Why: One access layer = one auth boundary, one audit point, one cost-tracking point. Bypassing MCP to call operations directly fragments observability and breaks the idempotency / undo guarantees the layer provides.
Locks: New AI consumers integrate via MCP, not by direct DB or operations imports. Bearer token rotation happens via env var; no token is committed to git.
Refs: `src/app/api/mcp/runway/route.ts`, `docs/mcp-runway-tools.md`.

## D-10 — All Runway prod writes go through the data-integrity-tp pipeline

Date: pre-2026-05-23 (formalized 2026-05-23)
Decision: Direct prod writes from CCs, ad-hoc scripts, or operator one-offs are not allowed. Data writes flow through the data-integrity-tp skill (DI-TP), which runs dry-run + holdout QA + operator approval before APPLY.
Why: Multiple incidents (2026-04-23 through 2026-05-13) where untriaged writes corrupted prod state. The DI-TP pipeline catches: cascade collisions, validator gaps, enum-mismatches, ordering bugs (forward vs backward L2 date moves), idempotency poisoning. Holdout QA (5 panels: Completeness, Consistency, Intent, Source, Cascade) catches gaps that spec-derived QA misses because it's circular.
Locks: CCs do not run prod-write scripts. Operator does not run one-off mutations. Both route through DI-TP. The DI-TP signal-file funnel (operator ↔ evaluator-tp ↔ DI-TP) is the only path.
Refs: `.claude/skills/data-integrity-tp/SKILL.md`, `.claude/skills/data-evaluator-tp/SKILL.md`, private memory `feedback_no_migrations_by_cc.md`.

## D-11 — Workspaces (renamed from "boards") are the top-level container

Date: pre-2026-05-23
Decision: The R1 kanban-app schema uses `workspaces` as the top-level scope. Every server action enforces `requireWorkspaceAccess(workspaceId, minimumRole?)`. Role hierarchy: `viewer(0) < member(1) < admin(2)`.
Why: Earlier "boards" was the top-level scope but the term collided with kanban "boards" (lanes within a workspace). Rename clarified the mental model and gave a clean scope for auth + caching. Per-request cached via `React.cache()` so repeated calls within a render don't re-query.
Locks: All server action mutations call `requireWorkspaceAccess`. New top-level resources go under workspaces. Adding a new role tier requires updating the hierarchy + every caller.
Refs: `src/lib/auth/workspace.ts`, `src/lib/db/schema.ts`.

## D-12 — Gantt logic split: pure logic in `src/lib`, DB-coupled in `scripts/lib`

Date: 2026-04-30 (formalized 2026-05-23)
Decision: Pure Gantt rendering / layout / axis logic lives in `src/lib/runway/gantt/`. DB-coupled wrappers (fetching the rundown, async client expansion) live in `scripts/lib/gantt/`. Shim re-exports in `scripts/lib/gantt/` keep CLI import paths unchanged.
Why: The Gantt was originally built in a single CLI script with mixed concerns. Splitting let the Next.js RSC slot pattern (D-13) reuse the pure logic without dragging fs / DB code into the App Router. Shim re-exports avoided breaking the CLI in the move.
Locks: New Gantt features go in `src/lib/runway/gantt/` if they're pure. Anything that touches DB or fs goes in `scripts/lib/gantt/`. The shim files stay until the CLI is retired.
Refs: `src/lib/runway/gantt/`, `scripts/lib/gantt/`.

## D-13 — Gantt embed uses RSC slot pattern (no `react-dom/server` chain)

Date: 2026-05-04 (formalized 2026-05-23)
Decision: The dark Gantt embed inside the `/runway` page renders via an RSC slot: `RundownContentRSC` accepts `ganttContent: ReactNode` from a server component and passes it as a prop into the `AccountSection` client component.
Why: Next.js 16 + Turbopack ban `react-dom/server` imports from ANY App Router entrypoint — the `react-server` export condition throws in every subpath including `./server.node`. The original Gantt code used `renderToString` which broke under Turbopack. The slot pattern keeps server-only rendering on the server and ships only the resulting JSX to the client.
Locks: Do not import from `react-dom/server` anywhere reachable from `app/`. Server-only rendering happens via RSC slots passed as `ReactNode` props.
Refs: `src/lib/runway/gantt/extract-rundown.ts`, `src/lib/runway/gantt/gantt-section-dark.tsx`, `src/app/runway/components/rundown-content-rsc.tsx`.

## D-14 — `/runway` filters projects by active-status by default

Date: 2026-05-04 (formalized 2026-05-23)
Decision: The `/runway` dashboard hides projects in terminal status (`completed`, `canceled`) at the L1 level. Implemented via `filterActiveRundown` in `src/lib/runway/gantt/filter-active.ts`.
Why: The dashboard is a "what's in flight" view. Showing finished and canceled work clutters the daily standup signal. The filter applies to Account Tier (By Account tab) AND the Gantt Charts tab for parity.
Locks: The rule is `L1 hidden if status ∈ {completed, canceled}`. Wrapper sections follow the same predicate via `isWrapperHidden`. Adding new "terminal" statuses requires updating both `filter-active.ts` and `D-02` cascade alignment.
Refs: `src/lib/runway/gantt/filter-active.ts`, `src/app/runway/page.tsx`.

## D-15 — Subtasks are one level deep (no nested subtasks)

Date: pre-2026-05-23
Decision: A Project can have Tasks. Tasks cannot have sub-tasks. The hierarchy is exactly Client → Project → Task.
Why: Two-level depth is the minimum that supports real PM work without inviting the unbounded-tree problem (where everything becomes a subtask of something and the UI / queries get hairy). Operator-locked early in Runway design. Subtasks move with their parent on column change (handled in `updateIssue`).
Locks: No `task.parent_task_id`. The L3 hierarchy expansion (issue #39) is design-pending and not a green-light to add subtask nesting; if L3 ships it adds a NEW level above Client (workspace-style), not below Task.
Refs: `src/lib/runway/operations-writes.ts`, `.claude/MEMORY.md` Patterns.

## D-16 — End users say "Project" / "Task"; identifiers stay "L1" / "L2"

Date: pre-2026-05-23
Decision: All user-facing text (chart headers, kind tags, ARIA labels, badge text, Slack modal labels, bot prompts) uses `Project` / `Task`. Code-level identifiers (function names, variable names, file names, types) keep `L1` / `L2`.
Why: `L1`/`L2` is concise jargon that's fine in source code but alien to non-technical operators. The operator + account managers think in `Project` / `Task` and would not parse a UI that said "L1 Status." Two vocabularies is acceptable as long as the boundary is consistent (anything that renders as text → use friendly terms).
Locks: Any new user-facing string uses `Project` / `Task`. Any new internal identifier can use `L1` / `L2`. Mixing within a single artifact (e.g., a Slack modal with "L1" in a label) is a bug.
Refs: `.claude/MEMORY.md` Gotchas, modal helper files, Slack bot prompt files.

## D-17 — Chat messages stored in R2, not the database

Date: pre-2026-05-23
Decision: Chat message bodies (R1 platform feature, not Runway-specific) are persisted as JSON blobs in R2 object storage. The database tracks message metadata + R2 keys, not the message content itself.
Why: Message bodies grow unbounded and have low per-row query needs. R2 storage is cheaper than database storage for large blobs, and offline backups + analytical scans are easier against R2.
Locks: Do not migrate message bodies into the database. New chat-related fields that are queryable (timestamps, user IDs, read receipts) go in the DB; the body stays in R2.
Refs: `src/lib/chat/storage.ts`.

## D-18 — File uploads use two-step presigned URL flow

Date: pre-2026-05-23
Decision: File uploads happen in two steps: (1) client requests a presigned URL from `/api/attachments/upload` and uploads directly to R2, (2) client confirms via `/api/attachments/confirm` which records the attachment row in the DB.
Why: Uploading through the Next.js API route would hit edge-function size limits + double the bytes (client → Next → R2). Presigned URL skips Next entirely for the bytes. The confirm step records the canonical attachment row only after upload succeeds, preventing orphan rows.
Locks: Attachment uploads do not stream through the Next.js server. Direct-to-R2 only.
Refs: `src/app/api/attachments/upload/route.ts`, `src/app/api/attachments/confirm/route.ts`.

## D-19 — AI skills are lazy-loaded (names in system prompt, content via `load_skill`)

Date: pre-2026-05-23
Decision: AI features (bot, chat, MCP server) advertise available skills by name + one-line description in the system prompt. The full skill content is fetched on-demand via the `load_skill` tool when the model decides it needs it.
Why: Stuffing all skill content into every prompt would balloon the system prompt and cost. Lazy-load mirrors how Claude Code itself manages skills, and lets the model pick the right tool with minimal upfront context.
Locks: Skill content lives in `.claude/skills/<skill>/SKILL.md`. The system prompt advertises name + description only. `load_skill` is the single fetch path.
Refs: `src/lib/chat/index.ts`, `.claude/skills/`.

## D-20 — Gantt share infrastructure: HMAC-signed URLs, R2-backed, 7-day TTL

Date: pre-2026-05-23
Decision: `generateGanttShare()` in `src/lib/runway/gantt/server.ts` produces signed URLs at `/api/runway/gantt-share/<token>`. Tokens are HMAC-SHA256 over a canonical JSON payload; share artifacts are stored at `gantt-share/{nonce}/render.html` in R2 with a 7-day TTL. Requires `RUNWAY_SHARE_SECRET` in env (generated via `openssl rand -hex 32`).
Why: Share links need to be tamper-proof (HMAC) and ephemeral (TTL) so they expire from external surfaces. Storing the rendered HTML in R2 (not the DB) keeps the share endpoint cheap and the DB lean.
Locks: Share URLs go through HMAC verification on every request. `RUNWAY_SHARE_SECRET` is rotated periodically. Origin defaults to `NEXT_PUBLIC_APP_URL` or `https://runway.startround1.com`.
Refs: `src/lib/runway/gantt/server.ts`, `src/app/api/runway/gantt-share/[token]/route.ts`.

---

## Format reference

Use this format for any new entry:

```
## D-NN — <title>

Date: YYYY-MM-DD
Decision: <one sentence>
Why: <one paragraph — alternatives considered, trade-off chosen>
Locks: <what this decision forbids going forward>
Refs: <issue #, PR #, file:line, related D-MM>
```

Entries are immutable. Wrong decisions get superseded by a new entry that references the old one (the old entry stays as historical record).
