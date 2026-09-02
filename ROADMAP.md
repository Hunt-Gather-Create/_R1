# Roadmap: Runway

**This file is the single plan of record.** Operator ruling 2026-08-29: we use the roadmap
milestone exclusively. GitHub milestones mirror this file. If the two disagree, this file wins
and GitHub gets corrected.

**GitHub Issues remains the source of truth for the content of an individual item:**
https://github.com/jasonburks23/_R1/issues

**Last refreshed:** 2026-09-02, full re-verification against `705b6ae`

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
`observed`, never from closed tickets.**

| # | Milestone | Open | Observable event, one only | Observer | Observed |
|---|---|---|---|---|---|
| 01 | Schedule Sync | 2 | A row on the prod board changes to match its Google Sheet, and the operator sees the changed row on runway.startround1.com without anyone having typed it | operator | |
| 02 | Auth and secret guards | 4 | A deliberately unsafe secret compare, planted on a real route on a branch, turns the PR test gate RED on the GitHub PR page | Runway TP | |
| 03 | DB safety tool | 0 | A migration runs against staging and its diff is read there BEFORE it touches prod | operator | |
| 04 | Meeting routing | 0 | A work item nobody typed appears on the prod board, traceable to a named meeting transcript | operator | |
| 05 | Board UX | 8 | The operator loads runway.startround1.com and the named defect is visibly gone on the rendered page | operator | |
| 06 | Slack integration | 8 | A real slash command in the real Slack workspace produces the correct row, seen BOTH in Slack and on the prod board | operator | |
| 07 | Work model | 7 | A real retainer with real subtasks renders its full hierarchy on the prod board | operator | |
| 08 | Data cascade | 4 | A parent date override survives a child change in prod, and the audit row for it is read back from the prod DB | DI-TP | |
| 09 | Infra and repo hygiene | 16 | A merge to `runway` is followed automatically by a smoke run whose result appears in GitHub Actions | Runway TP | **2026-08-30 15:45Z** |
| 10 | Prod data corrections | 0 | Operator-walked. Not a dispatch target and not counted in percent-to-done. | operator | |
| 11 | Gate integrity | 4 | `npx tsc --noEmit` is wired as a required CI check, and a PR that reintroduces a cleared type error is blocked on the GitHub PR page before merge, not merely reported | Runway TP | |
| 12 | Data integrity as a tool | 7 | A write carrying an out-of-enum value is rejected by a database CHECK constraint, and the rejection is read back from the database itself, not from application code | DI-TP | |

Milestone 09's own observable event is the same event the launch track below already witnessed.
It is filled in here rather than left contradicting the launch track. See that section for the
evidence.

### Why several of these moved

Milestone 02's bar was "no route compares a secret with plain equality." **That bar is inert.**
A guard that opens no files and a guard that opens every file both produce a green suite, which
is precisely how `gantt-embed` stayed broken through two controls. The bar now requires the
guard to actually STOP something, which a broken guard cannot fake.

Milestone 05's bar was "the board reads correctly." A green component test produces that.
Only a rendered page on the real host does not.

Milestone 09's bar was "CI signal is trustworthy." Unfalsifiable as written. It is now the
one event that proves it.

Milestone 11's bar is "the type gate is wired," not "type errors are fixed." Zero errors with
nothing enforcing zero errors going forward is the same inert shape as milestone 02's original
bar: a green `tsc` run today says nothing about tomorrow's PR.

Milestone 12's bar is a rejection read back from the database, not from a test file. A test
that calls the application's own validator and finds it working proves the validator works. It
does not prove a write that skips the validator, a raw SQL client, a careless migration, is
also stopped. Only a constraint the database itself enforces proves that.

---

## Execution order

Decided by the Runway TP seat on 2026-09-02. This is the order milestones get worked, top to
bottom, one at a time.

| Order | Milestone | Why |
|---|---|---|
| 1 | 11 Gate integrity | Makes every later result trustworthy. The cheapest item, #124, unblocks the CI type gate entirely. Working anything else first means grading it with instruments already known to be broken. |
| 2 | 02 Auth and secret guards | Security, and already in flight. This milestone has produced the same defect shape three separate times: a guard whose broken state and working state are indistinguishable from outside. That repetition is the argument for finishing it rather than leaving it half done. |
| 3 | 05 Board UX | The board is the surface people actually use every day. It now also carries #142, which found that the dashboard cannot edit a project at all, only Slack and MCP can, and Slack has never written to production once. |
| 4 | 12 Data integrity as a tool | Protects production from the defect class that put 21 rows in violation of a locked rule for four months with nothing reporting it. |
| 5 | 07 Work model | Subtasks Phase 2, gated behind #141. |
| 6 | 08 Data cascade | |
| 7 | 09 Infra and repo hygiene | The largest pile, mostly small items, none of it blocking. |
| 8 | 01 Schedule Sync | Spec phase. The operator's position is that the first schedules get built by hand while the rules are worked out, so the code being ready does not mean it runs unattended. |
| 9 | 06 Slack integration | Last, and the operator set this himself on 2026-09-02: it moves after data integrity and is less of a priority. Nobody is using Slack for Runway. The production audit trail holds 3912 writes and zero came from Slack. |
| n/a | 03 DB safety tool, 04 Meeting routing | Carry no tickets on purpose. The work lives in other repos, `jasonburks23/agency-os#211` and `jasonburks23/meeting-processor#19`. Their placement in this order is an open operator decision. |
| n/a | 10 Prod data corrections | Operator-walked, not a dispatch target, not counted in percent-to-done. |

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
| L1 | Install the watcher | #97 | The smoke workflow appears in GitHub Actions and fires ON ITS OWN after a merge to `runway`, with nobody having run it | Runway TP | **2026-08-30 15:45Z** |
| L2 | Watch it come up | #97 | One real post-merge smoke run completes against the live host and its result is read in Actions | Runway TP | **2026-08-30 15:48Z** |
| L3 | Confirm it stayed up | new | Across five consecutive merges the gate either passes cleanly or catches a real regression, and no merge lands unwatched | Runway TP | **2026-09-01 14:18Z** |

**All three launch rows are now observed.** L3 was re-checked on 2026-09-02 against
`gh run list --workflow "Post-merge smoke"`: nine consecutive runs since 2026-08-30, every one
`conclusion: success`, the fifth landing at 2026-09-01T14:18:22Z. That clears the five-in-a-row
bar with four to spare, and none of the nine merges landed unwatched.

L1 is no longer unassigned or blocking. The launch control exists, is running, and has held.

---

## Percent-to-done, computed honestly

**Launch track: 3 of 3 observed.**

Run `33320528214`, event `deployment_status`, branch `runway`, head `61ca786`, conclusion success,
was the first. Nobody triggered it. The evidence that separates this from an inert workflow is
the step list, not the green tick: `pnpm runway:smoke` shows **success**, not **skipped**, so
the gate resolved ancestry, found the deployment on `runway`, and ran the real suite against the
live host. Eight more runs followed the same shape through 2026-09-02.

**Build milestones: 1 of 12 observed.** Milestone 09's event is the same event the launch track
proves, so it is now marked observed above rather than left blank next to a launch track that
already cleared it. Every other milestone, 01 through 08 and 10 through 12, has `observed`
empty. Nothing has been witnessed running in production against 05, 07, or any of the newer
security and data-integrity work, no matter how many of their tickets have closed.

**58 of the 60 currently open tickets carry a `## Verified against 705b6ae` section**, added
during the 2026-09-02 backlog re-verification. The two without one, #67 and #141, were each
independently re-verified against a slightly earlier SHA on this same branch, `d53b6dc` and
`e6aa437`, days before 705b6ae landed, and neither ticket's premise touches anything that
changed between those commits and 705b6ae.

That is not a discouraging number, it is the correct one. It says the launch control is real
and proven, the build half is moving, and the product-facing claims above it are still
unwitnessed. The number starts moving on the build side the moment 11 Gate integrity lands and
the next milestone's event gets checked for real.

---

### 01 Schedule Sync

Sheet to Runway sync engine. Apply-writes executor, identity ledger, service-account reads,
and the dry-run plus snapshot plus verify safety triplet.

| # | Title |
|---|---|
| #40 | Google Sheet integration: tie a sheet to a project or account (PM-tool capability) |
| #92 | Runway to Google Sheets Sync, Phase 2/3 bidirectional plus intelligent cascade. Deferred, downstream of #91, do not start until #91 has 30 days in prod |

Shipped: #101 service account, PR #121, #102 ledger to DB, PR #122, #103 apply-writes
executor, PR #131, #43 timezone convergence, PR #130. #91 and #7 closed 2026-09-01 as
already fixed on re-verification: #91's three sub-tickets, #101, #102, #103, were all already
in the tree, with one recorded divergence, the execution surface shipped as a CLI script rather
than an MCP tool. #7 closed because every Drive v3 call in the google-api skill now passes
`supportsAllDrives`.

### 02 Auth and secret guards

| # | Title | State |
|---|---|---|
| #109 | Auth-guard coverage stops at a hand-maintained route list | option 2 chosen, not yet built |
| #110 | Token-compare guard cannot see a compare that is both rebound and moved into a helper | KNOWN-UNCOVERED tripwire pinned, fix not yet built |
| #122 | Secret detector keys on five words in an env var name, so a nonce or salt shaped secret is invisible | measurement needed before a fix is chosen, no known live exposure |
| #90 | Rotate Runway env secrets | operator-only, not dispatchable |

Shipped: #98 timing-safe MCP bearer check, PR #129, #106 AST call-site guard, PR #134, #108
reachability guard, PR #136, commit `fa6bd3f`, #107 the PR gate carries information, PR #133,
#111 source-coverage guard scans the git index not the filesystem, PR #138, #114 vitest
excludes sibling worktrees, PR #139, #112 gantt-embed constant-time compare, PR #140, #120
env-var-name discriminator on the token compare guard, PR #142, #117 the secret-compare census
that informed #120's fix.

Closed without shipping code: #116, superseded by #108. #88 and #118 closed 2026-09-01 with
verdict GONE after a premise recheck against current code, commit `d921de1`: the authkit JSON
bypass and the four unguarded chat routes both no longer exist as described.

### 03 DB safety tool

Tickets not drafted. Scope is a staging database plus a promotion pipeline.

### 04 Meeting routing

Tickets not drafted.

### 05 Board UX

| # | Title |
|---|---|
| #105 | A finished L1 reads as empty: wrong label, suppressed ready-to-close chip, and no way to expand it |
| #73 | Card checkbox: cross-tab optimistic propagation |
| #74 | Card checkbox: undo toast dedup on rapid sequential completes |
| #85 | Same-operator rapid Save then Undo then Save dedupes due to browser-sticky editorName |
| #12 | Resourcing flag redesign, current count metric is not actionable. Needs design first |
| #75 | Status View polish nits |
| #10 | Task attachments: files, images, and links pinned to Runway tasks |
| #142 | The dashboard cannot edit a project, only Slack and MCP can, and Slack has never written to production |

#142 found that of 3912 production write records, 286 came through the dashboard and every one
was scoped to a week item. 468 came through `operator-batch`, the operator and Runway TP doing
by hand what the interface cannot do. Zero came from Slack.

Shipped: #104 hide an inactive or archived client without deleting its history, PR #153,
commit `705b6ae`.

### 06 Slack integration

| # | Title |
|---|---|
| #6 | Slack modal state is cached per block, so the retainer checkbox renders wrong and a notes-only save rewrites the row |
| #29 | Bug X3: retainer-toggle wipes form state mid-edit |
| #36 | Non-atomic submit allows duplicate writes on race |
| #33 | Slack modal can outlive its proposal row |
| #32 | Inactive team members surface due to silent isActive filter bypass |
| #94 | Slack channel misses UI-originated updates |
| #11 | Cascading picker for edit slash flow. Needs design first |
| #51 | Revamp 'what's on my plate' response logic. Needs design first |

Shipped: #31 modal test row root cause verified, #34 bot-tools maxUses compliance, #58
`/runway-gantt` internal-light verified shipped.

### 07 Work model

| # | Title |
|---|---|
| #67 | Subtasks under work items. The 4-level hierarchy and mouse-driven completion checkboxes already shipped, this is the remaining piece, the subtask entity itself. Prod data risk, needs an operator walk before dispatch |
| #141 | Subtask isolation holds by absence of a caller, not by a guard. Gates #67 phase 2 |
| #87 | Define notes content rules, consider a non-exposed system-context field for L1/L2 |
| #96 | Milestones as first-class concept |
| #95 | Hybrid PM model support, waterfall plus iterative/sprint |
| #139 | Owner and resources are two separate free-text people fields, so one person exists under several spellings and nothing knows who is staff |
| #38 | Write up the status and category enum decisions that already shipped |

Shipped: #39 L3 hierarchy and flexible top-level wrapper assignment, #72 Gantt CLI parity.
#67 data-and-writes-only phase already landed, PR #152, commit `131f516`.

### 08 Data cascade

| # | Title |
|---|---|
| #21 | updateProjectField: startDate/endDate writes rejected, callers forced into overrideProjectDate |
| #27 | MCP update_project_field: category not in tool-level whitelist |
| #68 | chore: rewrite legacy setBatchId test sites to withBatchId |
| #138 | Undo shows a raw database error instead of the out-of-date message when a write lands mid-transaction |

Data-only items in this milestone go through the `data-integrity-tp` skill. No ad-hoc prod
mutations. See D-10.

Shipped: #16 parent date override clobber, #19 cascade-date-change audit row, #20
linkWeekItemToProject wrapper-date clobber, #22 cascade-duedate column sync, #26 undo flow
transaction, #28 get_week_items_by_project default filter, #100 canary preview deploys writing
to prod DB, the SEV-2 root cause, PR #120, commit `dce32e5`.

### 09 Infra and repo hygiene

| # | Title |
|---|---|
| #113 | D-07 cross-repo closing keyword fires on some merges and not others, so shipped tickets sit open |
| #1 | chore: remove deprecated npx flags from dev:inngest script |
| #59 | chore(runway): proper rate limiting on /runway/auth form |
| #60 | feat(runway): preserve sub-path in /runway returnTo after auth |
| #56 | Gantt visual QA: multi-pathway render verification |
| #57 | Inngest branch env audit plus auto-archive policy review |
| #50 | Llama P1: parallelization concern in getClientsWithProjects under cold-start |
| #45 | Missing FK indexes on hot-path columns |
| #46 | 11 pre-existing lint warnings, TanStack Table plus dead mock |
| #47 | Rename Inngest app: auto-kanban to runway |
| #55 | Refactor pre-existing large files before next-tier PM features |
| #54 | Repo hygiene: worktrees, stale branches, docs/tmp prune. Overlaps #77 |
| #69 | Split shared-knowledge content from auto-updated .tp/TP-STATE.md |
| #77 | docs/tmp/ thorough sweep, prune accumulated session scratch |
| #18 | Post-Track-4 cleanup bundle, six small items |
| #48 | Worktree scripts hardcode main as base, patch for runway plus add .claude/worktrees to gitignore |

Shipped: #119 board midnight test pinned to explicit UTC, PR #141, #97 post-merge smoke gate,
PR #143, #115 base-ancestry gate refuses a stale or diverged base ref, PR #137, #121 gates
now re-test one branch against runway on every push, PR #146.

### 10 Prod data corrections

Operator-walked. Not a dispatch target and not counted in percent-to-done.

Closed 2026-09-02: #23 empty-string date fields, #24 Convergix Partners Page out-of-enum status,
#25 five zombie projects, #30 K3 prod backfill, #135 five prod rows violating the status and
category matrix, blocking the constraint migration under #130.

### 11 Gate integrity

| # | Title |
|---|---|
| #124 | Clear the remaining 40 type errors, the last blocker to a type gate |
| #125 | Wire the reachability suite into CI so the chat-route guard cannot silently lapse |
| #127 | Nothing stops the fourth timezone-dependent test from being written |
| #129 | Four test files fail at extreme timezones, pre-existing and invisible under UTC |

Nothing in this milestone has shipped yet. It is the first item in execution order because
every other milestone's build work gets graded through these same gates.

### 12 Data integrity as a tool

| # | Title |
|---|---|
| #130 | The database has no constraints, so any string can be stored in any enum column |
| #131 | The compatibility validator returns ok when it does not recognise a value, so unknown values pass |
| #132 | Enum lists are copied by hand and have already drifted, so there is no single source of truth |
| #133 | No test proves a bad value is refused, so a missing guard and a working guard both look green |
| #134 | Nothing reads prod for drift on a schedule, so a bad row is invisible until someone trips on it |
| #136 | The batch review gate scales by write count, not by judgment, so it fires six models at mechanical work |
| #137 | Migration safety is author discipline, not a property of the runner, so a careless script can overwrite rows nobody rechecked |

Shipped: #99 four dead April migration scripts deleted, PR #150, #86 five write helpers now
commit their audit row inside the same transaction as the write, PR #151, #37 owner-name
roster mismatch, 32 of 350 work items resolved to a real person.

Closed by a prod data fix, not a code change: #140, 21 production rows breaking the locked
L2-never-retainer rule. Fixed 2026-09-02 in batch `l2-never-retainer-fix-2026-09-02`, 50
operations, 0 violations on re-read. The ticket's other half, that nothing surfaced the drift
for four months, stays open under #137, the migration safety harness.

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

**2026-09-02.** Full re-verification against `705b6ae`. The entire open backlog was checked
ticket by ticket against current code rather than carried forward from the prior refresh; 58 of
60 open tickets now carry their own `## Verified against 705b6ae` section, and acceptance
criteria were rewritten to the artifact rule where they were not already checked against it.
Milestones 11 Gate integrity and 12 Data integrity as a tool, both missing from the previous
version of this file, were added. Milestone 06 is titled Slack integration, not Slack
correctness. Open counts, ticket tables, and shipped lists were corrected throughout: PRs #138,
#139, and #140 are merged, not open. Milestone 09's observable event was filled in as observed,
matching the launch track evidence it had been left contradicting. The launch track's L3 row
was checked against nine consecutive post-merge smoke runs and marked observed. An Execution
order section was added, set by Runway TP on 2026-09-02.

**2026-08-29.** Collapsed two competing plans of record into one. The old B1 through B13
milestones described feature clusters; the 2026-08-13 planning doc described M1, M2 and M3
under an epic named "Runway integration + safe automation." Neither referenced the other, and
36 of 75 open issues carried no milestone at all, including every ticket filed in the previous
three months. All B milestones are now closed and every open issue is filed under 01 through
09. The epic is now simply "Runway," and the former "integration + safe automation" epic became
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
