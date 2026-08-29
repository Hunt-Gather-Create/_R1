# Roadmap — Runway

**This file is the single plan of record.** Operator ruling 2026-08-29: we use the roadmap
milestone exclusively. GitHub milestones mirror this file. If the two disagree, this file wins
and GitHub gets corrected.

**GitHub Issues remains the source of truth for the content of an individual item:**
https://github.com/jasonburks23/_R1/issues

**Last refreshed:** 2026-08-29

---

## The epic

**Runway.** One epic. Everything below is a feature of Runway or an enhancement to one.

## The unit of execution is the MILESTONE, not the epic

Each milestone is scoped to one feature or one enhancement. That makes the milestone the unit
we plan end to end, dispatch as parallel threads into the build bay, gate, land, and close
before the next one opens. Other seats one-shot a whole epic. Ours is smaller on purpose,
because our milestones map to shipped product surface rather than to a program of work.

A milestone is ready to execute when it has a done-when sentence someone else could check,
every ticket in it carries the evidence its build needs, and the file-level overlap between
its tickets is known so parallel threads do not collide.

---

## Milestones

| # | Milestone | Open | Done when |
|---|---|---|---|
| 01 | Schedule Sync | 4 | One real client engagement syncs Sheet to Runway prod with pre-snapshot, post-verify diff, `withBatchId` audit trail, zero unguarded writes, and Holdout verified on merged main. |
| 02 | Auth and secret guards | 8 | No route compares a secret with plain equality, the guard discovers auth routes instead of reading a hand list, and the CI plus pre-push gate reports red, green, and never-ran distinctly. |
| 03 | DB safety tool | 0 | A staging database and promotion path exist, so prod is no longer the first place a migration runs. Tickets not drafted. |
| 04 | Meeting routing | 0 | Meeting transcripts route into Runway work items without hand transcription. Tickets not drafted. |
| 05 | Board UX | 8 | The board reads correctly and reacts correctly: no misleading labels, undo behaves under rapid input, inactive clients hide without data loss. |
| 06 | Slack correctness | 12 | Every Slack write path is atomic and idempotent, pickers filter what they claim to filter, and UI-originated changes reach the channel. |
| 07 | Work model | 7 | The hierarchy users see matches the hierarchy the data enforces: wrapper, subtasks, L3, enums, milestones as a first-class concept. |
| 08 | Data cascade | 15 | Cascade writes are transactional, emit an audit row, and cannot clobber a parent override. Prod data left behind by past cascade defects is cleaned. |
| 09 | Infra and repo hygiene | 16 | Build, deploy, lint, indexes, and repo scripts stop producing recurring friction, and CI signal is trustworthy. |

Sequencing note: 02 is ahead of 01 in practice right now, because #111 blocks pushes from the
main checkout and #112 is a live defect in production. Both are cheap. 01 resumes as soon as
they land.

---

### 01 Schedule Sync

Sheet to Runway sync engine. Apply-writes executor, identity ledger, service-account reads,
and the dry-run plus snapshot plus verify safety triplet.

| # | Title |
|---|---|
| #91 | Runway ↔ Google Sheets Sync — Phase 1b apply-writes engine |
| #40 | Google Sheet integration: tie a sheet to a project or account (PM-tool capability) |
| #7 | google-api skill: 403 on shared Drive docs (missing supportsAllDrives flags) |
| #92 | Runway ↔ Google Sheets Sync — Phase 2/3 bidirectional + intelligent cascade — **deferred**, downstream of #91, do not start until #91 has 30 days in prod |

Shipped: #101 service account (PR #121), #102 ledger to DB (PR #122), #103 apply-writes
executor (PR #131), #43 timezone convergence (PR #130).

### 02 Auth and secret guards

| # | Title |
|---|---|
| #111 | source-coverage guard scans gitignored files, so the pre-push hook refuses every push from the main checkout |
| #112 | gantt-embed compares its shared secret with plain !==, and the guard never opens that file |
| #109 | Auth-guard coverage stops at a hand-maintained route list, so a new route is silently unguarded |
| #107 | P1: the PR gate carries no information — red, green, and never-ran all render identically |
| #108 | Runway auth guard passes when the call is present but not reached (a feature flag defeats it) |
| #110 | Token-compare guard cannot see a compare that is both rebound and moved into a helper |
| #88 | authkit middleware lets JSON /api/* requests bypass session enforcement |
| #90 | Rotate Runway env secrets (housekeeping) |

Shipped: #98 timing-safe MCP bearer check (PR #129), #106 AST call-site guard (PR #134).

### 03 DB safety tool

Tickets not drafted. Scope is a staging database plus a promotion pipeline.

### 04 Meeting routing

Tickets not drafted.

### 05 Board UX

| # | Title |
|---|---|
| #105 | Runway board: a finished section reads as "0 tasks", which looks like a failed import |
| #104 | Runway board: hide an inactive or archived client without deleting its history |
| #12 | Resourcing flag redesign — current count metric is not actionable. **Needs design first.** |
| #10 | Task attachments: files, images, and links pinned to Runway tasks |
| #73 | Card checkbox: cross-tab optimistic propagation |
| #74 | Card checkbox: undo toast dedup on rapid sequential completes |
| #85 | P3: same-operator rapid Save→Undo→Save dedupes due to browser-sticky editorName |
| #75 | Status View polish nits (props rename + iPad touch + plan archive) |

### 06 Slack correctness

| # | Title |
|---|---|
| #6 | Slack modal Bug X2: /runway-edit-project silently demotes retainers to projects |
| #29 | Bug X3 (Slack modal edit): retainer-toggle wipes form state mid-edit |
| #36 | Slack modal Q5: non-atomic submit allows duplicate writes on race |
| #33 | Slack modal can outlive its proposal row (silent submission loss) |
| #32 | Slack pickers: inactive team members surface due to silent isActive filter bypass |
| #31 | Modal test row: Retainer Standard submitted with engagement_type=project |
| #34 | Slack bot-tools missing maxUses (CLAUDE.md compliance violation) |
| #94 | Slack channel misses UI-originated updates (checkbox click, pencil edit) |
| #37 | Modal owner-name convention drift (Jason vs Jason Burks) |
| #58 | Verify: Slack /runway-gantt internal-light shipped or pending? |
| #11 | Cascading picker (Client → Project → Task) for edit slash flow. **Needs design first.** |
| #51 | Slack bot: revamp 'what's on my plate' / get_person_workload response logic. **Needs design first.** |

### 07 Work model

| # | Title |
|---|---|
| #67 | Add Retainer Wrapper layer + Subtasks + mouse-driven completion checkboxes |
| #39 | Add L3 hierarchy level + flexible top-level wrapper assignment. **Needs design first.** |
| #38 | Categories & Status enums review across Wrapper / L1 / L2. **Needs design first.** |
| #96 | Milestones as first-class concept |
| #95 | Hybrid PM model support (waterfall + iterative / sprint) |
| #87 | Define notes content rules + consider non-exposed system-context field for L1/L2 |
| #72 | Gantt CLI parity with #65 retainer direct-WI render |

### 08 Data cascade

| # | Title |
|---|---|
| #16 | Parent date override clobbered by child-triggered recompute (data-tp CRITICAL) |
| #99 | 5 migration scripts call deprecated setBatchId() no-op, run unscoped against prod DB |
| #26 | Undo flow: find-last + apply-undo not in transaction (race risk) |
| #20 | linkWeekItemToProject: silent wrapper-date clobber when wrapper has no L1 children |
| #19 | cascade-date-change: parent date recompute emits no audit row |
| #21 | updateProjectField: startDate/endDate writes rejected, callers forced into overrideProjectDate |
| #22 | cascade-duedate: L2 dueDate sync misses startDate / endDate / dayOfWeek columns |
| #86 | Cascade-discipline bundle A — cycle 1 LlamaPReview deferrals |
| #27 | MCP update_project_field: category not in tool-level whitelist |
| #28 | MCP get_week_items_by_project: default filter hides non-completed items |
| #68 | chore: rewrite legacy setBatchId test sites to withBatchId |
| #23 | Empty-string date fields in prod (cross-client data cleanup) |
| #24 | Convergix Partners Page Redesign L1: out-of-enum status=scheduled |
| #25 | Five zombie projects (status=completed, no L2s, no dates) — convert or delete |
| #30 | K3 prod backfill: audit retainers silently demoted by Bug X2 |

Data-only items in this milestone go through the `data-integrity-tp` skill. No ad-hoc prod
mutations. See D-10.

### 09 Infra and repo hygiene

| # | Title |
|---|---|
| #97 | Post-merge smoke gate wired to deploy signal |
| #48 | Worktree scripts hardcode main as base — patch for runway + add .claude/worktrees to gitignore |
| #45 | Missing FK indexes on hot-path columns |
| #46 | 11 pre-existing lint warnings (TanStack Table + dead mock) |
| #47 | Rename Inngest app: auto-kanban → runway |
| #57 | Inngest branch env audit + auto-archive policy review |
| #59 | chore(runway): proper rate limiting on /runway/auth form |
| #60 | feat(runway): preserve sub-path in /runway returnTo after auth |
| #50 | Llama P1 (PR #100): parallelization concern in getClientsWithProjects under cold-start |
| #55 | Refactor pre-existing large files before next-tier PM features |
| #56 | Gantt visual QA: multi-pathway render verification |
| #54 | Repo hygiene: worktrees, stale branches, docs/tmp prune. **Mostly done 2026-08-29**, see note below |
| #69 | Split shared-knowledge content from auto-updated .tp/TP-STATE.md |
| #77 | docs/tmp/ thorough sweep — prune accumulated session scratch |
| #18 | Post-Track-4 cleanup bundle (PR #97 gate cleared — 6 small items) |
| #1 | chore: remove deprecated npx flags from dev:inngest script |

---

## Continuous tracks

Ongoing quality targets. These are supporting labels only. Every issue's primary home is a
milestone above.

| Track label | Quality target |
|---|---|
| `track:data-integrity` | No prod data corruption survives more than 24h after detection. Every prod write goes through DI-TP. |
| `track:design-debt` | Every `needs-design` item has an operator-aligned spec within 7 days of being filed. |
| `track:reliability` | No P0 bug stays open more than 7 days. |
| `track:cost` | LLM token cost per workspace stays inside the tracked budget. No Sonnet sneak-ups. |

---

## Change log for this file

**2026-08-29.** Collapsed two competing plans of record into one. The old B1 through B13
milestones described feature clusters; the 2026-08-13 planning doc described M1, M2 and M3
under an epic named "Runway integration + safe automation". Neither referenced the other, and
36 of 75 open issues carried no milestone at all, including every ticket filed in the previous
three months. All B milestones are now closed and every open issue is filed under 01 through
09. The epic is now simply "Runway"; the former "integration + safe automation" epic became
milestones 01, 03 and 04.

Also on 2026-08-29: five issues were found closed in reality but open on the board. #43, #98,
#102, #103 and #106 all shipped in merged upstream PRs whose bodies carried the D-07 closing
keyword, and the cross-repo auto-close did not fire. #101 did close the same way, so the
failure is intermittent rather than uniform. **Do not treat the D-07 closing keyword as the
closing step. Verify the issue actually closed after the merge.**

Also on 2026-08-29, against #54: worktrees went from 12 to 3 and 9.2 GB to 3.3 GB, and local
branches from 19 to 6. Nine merged branches were deleted after verifying by content rather than
by SHA, because this repo squash-merges and commit ancestry is permanently misleading here. The
local `runway` branch read as 23 commits ahead of `upstream/runway` and was carrying nothing:
all 22 differing files were older copies of what upstream already had. It was reset, with a
backup ref kept at `archive/pre-cleanup-runway-2026-08-29`. What remains open on #54 is the
`docs/tmp` prune, which overlaps #77.
