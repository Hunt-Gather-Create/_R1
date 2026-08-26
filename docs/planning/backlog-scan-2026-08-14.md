# Backlog Scan — 2026-08-14

Total open issues: 67
Scan basis: all open GH issues as of 2026-08-14; context from PRs #115, #116, #118 and epics E1 #101, E2 #102, E3 #103.

---

## 1. BUCKETS

### sheet-sync / integration (7)
- #103 — Apply-writes executor M1 E3
- #102 — Identity ledger to DB M1 E2
- #101 (E1, already built — see Overlap section)
- #91 — Phase 1b apply-writes engine
- #92 — Phase 2/3 bidirectional + cascade
- #40 — Tie a Sheet to a project or account
- #7 — google-api skill 403 on shared Drive docs

### data-cascade / data-integrity (15)
- #86 — Cascade-discipline bundle A (audit atomicity, write-path, undo retry)
- #22 — cascade-duedate missing startDate/endDate/dayOfWeek
- #21 — updateProjectField startDate/endDate write rejection
- #20 — linkWeekItemToProject silent wrapper-date clobber
- #19 — cascade-date-change emits no audit row
- #16 — Parent date override clobbered by child recompute (CRITICAL)
- #26 — Undo find-last + apply-undo not in transaction (race risk)
- #23 — Empty-string date fields prod cleanup
- #28 — MCP get_week_items_by_project default filter hides items
- #27 — MCP update_project_field category not in whitelist
- #25 — Five zombie projects cleanup
- #24 — Convergix L1 out-of-enum status=scheduled
- #30 — K3 prod backfill: retainers silently demoted
- #68 — Rewrite legacy setBatchId test sites to withBatchId
- #99 — 5 migration scripts call deprecated setBatchId (unscoped prod writes)

### auth / security (4)
- #98 — MCP bearer-token timing-safe compare
- #88 — authkit middleware lets JSON /api/* bypass session
- #59 — Proper rate limiting on /runway/auth form
- #90 — Rotate Runway env secrets (housekeeping)

### UI / UX (11)
- #67 — Add Retainer Wrapper layer + Subtasks + completion checkboxes
- #12 — Resourcing flag redesign (needs design)
- #10 — Task attachments (files, images, links)
- #74 — Card checkbox undo toast dedup
- #73 — Card checkbox cross-tab optimistic propagation
- #72 — Gantt CLI parity with retainer direct-WI render
- #56 — Gantt visual QA multi-pathway render
- #75 — Status View polish nits
- #85 — P3: same-operator Save→Undo→Save dedupes (residual)
- #60 — Preserve sub-path in /runway returnTo after auth
- #37 — Modal owner-name convention drift

### timezone / dates (1)
- #43 — Three competing timezone models cause day-bucketing drift

### Slack (11)
- #94 — Slack channel misses UI-originated updates
- #51 — Revamp 'what's on my plate' / workload response
- #36 — Slack modal non-atomic submit (duplicate write race)
- #34 — Slack bot-tools missing maxUses
- #33 — Slack modal can outlive proposal row
- #32 — Slack pickers show inactive team members
- #31 — Modal test row: retainer submitted as engagement_type=project
- #29 — Bug X3: retainer-toggle wipes form state
- #11 — Cascading picker (Client → Project → Task) for slash flow
- #6 — Slack modal Bug X2: /runway-edit-project demotes retainers
- #58 — Verify Slack /runway-gantt internal-light shipped

### perf / infra (8)
- #100 — Canary preview writes prod DB (no technical guard)
- #97 — Post-merge smoke gate wired to deploy signal
- #50 — Parallelization concern in getClientsWithProjects cold-start
- #48 — Worktree scripts hardcode main as base
- #47 — Rename Inngest app: auto-kanban → runway
- #46 — 11 pre-existing lint warnings
- #45 — Missing FK indexes on hot-path columns
- #1 — Remove deprecated npx flags from dev:inngest

### schema / data-model (4)
- #39 — Add L3 hierarchy level + flexible top-level wrapper assignment
- #38 — Categories + Status enums alignment audit
- #87 — Define notes content rules + non-exposed system-context field
- #96 — Milestones as first-class concept

### MCP (2)
- #28 — get_week_items_by_project default filter (also in data-cascade)
- #27 — update_project_field category whitelist (also in data-cascade)

### enhancements / new-features (2)
- #95 — Hybrid PM model support (waterfall + iterative)
- #93 (not filed yet — Substrate memory integration planned)

### chores / housekeeping (7)
- #77 — docs/tmp sweep + prune
- #69 — Split shared-knowledge from .tp/TP-STATE.md
- #57 — Inngest branch env audit + auto-archive policy
- #55 — Refactor large files before next PM features
- #54 — Repo hygiene: worktrees, stale branches, docs/tmp prune
- #18 — Post-Track-4 cleanup bundle (6 small items)
- #90 — Rotate env secrets (also in auth)

### bugs (13)
- #16 — Parent date override clobbered (CRITICAL)
- #22 — cascade-duedate missing columns
- #20 — Silent wrapper-date clobber
- #19 — No audit row on parent date recompute
- #26 — Undo race risk
- #23 — Empty-string date fields
- #85 — Same-operator dedup residual
- #74 — Undo toast dedup
- #6 — Slack modal retainer demotion
- #29 — Slack retainer-toggle wipes form state
- #31 — Slack modal retainer type submitted wrong
- #32 — Slack inactive member picker bypass
- #33 — Slack modal outlives proposal row

---

## 2. QUICK-WINS

These are high-value or high-risk issues that appear low-effort based on scope descriptions.

| # | Why | Effort |
|---|-----|--------|
| #1 | One-line devscript flag removal; good first issue label | S |
| #68 | Two test file cleanups + shim removal; mechanical, no logic change | S |
| #46 | Fix 11 pre-existing lint warnings; no logic, just cleanup | S |
| #98 | Swap string compare for `crypto.timingSafeEqual`; 2-line fix | S |
| #48 | Worktree script base-branch patch + one .gitignore line | S |
| #47 | Inngest app rename; config string change | S |
| #90 | Rotate 5 env secrets; ops task, no code | S |
| #58 | Verify/close one stale Slack ticket; investigation only | S |
| #97 | GitHub Action wiring to existing smoke suite; CI config | M |
| #75 | Three small polish nits batched in one PR | M |
| #34 | Add maxUses to Slack bot tools; pattern already exists | M |
| #99 | Verify 5 migration scripts + fix scoping; gsd-risk verified lead | M |
| #100 | Technical guard for canary → prod write; was the SEV-2 root | M |
| #19 | Emit audit row in cascade-date-change; small missing hook | M |
| #26 | Wrap Undo in transaction; safety fix, narrow scope | M |

Top 5 by combined value + risk + low effort:
1. **#98** — timing-safe token compare (security, 2 lines)
2. **#100** — canary prod-write guard (SEV-2 root, no technical guard today)
3. **#99** — fix deprecated setBatchId calls unscoped against prod (data-safety)
4. **#97** — smoke gate after deploys (CI, uses existing suite)
5. **#68** — finish post-B2 shim cleanup (test hygiene, unblocks shim removal)

---

## 3. OVERLAP FLAGS

### Overlaps with already-built work this cycle

| # | What it overlaps | Recommend |
|---|-----------------|-----------|
| #43 | Timezone day-bucketing — PR merged per git history (PR #114 infra bundle B listed #43 in scope) | Close as done — verify #43 was in the PR #114 bundle before closing |
| #100 | PR #116 "production-gate Runway schema push" gated the schema-push script from non-prod. But this ticket is about the broader canary deploy path writing prod Turso via live DB calls, NOT just schema-push. PR #116 does NOT fully close it. | Keep-but-note: PR #116 is a partial fix; the canary→DB-write guard is still open |
| #103 | E3 apply-writes executor was filed 2026-08-13 as in-flight work. It is listed in the "already built" context (E3 #103). | Dedupe — if E3 has landed, close; if still in-flight, keep open and track against M1 milestone |
| #102 | E2 identity ledger to DB was filed 2026-08-13 and listed as "already built." | Same as above — close if merged, keep open if still in-flight |
| #91 | Phase 1b apply-writes engine. PR #115 shipped Phase 1a (read-only diff). Phase 1b is the actual write path. #91 is the holder for that. | Keep — #91 is genuinely next, not built yet |
| #39 | L3 hierarchy + flexible wrapper assignment. PR #118 shipped 4-level hierarchy (sections L3, taskNo, sync ledger, render contract). | Dedupe — verify whether #118 fully satisfies the L3 spec in #39 or left items open |
| #67 | Retainer Wrapper layer + Subtasks + completion checkboxes. PR #118 shipped 4-level hierarchy. Wrapper concept may overlap. | Keep-but-note — #118 addressed the L3 section layer; the explicit Retainer Wrapper entity + subtasks + mouse-driven checkboxes may still be partially open. Owner to diff #118 scope vs #67 spec |
| #68 | setBatchId shim cleanup. #99 is a related gsd-risk about migration scripts still calling deprecated setBatchId. These are sibling tickets, not duplicates. | Keep both; #68 is test cleanup, #99 is prod-safety risk |

### Overlaps with planned "data-integrity safe-write tool" epic (M2)
- #86 — Cascade-discipline bundle A (audit atomicity) is adjacent to M2 scope; keep open as a pre-condition input to M2 planning
- #26 — Undo race risk: the Undo transaction fix is M1/safety-now, not M2. Keep open, do not defer to M2.
- #16 — Parent date override clobber: CRITICAL, do not defer to M2.

### Overlaps with planned Substrate memory integration epic
No current open tickets directly target Substrate memory integration. That epic is unborn on GH.

---

## 4. STALE / SUPERSEDED

| # | Why stale or superseded |
|---|------------------------|
| #58 | "Verify: Slack /runway-gantt internal-light shipped or pending?" — investigation ticket filed with priority:low, likely resolvable with one smoke test run. Could be quickly closed or confirmed stale. |
| #43 | Timezone day-bucketing — listed as already fixed (#43 in the PR #114 bundle). If confirmed, close. |
| #24 | Convergix Partners Page Redesign L1 out-of-enum status=scheduled — single data record fix, likely resolved by a migration already or simple one-off. |
| #30 | K3 prod backfill (retainers silently demoted by Bug X2) — labeled `blocked`. Unblocks after #6 (Bug X2) is closed. Stale if #6 is still open, but the backfill itself is a follow-on. |
| #37 | Modal owner-name convention drift — labeled data-tp priority:low; may have been swept in data cleanup migrations already. |
| #18 | Post-Track-4 cleanup bundle — PR #97 gate was cleared per the title; verify whether all 6 items inside have been closed by subsequent PRs. |
| #54 | Repo hygiene: worktrees, stale branches, docs/tmp prune — overlaps heavily with #77 (docs/tmp sweep) and #48 (worktree scripts). Consider consolidating into one chore PR. |

---

## 5. EPIC CANDIDATE GROUPINGS

### Epic A: Sheet↔Runway Sync (M1 + M2 path)
Core integration milestone. Builds the live two-way bridge.
- #103 (E3 apply-writes executor — M1)
- #102 (E2 identity ledger to DB — M1)
- #91 (Phase 1b apply-writes engine)
- #40 (tie Sheet to project or account)
- #92 (Phase 2/3 bidirectional + intelligent cascade — future)
- #96 (Milestones first-class, needed by sync row taxonomy)

### Epic B: Data-integrity safe-write tool (M2)
The "no surprise prod write" tooling layer. Pre-conditions for fully unattended sync.
- #16 (CRITICAL parent date clobber — must ship before M2)
- #22 (cascade-duedate missing columns)
- #20 (silent wrapper-date clobber)
- #19 (no audit row on parent recompute)
- #26 (Undo race — wrap in transaction)
- #86 (cascade-discipline bundle A)
- #21 (updateProjectField date write rejection)
- #100 (canary prod-write guard)
- #99 (deprecated setBatchId prod-safety)

### Epic C: Auth + security hardening
Short, high-impact. Should ship before any external beta.
- #88 (authkit middleware JSON bypass)
- #98 (MCP timing-safe token compare)
- #59 (rate limiting /runway/auth)
- #90 (rotate env secrets)

### Epic D: Slack completeness
All the open Slack bot holes in one sprint.
- #6 (Bug X2: retainer demotion)
- #29 (Bug X3: retainer-toggle wipes form)
- #31 (retainer type mismatch on submit)
- #32 (inactive member picker bypass)
- #33 (modal outlives proposal row)
- #36 (non-atomic submit race)
- #34 (missing maxUses)
- #94 (channel misses UI-originated updates)
- #30 (K3 prod backfill — after #6 closed)
- #51 (workload response redesign — needs design, can trail)
- #11 (cascading picker — needs design, can trail)

### Epic E: Schema + data-model stabilization
Clean up the model before Phase 1b writes depend on it.
- #39 (L3 hierarchy + wrapper assignment — verify against PR #118)
- #38 (Status/Category enums alignment)
- #67 (Retainer Wrapper layer + Subtasks — verify against PR #118)
- #87 (notes content rules + system-context field)
- #23 (empty-string date fields prod cleanup)
- #25 (zombie projects cleanup)
- #24 (out-of-enum status cleanup)

### Epic F: Infra + chore sweep
The housekeeping cluster. Good for a quiet week or intern-ready batch.
- #97 (post-merge smoke gate)
- #68 (setBatchId test cleanup)
- #46 (lint warnings)
- #48 (worktree script base-branch fix)
- #47 (Inngest app rename)
- #45 (missing FK indexes)
- #1 (remove deprecated npx flags)
- #55 (refactor large files)
- #54/#77 (docs/tmp prune — consolidate)
- #69 (TP-STATE.md split)
- #57 (Inngest branch env audit)
- #18 (Post-Track-4 cleanup bundle)
- #50 (cold-start parallelization concern)
- #7 (google-api 403 on shared Drive)

---

## Notes for operator

- **#43 timezone fix**: listed as in-scope for PR #114 but GH issue still shows open. Confirm and close if done.
- **#103 + #102**: labeled as "already built" in the scan brief, but both were filed 2026-08-13 and show no merge signal. Treat as in-flight M1 work, not closed.
- **#39 vs PR #118**: PR #118 shipped "4-level hierarchy + sections (L3)." #39 asks for L3 + flexible top-level wrapper. Owner should diff the two scopes and close or narrow #39.
- **#67 vs PR #118**: similar partial overlap. The Retainer Wrapper entity, subtasks, and mouse-driven checkboxes may still be open.
- **gsd-risk tickets (#98, #99, #100)**: all labeled as "unverified leads." Owner should do a quick verification pass before scheduling. #98 and #99 look straightforwardly verifiable with a grep.
