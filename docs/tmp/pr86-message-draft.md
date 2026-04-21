# PR #86 Message Draft

**Target branch:** `upstream/runway`
**Head branch:** `feature/runway-pr86-base`
**Status:** Draft — fill in Chunk 3 + Chunk 5 specifics before opening.

---

## Title (under 70 chars)

`feat(runway): v4 convention — schema, query layer, bot drill-downs, UI, data realigns`

## Body

### Summary

Ships the v4 Runway convention end-to-end: schema additions for retainer/dependency tracking, query layer that respects status/date/stub filters, bot drill-downs with resource-inclusive matching, UI refinements for plate clarity, and v4 data realignment applied to 7 production client records (Bonterra, Convergix, Soundly, LPPC, TAP, HDL, Asprey). Builds toward the "what's on my plate" mental model that actually reflects real active work.

### Why

The Runway PM tool's data and query layers were drifting: completed items leaked into stale flags, `getPersonWorkload` surfaced L1s for anyone listed in resources (noisy), team rosters were stored inconsistently across clients (primary-helper-only vs. full team), and there was no first-class way to represent retainer contracts, sequential handoffs, or dependencies between week items. PR #86 locks the v4 convention and updates code + prod data to match, so the bot + board render the agency's actual workflow instead of a stale approximation.

### Scope — 5 chunks + data work

**Chunk 4 — Schema additions** (9 new columns, 2 backfill scripts)
- `projects`: `start_date`, `end_date`, `contract_start`, `contract_end`, `engagement_type`
- `week_items`: `start_date`, `end_date`, `blocked_by`
- `updates`: `triggered_by_update_id`
- `recomputeProjectDates` helper — derives project start/end from children on L2 write
- Backfill: 63 week_items + 23 projects populated from existing data

**Chunk 1 — Query layer foundation**
- `getPersonWorkload` rewritten to v4 `PersonWorkload` contract (ownedProjects by L1 status, weekItems in date buckets: overdue/thisWeek/nextWeek/later, flags for contractExpired + retainerRenewalDue)
- L1 match only on `owner` (not resources); stub filter (awaiting-client L1s hidden from active buckets)
- Status filters on `getStaleWeekItems`, `detectStaleItems`, `detectResourceConflicts`, `detectBottlenecks`
- America/Chicago TZ for "today" boundary

**Chunk 2 — Bot tool / response layer**
- `parseResources` parser: comma = concurrent, `->` = sequential handoff; normalizes unicode arrows
- `get_week_items` person filter (unified owner OR resources match)
- New tools: `get_week_items_by_project`, `get_project_status` (structured drill-down)
- Cascade on all L2 categories when L1 flips terminal (was deadline-only)
- `triggered_by_update_id` propagates through cascade audit rows
- Bot prompt: v4 convention summary + smart plate framing (L2s first, owned L1s as rollup, category-derived tone)

**Chunk 3 — UI board**
- L2 owner inheritance on create (auto-populates from parent L1.owner unless caller supplies one)
- Past-end L2 red-section inline note ("status unchanged past end_date — needs review")
- Retainer renewal soft pill (30-day window before contract_end)
- Contract-expired soft pill (clients.contract_status=expired AND owned L1 active)
- In Flight toggle on Week Of (default ON, persisted in new `view_preferences` singleton table)
- blocked_by visual cue on L2 cards with ref resolution; cross-week blockers degrade silently
- Unified Project View — `buildUnifiedAccounts` pivots L2s under parent L1s from the same data fetch as Week Of (no duplicate plumbing)
- Graceful fallback when view_preferences table absent (pre-push state)

**Chunk 5 — Notifications, polish, PR prep**
- Past-end L2 detector (new flag on flags rail)
- Batch-update skill audit
- `PROJECT_FIELDS` whitelist extended (engagement_type, contract_start, contract_end)
- `bucketWeekItem` adds completed-filter to forward buckets
- `recomputeProjectDates` moved inside write transactions
- Drizzle snapshot/SQL drift reconciled
- Minor polish from Wave 1/2 integration notes

**Data — v4 realignment applied to prod Turso**
- Bonterra: 1 L1 + 1 L2 (4 audit rows) — status flip, resources arrow-handoff, engagement_type
- Convergix: 15 L1s (30 audit rows) — full team roster expansion, engagement_type, target nulling, 1 status flip
- Soundly: 3 L1s + 1 L2 (8 audit rows) — resources, engagement_type, Payment Gateway retainer with contract_end=2026-05-31, L2 title reformat
- LPPC: 7 L1s (9 audit rows) — engagement_type, resources expansion on 2 active L1s
- TAP: 1 client + 1 L1 + 5 L2s (13 audit rows) — client team Owner→PM fix, L1 rename, L2 title reformat, 4 blocked_by sequential chain
- HDL: 1 L1 + 3 L2s (6 audit rows) — L1 rename, full team roster, 3 client-led L2s with plain "HDL" resources
- Asprey: 3 writes (3 audit rows) — client team normalized, engagement_type=retainer, contract_end=2026-04-30
- Schema backfill: 63 week_items + 23 projects populated

### Deployment notes

- **Schema push ran first during Wave 1 (Chunk 4).** Drizzle columns are live on prod Turso: 9 v4 columns across projects/week_items/updates.
- **Second schema push needed post-Chunk-3 merge** for the `view_preferences` table. UI degrades gracefully until this push lands. TP runs `pnpm runway:push` after Chunk 3 integration.
- `pnpm runway:pull` from a fresh local env will sync.
- **All 7 client data migrations already applied to prod.** Forward + reverse scripts committed at `scripts/runway-migrations/<client>-v4-*-2026-04-21.ts`.
- **No Vercel preview needed.** Runway deploys from `runway` branch. Merge to runway → Vercel auto-deploys (may need one-time team auth click).
- **`.mcp.json` untouched.** Bot + MCP tool set grows by 2 (`get_week_items_by_project`, `get_project_status`) — existing clients continue working.

### Root causes addressed

- **Plate noise**: L1s were surfacing to everyone listed in resources. v4 filters L1s to owner-only for plate queries; team can still see L2s they're on.
- **Stale flags polluting Needs Update**: completed items were flagged as stale. Status filters in query layer now exclude terminal statuses.
- **Retainer representation**: no first-class engagement_type + contract_end. Added both; Payment Gateway + Asprey are first retainers under v4.
- **Handoff invisibility**: resources field was flat comma list, no signal for "Lane hands to Leslie." Arrow syntax + parser makes it explicit.
- **Dependency ambiguity**: `blocked_by` previously implicit in notes. Now explicit JSON array; TAP's ERP chain is first real use.
- **Cascade blind spots**: cascade only fired on deadline category. Now fires on all categories when L1 terminates. `triggered_by_update_id` makes the audit trail traceable.
- **Team roster drift**: overnight cleanup used primary-helper-only resources. v4 locks "engaged roles per L1" (union of L2 roles + owner role) with `clients.team` as source of truth.

### Verification steps

**Code:**
- `pnpm test:run` → 1587+ tests pass (baseline 1529 pre-Chunk-2; +53 Chunk 2, +5 net Chunk 3; Chunk 5 will add more)
- `pnpm build` → compiles cleanly (pre-existing session-decrypt warnings on /projects and /waitlist)
- `pnpm lint` → 0 errors, <N> pre-existing warnings

**Prod data:**
- Each migration has pre + post snapshot committed at `docs/tmp/<client>-v4-{pre,post}-snapshot-2026-04-21.json`
- Data-integrity QA agent verified each migration: 0 critical unexplained changes across all 7 clients
- Each migration has a reverse script committed alongside. Verified via dry-run against post-apply state: all reversals plan correctly.

**Runtime smoke (for reviewers to exercise post-merge):**
- Board `/runway` renders with In Flight toggle visible (default ON), past-end red section notes present, retainer/expired soft pills on plate summary
- Slack bot "what's on my plate" query returns date-bucketed weekItems (overdue/thisWeek/nextWeek/later) plus owned L1s as rollup
- `get_project_status` drill-down returns structured response via Claude Code MCP: `@Runway get_project_status clientSlug='convergix' projectName='Industry Vertical Campaigns'`
- `get_week_items_by_project` returns L2s scoped to a project id
- Retainer `Payment Gateway Page` (Soundly) surfaces retainer-renewal pill on Kathy's/Jill's plate within 30 days of 2026-05-31
- HDL client-led L2s render with `"HDL"` as resources (plain client name, no role prefix)
- TAP ERP Rebuild L2s show blocked_by chain visual (Dev → Data Migration → Testing → Deployment → Training)

### Known debt deferred (not in this PR)

These surfaced during Wave 1/2 QA and are either addressed in Chunk 5 polish (listed in summary) or explicitly deferred:

- Missing Bonterra Design L2s (no `delete-week-item` audit trail — predates this PR, investigation post-merge)
- Soundly audit rows missing explicit batchId tag (minor, affects publish-updates filter only)
- Chunk 1 commit `23d56eb` isolated-bisect breaks on `flags.test.ts` (fix landed in next commit — functional but bisect impurity)
- Team roster interpretation inconsistency: Soundly uses full-client-team-on-each, others use engaged-roles-per-L1 (operator ratification + normalization post-merge if desired)

### Rollback path

Each client migration has a `-REVERT.ts` script that reads the pre-snapshot and restores original field values. Secondary: `undo_last_change` MCP tool with batchId scope. See `docs/tmp/pr86-orchestration-amendment.md` for the full rollback protocol.

### Files of note

- `docs/tmp/runway-v4-convention.md` — the convention spec this PR locks in
- `docs/tmp/pr86-orchestration-amendment.md` — how this PR was built (autonomous execution design)
- `docs/tmp/pr86-wave-1-2-details.md` — per-wave integration details
- `docs/brain/pr86-chunk4-known-debt.md` — debt log (local-only, operator reviews)
- `docs/brain/pr86-tp-autonomous-decisions.md` — TP autonomous calls during execution (local-only, operator reviews)

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
