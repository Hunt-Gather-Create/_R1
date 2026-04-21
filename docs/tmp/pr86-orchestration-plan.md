# PR #86 Orchestration Plan

**Status:** Draft v1, pending post-compaction critical review by fresh-context TP.

**Purpose:** How PR #86 gets built. Chunks, waves, parallelism, data interleave, quality gates, risks. Source of truth through merge.

**Convention reference:** `docs/tmp/runway-v4-convention.md` (v4 locked).

---

## Mission

Ship PR #86 with code changes that make the Runway board + Slack bot enforce the v4 convention, cleanly display engagement + workstream data, and give users (Kathy, Jill, Leslie, Sami, etc.) a smart, actionable "what's on my plate" experience. In parallel, apply v4 data migrations to all 13 clients so the board is in great shape the moment PR #86 merges.

## Scope — what's IN

### Code (5 chunks)

#### Chunk 1 — Query layer foundation
1. `getStaleWeekItems` skip `status=completed` (RC-5)
2. `detectStaleItems` skip `status=completed,on-hold` (RC-4)
3. Audit `detectResourceConflicts` + `detectBottlenecks` for status-ignore pattern (RC-6)
4. `detectBottlenecks` refinement: count only active L2s (exclude completed, blocked, stubs where parent L1 is awaiting-client)
5. `getPersonWorkload` — filter by status (default exclude completed)
6. `getPersonWorkload` — date-bucket into `overdue / thisWeek / nextWeek / later`
7. `getPersonWorkload` — L1 match only on `owner` (not resources); separate projects from week_items in response shape
8. `getPersonWorkload` — stub filter: exclude L2s where parent L1.status = awaiting-client from active buckets
9. Commit pre-existing `category` whitelist extension (on `backup/pr86-work`)
10. Restore `linkWeekItemToProject` helper (on `backup/pr86-work`)
11. Restore `weekOf` whitelist addition (on `backup/pr86-work`)
12. Restore `publish-updates dedup` fix (on `backup/pr86-work`)
13. Tests for all above

#### Chunk 2 — Bot tool / response layer
14. `get_week_items` — match on resources too, not owner-only
15. New MCP tool `get_week_items_by_project` (enables drill-down; prevents agent direct-DB workarounds)
16. New MCP tool / bot tool `get_project_status(clientSlug, projectName)` — drill-down response
17. Parser: resources field splits on `,` and `->`; canonicalize arrow variants to `->`
18. Bot prompt context updates — v4 convention + smart plate framing (L2s first, owned L1s rollup, offer drill-down, category-derived tone)
19. Cascade on all categories when L1 status flips to terminal (not just deadline)
20. `triggeredByUpdateId` propagated through cascade audit rows
21. Tests

#### Chunk 3 — UI board
22. Unified Project View — render from same source as Week Of view; Project View becomes grouping, not duplicate data
23. L2 owner inheritance on create — auto-populate from parent L1.owner
24. Past-end L2 red section inline note ("status unchanged past end_date — needs review, last touched N days ago")
25. Retainer renewal soft surface on plate (30 days before contract_end)
26. Contract-expired soft surface on plate (when clients.contract_status = expired and L1 active)
27. In Flight toggle on Week Of view (section between Red and Today)
28. blocked_by dependency visualization (indent or arrow between linked L2s)
29. Visual QA + tests

#### Chunk 4 — Schema additions
30. Add `start_date`, `end_date` columns on `projects` (nullable; derived by default)
31. Add `start_date`, `end_date` columns on `week_items` (start required, end nullable)
32. Add `contract_start`, `contract_end` on `projects` (nullable; manual override)
33. Add `engagement_type` enum on `projects` (`project` / `retainer` / `break-fix`)
34. Add `blocked_by` array/JSON column on `week_items`
35. Add `triggered_by_update_id` FK on `updates` table
36. Derivation logic — recompute project.start/end from children on L2 write
37. Data backfill: populate start/end on existing L2s from current `date` field; populate project start/end by derivation
38. Tests for schema migration + derivation

#### Chunk 5 — Notifications, polish, PR prep
39. Past-end L2 detector (new flag for flags rail)
40. Batch-update skill audit — verify filter, multi-field, dry-run, batchId tagging, bulk L2-owner backfill capability; light fixes if gaps
41. `/code-review` + `/preflight` + `/pr-ready` + `/atomic-commits` across all chunks
42. TP pre-Llama review against the 20-pattern checklist
43. PR message write-up (why, deployment notes, root causes, verification steps per operator preference)
44. Open PR, iterate on Llama findings

### Deferred (not in PR #86 scope)

- `matchesSubstring` whole-word hardening (RC-7) — theoretical, defer until real false-match surfaces
- MCP schema exposure to bot — luxury polish
- MCP Tier 3 observability tools (`get_data_health`, `get_batch_contents`, `get_cascade_log`) — luxury
- L2-slip notification fallback — unneeded in v4 (L2 inherits owner)
- Pipeline enhancements — works today, out of scope
- Handoff visual marker UI — `blocked_by` + arrow-syntax in resources covers it
- Tags / labels cross-cutting — defer; category field sufficient
- Priority field on L2 — defer; derive from category for tone
- Stub-project pattern drop/hide decision — resolved: hide when parent awaiting-client (Chunk 1 #8)
- "In Flight" as separate tab — resolved as Week Of toggle instead

### Data (parallel migrations)

Applied during waves via background agents running from `backup/pr86-work` worktree (has `linkWeekItemToProject`).

**Overnight clients to realign to v4** (7 touchups):
- Bonterra (restart halted touchup with updated spec)
- Convergix (v4 alignment: full team roster on all L1s, status flips, stale target clears)
- Soundly (v4 alignment: full team roster)
- TAP (v4 alignment)
- HDL (v4 alignment + contract-expiry flag data)
- LPPC (v4 alignment)
- Asprey (touchup: add engagement_type=retainer, contract_end=4/30)

**Remaining-6 clients to fully clean under v4:**
- Hopdoddy
- Beyond Petro (complex, 9 projects)
- AG1
- ABM
- EDF
- Wilsonart

---

## Chunk acceptance criteria

### Chunk 1 — Query layer foundation
- [ ] All 8 query-layer fixes land with tests
- [ ] 4 helper commits restored from `backup/pr86-work`
- [ ] `/preflight` green across repo
- [ ] No regressions in existing `getPersonWorkload` callers
- [ ] New query return shape matches interface contract (see below)
- [ ] `batch-update` skill audit done (fold into Chunk 1 or 5)

### Chunk 2 — Bot tool / response layer
- [ ] `get_week_items_by_project` returns projectId-scoped L2s cleanly
- [ ] `get_project_status` returns structured drill-down (see interface contract)
- [ ] Resources parser handles comma + arrow variants
- [ ] Bot prompt context loads v4 convention + smart plate framing
- [ ] Cascade on all categories verified with test per category
- [ ] `triggeredByUpdateId` populated on cascade-generated audit rows
- [ ] Tests co-located

### Chunk 3 — UI board
- [ ] Project View renders from unified source (no duplicate data plumbing)
- [ ] L2 owner inheritance works on new L2 create
- [ ] Past-end L2 red-section note renders correctly
- [ ] Retainer renewal + contract-expired flags surface on owner's plate summary
- [ ] In Flight toggle functions on Week Of view
- [ ] blocked_by renders with visual cue
- [ ] Visual QA: Kathy, Jill, Leslie, Sami, Allison, Jason each get correct plate

### Chunk 4 — Schema additions
- [ ] Migration applied to `runway-schema.ts` + `.sql`
- [ ] Drizzle schema matches SQL migration exactly
- [ ] start/end derivation logic on project recomputes on L2 write
- [ ] Backfill populates existing data cleanly
- [ ] Rollback path tested

### Chunk 5 — PR prep
- [ ] Past-end detector live on flags rail
- [ ] batch-update skill audited
- [ ] `/code-review` + `/preflight` + `/pr-ready` + `/atomic-commits` all green
- [ ] TP pre-Llama review checklist complete
- [ ] PR message drafted
- [ ] PR open, Llama triggered

---

## Wave structure — parallelism + timing

### Wave 0 — Upfront prep (TP-only, ~1-2h)

**Deliverables:**
- v4 convention doc (done — `runway-v4-convention.md`)
- Orchestration plan (this file)
- Interface contracts (below)
- Pre-Llama checklist (below)
- Chunk CC prompts (1 per chunk, stored in `docs/tmp/cc-prompt-chunk-N-pr86.md`)
- Data migration templates (1 per client, stored per-client)
- Compaction boundary marker

### Wave 1 — Foundation + overnight data touchups (~5h wall clock)

**Code (3 parallel worktrees, feature branches off `feature/runway-pr86-base`):**
- Worktree A: Chunk 1 (query layer + helper restoration)
- Worktree B: Chunk 4 (schema + derivation)
- Worktree C: Chunk 3 groundwork (UI unified table, Project View refactor) — against mocked Chunk 1 shape

**Data (6 parallel background agents, running from `backup/pr86-work` worktree):**
- Bonterra v4 touchup
- Convergix v4 realign
- Soundly v4 realign
- TAP v4 realign
- HDL v4 realign (+ contract-expiry data)
- LPPC v4 realign

**TP reviews each as they complete; integrates into a Wave 1 merge branch.**

### Integration pause (~30-60 min)

- TP merges Wave 1 worktrees into `feature/runway-pr86-wave1`
- Reconciles interface drift (Chunk 3 mock vs. Chunk 1 real return)
- Resolves any merge conflicts
- Runs `/preflight` on merged branch
- Updates plan doc with Wave 1 results

### Wave 2 — Integration + smart bot + Asprey + 3 remaining clients (~4h)

**Code (2 parallel worktrees, off `feature/runway-pr86-wave1`):**
- Worktree D: Chunk 2 (bot tool / response layer)
- Worktree E: Chunk 3 finish (connect UI to real data)

**Data (3-4 parallel background agents):**
- Asprey v4 touchup
- Hopdoddy cleanup (remaining-6 — light, no transcript depth needed)
- AG1 cleanup (remaining-6 — light)
- Wilsonart cleanup (remaining-6 — light)

**TP reviews + integrates into Wave 2 branch.**

### Wave 3 — Polish + complex clients + PR open (~3h)

**Code (1 worktree):**
- Chunk 5 (notifications + polish + PR prep)

**Data (2-3 parallel agents):**
- Beyond Petro cleanup (complex, 9 projects, may surface decisions)
- ABM cleanup
- EDF cleanup

**TP:**
- Final `/preflight` on integration branch
- TP pre-Llama review (against 20-pattern checklist)
- PR message write-up
- Open PR, monitor Llama review

### Pop-out state

- All 13 clients in v4 shape on prod
- Code merged to integration branch, PR open
- Llama re-review in flight
- Board clean for team

### Timeline

| Phase | Wall clock | Notes |
|---|---|---|
| Wave 0 prep | 1-2h | TP solo, post-compact |
| Wave 1 | ~5h | 3 code agents + 6 data agents parallel |
| Integration 1 | 30-60m | TP review + merge |
| Wave 2 | ~4h | 2 code + 3-4 data |
| Integration 2 | 30m | TP review + merge |
| Wave 3 | ~3h | 1 code + 2-3 data + PR prep |
| Llama iteration | 1-2h | Post-PR-open; buffer |

**Total: ~14-17 hours wall clock, across 2 working days or 3-4 Max plan time blocks.**

---

## Interface contracts

### `getPersonWorkload` return shape (Chunk 1 output, consumed by Chunk 2 + Chunk 3)

```ts
{
  person: string,
  ownedProjects: {
    inProgress: Project[],     // L1s person owns with any active L2s
    awaitingClient: Project[],
    blocked: Project[],
    onHold: Project[],
    completed: Project[]       // opt-in only; default omit
  },
  weekItems: {
    overdue: WeekItem[],       // end_date < today AND status != completed
    thisWeek: WeekItem[],      // start_date within current Mon-Sun
    nextWeek: WeekItem[],      // start_date within next Mon-Sun
    later: WeekItem[]          // start_date beyond next week
  },
  flags: {
    contractExpired: Client[], // soft flag for L1 owner
    retainerRenewalDue: Project[] // within 30 days of contract_end
  },
  totalProjects: number,
  totalActiveWeekItems: number
}
```

### `get_project_status` return shape (Chunk 2 drill-down)

```ts
{
  name: string,
  client: string,
  owner: string,
  status: string,
  engagement_type: string,
  contractRange: { start?: ISODate, end?: ISODate },
  current: {
    waitingOn?: string,
    blockers?: string[]       // from blocked_by resolution or status=blocked L2s
  },
  inFlight: WeekItem[],        // status=in-progress, today between start/end
  upcoming: WeekItem[],        // next 14 days, status != completed
  team: string,                // L1.resources
  recentUpdates: Update[],     // last 3
  suggestedActions: string[]   // e.g., "change status", "add note", "set date"
}
```

### Schema migration contract (Chunk 4 output, consumed by Chunk 3 UI and Chunk 1 derivation)

- `projects`: add `start_date`, `end_date`, `contract_start`, `contract_end`, `engagement_type`
- `week_items`: add `start_date` (required, backfilled from `date`), `end_date` (nullable), `blocked_by` (JSON array or nullable)
- `updates`: add `triggered_by_update_id` (nullable FK)
- Drizzle schema and `.sql` migration must match exactly
- Backfill script populates existing data

---

## Pre-Llama checklist (from scan of past PRs)

Apply during code work AND in TP pre-review before PR open.

- [ ] Regex: escape hyphens in all char classes (`\-` not `-`)
- [ ] Errors: `console.error(err)` not `.message`; full stack always
- [ ] Reusable patterns: centralize in `docs/runway-*.md` with code comment link
- [ ] No global mutable state; use DI or explicit args
- [ ] Multi-step mutations wrapped in `db.transaction()`
- [ ] Sanitize user data / credentials / internal URLs in logs
- [ ] Audit records include `metadata` JSON with field mapping
- [ ] Migrations: schema `.sql` matches Drizzle schema exactly
- [ ] Breaking changes documented; all callers updated
- [ ] Dynamic import paths validated against whitelist
- [ ] Timestamps consistent (all integer mode: timestamp)
- [ ] DRY: extract shared formatting/notification code
- [ ] Check related unchanged files for new-type handlers (switch cases, renderers)
- [ ] Fuzzy matching: unit tests for each input class
- [ ] Validate URLs/paths before external API calls (SSRF guard)
- [ ] UI fallbacks for unmapped enum values
- [ ] Sanitize names before regex/matching; test Unicode
- [ ] No-op guards tested for sequential + concurrent edges
- [ ] Document server/client load impact of polling changes
- [ ] Sync capability docs with actual implementation

---

## Quality gates per chunk

Each chunk CC session runs, in order:
1. Implementation + tests
2. `/code-review` — catches DRY, prop drilling, missing tests
3. `/preflight` — build + test:run + lint all green
4. `/pr-ready` — debug cleanup, unused imports, dead code
5. `/atomic-commits` — logical commit structure, conventional commit format

**Staging strategy:** before `/atomic-commits`, explicitly `git add` only touched files. Never `git add -A`. Run with `--staged` flag to exclude untracked PR #86-adjacent work from commits.

**TP reviews each chunk** against chunk acceptance criteria + interface contract before merging.

**Final gate before PR open:** TP pre-Llama review against the 20-pattern checklist.

---

## Compaction strategy

**Current budget estimate:** at ~50% post-draft. Waves burn ~15-20% each for orchestration overhead. Expected 1-2 auto-compacts during Waves 2-3.

**Mitigation:**
- This plan doc is the source of truth. Post-compact TP reads it and resumes.
- MEMORY.md pointers updated at each wave completion.
- After each chunk merges, TP writes a "wave snapshot" appendix to this doc.
- Commit all uncommitted decisions to doc before expected compact boundaries.

**Checkpoint signals — write snapshot when:**
- TP context passes 65% (proactive)
- Wave completes (milestone)
- About to spawn > 3 parallel agents (orchestration-heavy)

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Interface contracts drift between waves | Medium | High | Contracts locked in this doc; integration pauses enforce reconciliation |
| Schema migration conflicts with concurrent worktrees | Medium | Medium | Chunk 4 pushes last in Wave 1; other worktrees don't touch schema |
| Data agent hits prod state drift during migration | Medium | Medium | Each migration has pre-check; halts on mismatch (proven on Bonterra touchup) |
| TP cognitive load with 3+ parallel agents | Medium | Medium | Agents run background; report sequentially; TP handles one at a time |
| Compaction loses context mid-wave | Medium | Low-Medium | Plan doc survives; wave snapshots; interface contracts preserved |
| Llama re-review finds issues in PR #85 + new issues in PR #86 | Medium | Low | Preemptive fixes per 20-pattern checklist; PR #85 already addressed |
| `linkWeekItemToProject` still needed during data migrations | Certain | Medium | Data agents run from `backup/pr86-work` worktree where helper exists |
| Remaining-6 cleanup surfaces unknown transcript info | Medium | Medium | Agents halt and report on ambiguity; TP escalates to operator if needed |
| `start_date/end_date` backfill misses legacy data | Low | Medium | Backfill script has verification pass; manual spot checks |

---

## Open items for post-compact fresh-context critique

Items I suspect fresh-TP may push back on or want to refine:

1. Is Wave 1 parallelism too aggressive for 3 code + 6 data concurrent? Or right sized?
2. Are interface contracts tight enough, or are there hidden shape assumptions?
3. Is the schema migration in Chunk 4 safe to run pre-code-merge, or does it need to coordinate timing?
4. Does the v4 convention have gaps when applied to retainers with long contract durations (year+)?
5. Are all Llama patterns truly applicable, or are some edge cases for our context?
6. Does Wave 3's Beyond Petro complexity risk blocking Wave 3 completion?
7. Is TP context budget realistic for full orchestration without extra compacts?

Fresh TP should read this plan cold and critique.
