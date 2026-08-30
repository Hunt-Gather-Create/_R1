# Roadmap — Runway

**This file is the single plan of record.** Operator ruling 2026-08-29: we use the roadmap
milestone exclusively. GitHub milestones mirror this file. If the two disagree, this file wins
and GitHub gets corrected.

**GitHub Issues remains the source of truth for the content of an individual item:**
https://github.com/jasonburks23/_R1/issues

**Last refreshed:** 2026-08-29, second pass after the first merges landed

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

Planned to `one-shot-feature-planning-v1`. Every milestone carries **one observable event**,
written at plan time, plus the seat that must witness it. The rules that shaped these:

- **A milestone is DONE only when a named observer watched a named real event happen.**
- The event is binary, cheap to check, and **impossible to satisfy with a green test suite**.
- **An acceptance bar must name an artifact the defect cannot also produce.** If a broken
  version of the feature yields the same artifact, the bar is inert and gets moved.

`observed` stays empty until the event is witnessed. **Percent-to-done is counted from
`observed`, never from closed tickets.** The 17 percent figure reported on 2026-08-29 counted
closed tickets, which is the exact failure this SOP exists to prevent. The honest number today
is below.

| # | Milestone | Open | Observable event, one only | Observer | Observed |
|---|---|---|---|---|---|
| 01 | Schedule Sync | 4 | A row on the prod board changes to match its Google Sheet, and the operator sees the changed row on runway.startround1.com without anyone having typed it | operator | |
| 02 | Auth and secret guards | 7 | A deliberately unsafe secret compare, planted on a real route on a branch, turns the PR test gate RED on the GitHub PR page | Runway TP | |
| 03 | DB safety tool | 0 | A migration runs against staging and its diff is read there BEFORE it touches prod | operator | |
| 04 | Meeting routing | 0 | A work item nobody typed appears on the prod board, traceable to a named meeting transcript | operator | |
| 05 | Board UX | 8 | The operator loads runway.startround1.com and the named defect is visibly gone on the rendered page | operator | |
| 06 | Slack correctness | 12 | A real slash command in the real Slack workspace produces the correct row, seen BOTH in Slack and on the prod board | operator | |
| 07 | Work model | 7 | A real retainer with real subtasks renders its full hierarchy on the prod board | operator | |
| 08 | Data cascade | 11 | A parent date override survives a child change in prod, and the audit row for it is read back from the prod DB | DI-TP | |
| 09 | Infra and repo hygiene | 17 | A merge to `runway` is followed automatically by a smoke run whose result appears in GitHub Actions | Runway TP | |
| 10 | Prod data corrections | 4 | Operator-walked. Not a dispatch target and not counted in percent-to-done. | operator | |

### Why several of these moved

Milestone 02's bar was "no route compares a secret with plain equality". **That bar is inert.**
A guard that opens no files and a guard that opens every file both produce a green suite, which
is precisely how `gantt-embed` stayed broken through two controls. The bar now requires the
guard to actually STOP something, which a broken guard cannot fake.

Milestone 05's bar was "the board reads correctly". A green component test produces that.
Only a rendered page on the real host does not.

Milestone 09's bar was "CI signal is trustworthy". Unfalsifiable as written. It is now the
one event that proves it.

---

## Launch track, and it did not exist before 2026-08-30

**This is the half the SOP exists to catch, and we were missing all of it.** Every milestone
above was a build milestone. Merging to `runway` triggers a deploy, and nothing watches that
deploy. Ten of our tickets could close green while prod is down, which is exactly the shape
that produced incident RW-INC-2026-07-27-01, a prod dashboard returning 500 after a schema-push
gap that no gate caught.

`pnpm runway:smoke` already exists and runs Playwright against `runway.startround1.com`. It
runs when a person remembers to run it. That is not a launch control.

| # | Launch milestone | Ticket | Observable event | Observer | Observed |
|---|---|---|---|---|---|
| L1 | Install the watcher | #97 | The smoke workflow appears in GitHub Actions and fires ON ITS OWN after a merge to `runway`, with nobody having run it | Runway TP | |
| L2 | Watch it come up | #97 | One real post-merge smoke run completes against the live host and its result is read in Actions | Runway TP | |
| L3 | Confirm it stayed up | new | Across five consecutive merges the gate either passes cleanly or catches a real regression, and no merge lands unwatched | Runway TP | |

**L1 is blocked on nothing and is currently unassigned.** It is the highest-leverage open
ticket in the epic, because until it exists no milestone above can have its observable event
witnessed automatically, and every one of them is a claim about production.

L3 cannot be rushed. It needs five real merges to elapse. Planned and visible rather than
assumed, per the SOP.

---

## Percent-to-done, computed honestly

`observed` is empty on every row above. **By the SOP's arithmetic this epic is at 0 percent
delivered**, with 14 tickets closed and 7 changes merged to `runway` yesterday.

That is not a discouraging number, it is the correct one. It says the build half is moving and
**nothing has been witnessed running in production by a named observer.** The gap between 14
closed tickets and 0 observed events is exactly the gap that let two other epics close ten
milestones and deliver nothing.

The number starts moving the moment L1 lands.

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

| # | Title | State |
|---|---|---|
| #111 | source-coverage guard scans gitignored files, so the pre-push hook refuses every push from the main checkout | PR #138 open, blocked on #119 |
| #114 | vitest has no exclude, so the suite runs every worktree's copy of every test | PR #139 open, blocked on #119 |
| #112 | gantt-embed compares its shared secret with plain equality | PR #140 open, blocked on #119 |
| #117 | the sweep requires the literal words token and apiKey | measured, fix direction chosen, not built |
| #109 | auth-guard coverage stops at a hand-maintained route list | true only after #108 merged, now live |
| #110 | guard cannot see a compare that is both rebound and moved into a helper | unblocked by #108, dispatchable |
| #107 | the PR gate carries no information | headline shipped, two remainders |
| #88 | authkit lets JSON requests bypass session enforcement | premise in doubt, recheck dispatched |
| #118 | four chat routes have no auth check | downstream of #88's recheck |
| #90 | rotate Runway env secrets | operator-only, no dispatch |

#111 and #114 are a PAIR. #111 alone does not unblock pushes from the main checkout; with only #111, four of six collected test files still fail. Merge both or neither.

Shipped: #98 timing-safe MCP bearer check (PR #129), #106 AST call-site guard (PR #134),
**#108 reachability guard (PR #136, `fa6bd3f`)**.

Closed without shipping: **#116**, superseded by #108. Its one-line fix lived inside
`hasTokenEqualityShape`, which #108 deleted. The ordering warning held and nothing was lost.

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
| #119 | **Board midnight test asserts against the machine's timezone, so CI is red on every PR.** Blocks four PRs. |
| #115 | Base-ancestry gate refuses a stale or diverged base ref. PR #137 open, blocked on #119. |
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
