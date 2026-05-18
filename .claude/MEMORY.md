# Project Memory

Shared learnings and context that persist across sessions for all contributors.

## Scripts

- `scripts/worktree <name>` - Create a worktree at `.worktrees/<name>` with branch `feature/<name>`, install deps, run migrations, launch Claude
- `scripts/worktree-clean` - Dry-run check for worktrees with branches merged into main; use `--force` to remove them

## Patterns

- Auth pattern: all server action mutations use `requireWorkspaceAccess(workspaceId, minimumRole?)` — cached per-request via React.cache()
- Issue status change auto-moves issue to corresponding column (handled in `updateIssue`)
- Subtasks are 1-level only (no nested subtasks), and subtasks move with their parent on column change
- Batch query optimization throughout — uses `inArray()` + Maps for O(1) lookups to prevent N+1
- Chat messages stored in R2 (JSON), not in the database
- Two-step file upload: presigned URL from `/api/attachments/upload`, then confirm via `/api/attachments/confirm`
- AI skills are lazy-loaded: listed by name/description in system prompt, full content fetched on-demand via `load_skill` tool
- L1 status enum has 7 values incl. `canceled` (operations-utils.ts:1031); compat matrix locks `canceled × canceled` as the only valid pair (operations-utils.ts:1130); `CASCADE_STATUSES` omits `canceled` — L1 cancel does NOT auto-flip child L2s (operator-locked, operations-utils.ts:36). `updateProjectStatus` whitelists `newStatus` against the enum + runs compat check against the project's current category.

## Gotchas

- Turbopack requires `.tsx` extension for any file containing JSX — `.ts` files with JSX fail with cryptic "Expected '>', got 'src'" errors
- `proxy.ts` is the WorkOS auth middleware — add unauthenticated API paths there, not in next.config
- Runway scripts need env vars exported from `.env.local` (drizzle-kit and tsx don't auto-load it)
- MCP SDK: use `WebStandardStreamableHTTPServerTransport` in Next.js routes, not the Node.js adapter
- Slack input-block elements (radio_buttons, checkboxes, plain_text_input inside an `input` block) cache their `initial_option` / `initial_options` / `initial_value` from the FIRST render of a given `block_id` and silently ignore subsequent `views.update` payloads that try to change the initial state. Workaround: gate the block on the disambiguation phase so it appears for the FIRST TIME after the user picks (Bug X1 fix at task.ts `date_type_block`); or rotate the `block_id` to force a fresh render. See `docs/plans/slack-modal-bug-x2-retainer-edit-fix.md` for the lead hypothesis on the open Bug X2 retainer-toggle case.
- Nested `overflow-y-auto` containers inside the page scroll trigger Chrome's scroll-anchoring on macOS — the section header outside the scrollport appears "pinned" while cards flow past as the inner scrollport drains momentum. Avoid `max-h-[Xvh] overflow-y-auto` wrappers around card grids on the runway dashboard; let the page scroll as one container. (Lesson learned 2026-05-07 from `today-section.tsx` + `day-column.tsx` cleanup.)
- End users say "Project" / "Task" — never "L1" / "L2". Internal helper / function / variable / file names can keep L1/L2 (those are JS identifiers). Anything that renders to user-facing text (chart headers, kind tags, ARIA labels, badge text) must use Project / Task.

## Decisions

- Workspaces (renamed from "boards") are the top-level container — everything is workspace-scoped
- Role hierarchy: viewer(0) < member(1) < admin(2) — enforced in `requireWorkspaceAccess`
- AI defaults to Haiku everywhere with prompt caching — Sonnet only on explicit user request
- Token usage tracked per-workspace for cost monitoring (tokenUsage table)
- Knowledge base uses wiki-link graph between documents (knowledgeDocumentLinks table)
- Brand guidelines stored as JSON in brands table, extracted via Inngest background job
- Runway uses separate Turso DB (`RUNWAY_DATABASE_URL`) on Jason's free tier — will migrate to R1 instance later
- Runway MCP server at `/api/mcp/runway` — bearer token auth, central access layer for Slack bot + Claude Code + Open Brain
- Gantt pure logic lives in `src/lib/runway/gantt/`; async DB-coupled wrappers stay in `scripts/lib/gantt/` (shim re-exports keep CLI import paths unchanged)
- Gantt theme prop drilled (not contexted): `theme` flows GanttTemplate → GanttSection → SectionLegend/RowBlock; default is `"light-internal"`
- Per-section legend lives inside `GanttSection` above `DataIntegrityPanel` across all three themes; the top-level `<Legend />` was removed from rundown hero + triage header (Phase B, 2026-04-30)
- Logo asset at `src/lib/runway/gantt/assets/CIV_TOP_LEFT.png` (32KB JPEG, .png extension); loaded once at module init in `themes.ts` and cached as base64 data URI
- CLI `--theme light-internal|light-branded` flag supported; `--theme dark-account-view` rejected at CLI (RSC-only); `-branded` suffix added to output filename for branded theme
- Gantt share infrastructure — `generateGanttShare()` in `src/lib/runway/gantt/server.ts` produces signed URLs at `/api/runway/gantt-share/<token>`; HMAC-SHA256 over canonical JSON payload, 7-day TTL, R2 storage at `gantt-share/{nonce}/render.html`. Origin defaults to `NEXT_PUBLIC_APP_URL` or `https://runway.startround1.com`. Requires `RUNWAY_SHARE_SECRET` in env (generate: `openssl rand -hex 32`).
- Track 2 Gantt embed uses RSC slot pattern: `extractClientRundown` in `extract-rundown.ts` (no react-dom/server chain), `GanttSectionDark` in `gantt-section-dark.tsx` (no themes.ts fs chain), `RundownContentRSC` renders JSX passed as `ganttContent: ReactNode` to AccountSection (client component). Next.js 16 Turbopack bans `react-dom/server` from ALL App Router entrypoints — the `react-server` export condition in react-dom's package.json throws in every subpath including `./server.node`.
- Daily axis ticks emitted by `computeAxis` post-2026-04-30: Mon-Fri columns, Mondays get "M/D" label, Tue-Fri get abbreviated letter (T/W/Th/F). Light-internal CLI baseline rebaselined: new hashes in `docs/tmp/account-view-gantt-preplan.md` §"Working baseline post-daily-ticks".
- Track 3 (2026-05-04) added a 4th tab "Gantt Charts" between By Account and Pipeline, restored By Account to info-card layout (no embedded Gantt), and applied an active-status filter via `src/lib/runway/gantt/filter-active.ts` (`filterActiveRundown`, `isReadyToClose`, `isL1Hidden`, `isWrapperHidden`); operator-locked rule: hide L1 only when status ∈ {completed, canceled}; FlagsPanel hidden on accounts AND gantt-charts.
- Track 3 Wave 5 "Ready to close?" chip — page.tsx precomputes `Set<string>` of L1 ids per account via `computeReadyToCloseIds(filtered.sections)`, attached as `account.readyToCloseIds` AND threaded as `RundownContentRSC` prop. Surfaces in BOTH By Account info-card (light amber chip in `ProjectCardBody`) AND Gantt Charts dark embed (dark amber chip in section `<summary>`). Wrapper sections never receive the chip (only L1 entities do).
- Track 4 By Account visual redesign (2026-05-05) introduced `src/app/runway/components/account-tier/` (CollapsibleSection + L2MiniCard + AccountTier); replaces the legacy ProjectCard render path in account-section.tsx. Three-level swimlane (Client > Wrapper > L1 > L2-cards) with native `<details>` collapse, default open. page.tsx threads both `rundown: ClientRundownData | null` (for By Account tier) AND `ganttContent: ReactNode` (for Gantt Charts tab) per account; both tabs filter via `filterActiveRundown` for parity. Theme prop drilled (light for By Account, dark inherited inside the Gantt Charts dark embed). Wave 4.4 added scoped `gantt-charts-details` chevron CSS in `rundown-content-rsc.tsx`, mirroring the `account-tier-details` pattern from `CollapsibleSection.tsx` (Wave 4.1) — both use `[open]` attribute selector for chevron rotation, zero React state for collapse. Collapse state does NOT persist across tab switches (operator-locked; persistence deferred).
