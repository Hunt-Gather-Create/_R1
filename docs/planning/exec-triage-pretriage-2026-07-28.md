# Runway Exec-Triage Pre-Triage — 2026-07-28

**Author:** Runway-TP
**Dispatch:** Overwatch envelope `ow-dispatch-runway-tp-step4-pretriage` (2026-07-28T02:17Z)
**Scope:** 66 open issues on `jasonburks23/_R1` (fork; `Hunt-Gather-Create/_R1` upstream is empty per fork-based issue-tracking convention D-07)
**Source data:** `gh issue list -R jasonburks23/_R1 --state open --limit 100 --json number,title,state,labels,createdAt,updatedAt` (this cycle)
**Cross-reference:** Overwatch codebase brief `agencyos-overwatch/docs/briefs/runway-codebase-exec-brief-2026-07-28.md` §8 roadmap (B1 shipped, B2/B3 queued, B4 partial)

Priority key:
- **P0** — blocker for a currently-active milestone (none active this arc; B2 queued, not started)
- **P1** — near-term important (security, critical data-integrity, integration-blocking)
- **P2** — backlog (needs-design, medium-impact, non-urgent)
- **P3** — nice-to-have or stale

Close-candidate key: `yes` (strong — superseded / obsolete), `no` (still valid), `needs-check` (may be shipped or superseded, verify).

Hook-status key: `needs-hook` (not on Fleet board yet; default assumption for all 66 pending exec-triage step 4 hookup), `hooked` (verified on board), `skip` (chore-only, no need).

Note: age-based close rule ("> 4 months no-motion") does not fire on any ticket. Earliest open (#1, #2) are 2026-04-18 (~3.3 months). All others 2026-05 or later.

## Table

| # | Title | Initiative | Priority | Close? | Hook | Note |
|---|-------|------------|----------|--------|------|------|
| 97 | Post-merge smoke gate wired to deploy signal | Deploy infra / SOP 5.5 follow-up | P1 | no | needs-hook | Filed this arc as detection-gap-3 residual from RW-INC-2026-07-27-01. Owner unassigned. |
| 96 | Milestones as first-class concept | PM-tool enhancement | P2 | no | needs-hook | Needs-design; parked pending Phase 1b Sheets sync. |
| 95 | Hybrid PM model support (waterfall + iterative / sprint) | PM-tool enhancement | P2 | no | needs-hook | Needs-design; parked with #96. |
| 94 | Slack channel misses UI-originated updates | Slack broadcast integration | P2 | no | needs-hook | Silent slice: checkbox + pencil edits don't broadcast to Slack. |
| 92 | Runway ↔ Google Sheets Sync — Phase 2/3 bidirectional | Sheets integration (roadmap Phase 2/3) | P2 | no | needs-hook | Downstream of Phase 1b (#91); operator has said Stage 3 timing = post-Stage 2 build. |
| 91 | Runway ↔ Google Sheets Sync — Phase 1b apply-writes engine | Sheets integration (roadmap Phase 1b) | P1 | no | needs-hook | ACTIVE workstream; Fable 5 CC next dispatch. Depends on v4 schema (shipped) + DI-TP gate. |
| 90 | Rotate Runway env secrets (housekeeping) | Auth / security | P2 | no | needs-hook | Prior arc housekeeping; no drift signal but stale-key hygiene. |
| 88 | authkit middleware lets JSON /api/* requests bypass session enforcement | Auth / security | **P1** | no | needs-hook | Security: session enforcement bypass on API JSON paths. Investigate scope. |
| 87 | Define notes content rules + non-exposed system-context field for L1/L2 | Data / schema enhancement | P2 | no | needs-hook | Notes-cap discussion from June batch work; not v4-critical. |
| 86 | Cascade-discipline bundle A cycle 1 LlamaPReview deferrals | Data-cascade (roadmap B3) | P1 | no | needs-hook | audit-trail atomicity + write-path unification + undo retry deferrals from bundle A. |
| 85 | P3: same-operator rapid Save→Undo→Save dedupes due to browser-sticky editorName | Data / audit | P3 | no | needs-hook | Residual of #80 fix; labeled priority:low. |
| 77 | docs/tmp/ thorough sweep — prune accumulated session scratch | Housekeeping | P3 | no | skip | Cross-repo scratch prune. Cheap when someone touches it. |
| 75 | Status View polish nits (props rename + iPad touch + plan archive) | UI polish | P3 | no | needs-hook | batch-candidate label; low-effort cluster. |
| 74 | Card checkbox: undo toast dedup on rapid sequential completes | UI bug | P3 | no | needs-hook | Low-severity dedup on checkbox toast. |
| 73 | Card checkbox: cross-tab optimistic propagation | UI enhancement | P3 | no | needs-hook | Multi-tab UX polish. |
| 72 | Gantt CLI parity with #65 retainer direct-WI render | UI / Gantt | P2 | no | needs-hook | Follow-up parity item to shipped #65. |
| 69 | Split shared-knowledge content from auto-updated .tp/TP-STATE.md | Infra / TP tooling | P3 | no | needs-hook | Cross-cutting TP tooling hygiene. |
| 68 | chore: rewrite legacy setBatchId test sites to withBatchId | Data-cascade chore | P3 | no | needs-hook | Post-B2 follow-up chore. |
| 67 | Add Retainer Wrapper layer + Subtasks + mouse-driven completion checkboxes | Data / hierarchy enhancement | P2 | **needs-check** | needs-hook | v4 hierarchy shipped retainer + sections (L3); may be partially or fully addressed by PR #118. Verify subtasks + checkboxes shape. |
| 60 | feat(runway): preserve sub-path in /runway returnTo after auth | UX enhancement | P3 | no | needs-hook | Auth-redirect polish. |
| 59 | chore(runway): proper rate limiting on /runway/auth form | Auth / security | P2 | no | needs-hook | Brute-force protection on shared password gate. |
| 58 | Verify: Slack /runway-gantt internal-light shipped or pending? | Slack / verification | P3 | **needs-check** | needs-hook | Verification-only task; may already be done, check codebase. |
| 57 | Inngest branch env audit + auto-archive policy review | Infra | P3 | no | needs-hook | Ties into `feature/ads` unknown-env item from prior. |
| 56 | Gantt visual QA: multi-pathway render verification | UI / QA | P2 | no | needs-hook | Playwright-adjacent QA gap. |
| 55 | Refactor pre-existing large files before next-tier PM features | Infra / debt | P2 | no | needs-hook | Debt-reduction blocker for scale-up work. |
| 54 | Repo hygiene: worktrees, stale branches, docs/tmp prune | Housekeeping | P3 | no | skip | Ongoing hygiene. |
| 52 | /api/runway/version: 200 OK unauthenticated (deploy metadata leak) | Auth / security | **P1** | no | needs-hook | Metadata leak: deploy info exposed to unauth. Small blast radius but fix cheap. |
| 51 | Slack bot: revamp 'what's on my plate' / get_person_workload response logic | Slack enhancement | P2 | no | needs-hook | Design-first track item; needs operator alignment (per brief §9 Next Steps). |
| 50 | Llama P1 (PR #100): parallelization concern in getClientsWithProjects under cold-start | Perf | P3 | no | needs-hook | Cold-start-specific; latent at current scale. |
| 48 | Worktree scripts hardcode main as base — patch for runway + .claude/worktrees gitignore | Infra chore | P3 | no | needs-hook | batch-candidate. |
| 47 | Rename Inngest app: auto-kanban → runway | Infra chore | P3 | no | needs-hook | Cosmetic-plus rename. |
| 46 | 11 pre-existing lint warnings (TanStack Table + dead mock) | Dashboard chore | P3 | no | needs-hook | Debt trim. |
| 45 | Missing FK indexes on hot-path columns (perf latent at current scale) | Perf | P2 | no | needs-hook | Latent perf; upgrade priority when scale increases. |
| 44 | _cachedClients module-level TTL: 5-second cache leaks stale data across users | Bug / infra | **P1** | no | needs-hook | Cross-user cache leak — data-freshness + light isolation concern. |
| 43 | Runway UI: three competing timezone models cause day-bucketing drift | Bug / UI | **P1** | no | needs-hook | Day-bucketing drift = wrong-day cards. User-visible. Brief mentions cascade hardening in B2. |
| 40 | Google Sheet integration: tie a sheet to a project or account (PM-tool capability) | Sheets integration (PM-tool capability) | P2 | no | needs-hook | Design-first track (per brief §9). Overlap with Phase 1b #91 scope. |
| 39 | Add L3 hierarchy level + flexible top-level wrapper assignment | Data / hierarchy | P2 | **YES** | needs-hook | **SUPERSEDED by PR #118** (v4 shipped sections table as L3 + retainer wrapper). Close with cross-ref to #118 squash SHA b093012. |
| 38 | Categories & Status enums review across Wrapper / L1 / L2 — alignment + missing values audit | Data / schema | P2 | needs-check | needs-hook | Design-first track. May have shifted after v4 (sections got status field). Re-scope. |
| 37 | Modal owner-name convention drift (Jason vs Jason Burks) | Data-TP / cleanup | P3 | no | needs-hook | Naming normalize; small script fix. |
| 36 | Slack modal Q5: non-atomic submit allows duplicate writes on race | Slack bug | P2 | no | needs-hook | Race window; low observed frequency. |
| 35 | Inngest runway-slack-message: double-post risk on retry (missing idempotency key) | Slack / infra bug | P2 | no | needs-hook | Retry-double-post; idempotency-key add. |
| 34 | Slack bot-tools missing maxUses (CLAUDE.md compliance violation) | Slack / compliance | P3 | no | needs-hook | Compliance chore. |
| 33 | Slack modal can outlive its proposal row (silent submission loss) | Slack bug | P2 | no | needs-hook | Modal-TTL vs proposal-lifecycle mismatch. |
| 32 | Slack pickers: inactive team members surface due to silent isActive filter bypass | Slack / data bug | P2 | no | needs-hook | Filter bug; small user-facing impact. |
| 31 | Modal test row: Retainer Standard submitted with engagement_type=project (verify root cause) | Slack / data bug | P2 | needs-check | needs-hook | May be superseded by PR #119 Delta A (validator relax); re-check post-merge. |
| 30 | K3 prod backfill: audit retainers silently demoted by Bug X2 | Slack / data cleanup | P3 | no | needs-hook | `blocked` label; awaits #6 fix. |
| 29 | Bug X3 (Slack modal edit): retainer-toggle wipes form state mid-edit | Slack bug | P2 | no | needs-hook | User-facing form-state loss. |
| 28 | MCP get_week_items_by_project: default filter hides non-completed items (audit gap) | MCP / data | P3 | no | needs-hook | Default-filter surprise on MCP consumers. |
| 27 | MCP update_project_field: category not in tool-level whitelist | MCP / data | P3 | no | needs-hook | Whitelist add. |
| 26 | Undo flow: find-last + apply-undo not in transaction (race risk) | Data-cascade bug | P2 | no | needs-hook | Race in undo; low observed frequency. |
| 25 | Five zombie projects (status=completed, no L2s, no dates) — convert or delete | Data cleanup | P3 | needs-check | needs-hook | Prior-arc cleanup; verify still zombie post-recent batches. |
| 24 | Convergix Partners Page Redesign L1: out-of-enum status=scheduled | Data cleanup | P3 | needs-check | needs-hook | Verify current state post-v4. |
| 23 | Empty-string date fields in prod (cross-client data cleanup) | Data-cascade / cleanup | P2 | no | needs-hook | Cross-client data-integrity. |
| 22 | cascade-duedate: L2 dueDate sync misses startDate / endDate / dayOfWeek columns | Data-cascade bug | **P1** | no | needs-hook | Sync gap on child date columns. Fits B2 hardening. |
| 21 | updateProjectField: startDate/endDate writes rejected, forced into overrideProjectDate | Data / API friction | P3 | no | needs-hook | API-shape smell. |
| 20 | linkWeekItemToProject: silent wrapper-date clobber when wrapper has no L1 children | Data-cascade bug | **P1** | no | needs-hook | Silent clobber = data loss. Fits B2 hardening. |
| 19 | cascade-date-change: parent date recompute emits no audit row | Data-cascade / audit gap | P2 | no | needs-hook | Audit-trail gap; hard to debug cascades without it. |
| 18 | Post-Track-4 cleanup bundle (PR #97 gate cleared — 6 small items) | Cleanup bundle (roadmap B4) | P2 | no | needs-hook | Named in roadmap; label:critical but batch-candidate. |
| 16 | Parent date override clobbered by child-triggered recompute (data-tp CRITICAL) | Data-cascade bug (CRITICAL) | **P1** | no | needs-hook | Label:critical, priority:high. Named in brief §8 as B2 milestone item. |
| 12 | Resourcing flag redesign — current count metric is not actionable (PRIORITY, needs design) | Dashboard / enhancement | P2 | no | needs-hook | Design-first track (per brief §9). PRIORITY-labeled but no active design cycle. |
| 11 | Cascading picker (Client → Project → Task) for edit slash flow | Slack enhancement | P2 | no | needs-hook | UX enhancement; needs-design. |
| 10 | Task attachments: files, images, and links pinned to Runway tasks | Card UX enhancement | P2 | no | needs-hook | Feature expansion; not roadmap-current. |
| 7 | google-api skill: 403 on shared Drive docs (missing supportsAllDrives flags) | External / skill bug | P2 | no | needs-hook | Cross-repo skill fix (google-api); low blast on Runway itself. |
| 6 | Slack modal Bug X2: /runway-edit-project silently demotes retainers to projects | Slack / data bug | **P1** | needs-check | needs-hook | Named as blocker for #30 backfill. Verify still repros post-v4 hierarchy + Delta A validator. |
| 2 | fix: job tracker throws 500 when DATABASE_URL is not configured | Bug / infra | P3 | no | needs-hook | Env-var-missing error handling. |
| 1 | chore: remove deprecated npx flags from dev:inngest script | Chore | P3 | no | skip | good-first-issue label; low-effort. |

## Lane summary counts

| Lane | Count | P0 | P1 | P2 | P3 | Close-yes | Close-needs-check |
|------|-------|----|----|----|----|-----------|-------------------|
| Sheets integration | 3 (#40, #91, #92) | 0 | 1 (#91) | 2 | 0 | 0 | 0 |
| Slack (bugs + broadcast) | 13 (#6, #11, #29, #30, #31, #32, #33, #34, #35, #36, #51, #58, #94) | 0 | 1 (#6) | 8 | 4 | 0 | 2 (#31, #58) |
| Data-cascade / dates / audit | 16 (#16, #19, #20, #21, #22, #23, #24, #25, #26, #27, #28, #37, #38, #43, #68, #86) | 0 | 4 (#16, #20, #22, #43) | 6 | 6 | 0 | 3 (#24, #25, #38) |
| UI polish / dashboard | 8 (#46, #56, #60, #72, #73, #74, #75, #85) | 0 | 0 | 3 | 5 | 0 | 0 |
| Enhancements / roadmap | 7 (#10, #12, #39, #67, #87, #95, #96) | 0 | 0 | 5 | 0 | **1 (#39)** | 1 (#67) |
| Auth / security | 4 (#52, #59, #88, #90) | 0 | 2 (#52, #88) | 2 | 0 | 0 | 0 |
| Perf / infra | 10 (#2, #7, #44, #45, #47, #48, #50, #55, #57, #97) | 0 | 2 (#44, #97) | 4 | 4 | 0 | 0 |
| Housekeeping / chore | 4 (#1, #54, #69, #77) | 0 | 0 | 0 | 4 | 0 | 0 |
| Older bundles | 1 (#18) | 0 | 0 | 1 | 0 | 0 | 0 |
| **TOTAL** | **66** | **0** | **10** | **31** | **23** | **1 (#39)** | **6** |

## Notes for exec-triage step 4

1. **#39 close-candidate is strong.** PR #118 shipped v4 4-level hierarchy with `sections` table (L3) + retainer engagementType + wrapper-assignment invariants. #39 title "Add L3 hierarchy level + flexible top-level wrapper assignment" is exactly what shipped. Recommend close with cross-ref to squash SHA b093012.

2. **P1 count = 10** across all lanes:
   - Auth: #52, #88 (metadata leak + JSON API bypass)
   - Cross-user cache: #44
   - Timezone drift: #43
   - Data-cascade critical: #16, #20, #22, #86 (bundle A deferrals)
   - Integration: #91 (Phase 1b active workstream)
   - Deploy infra: #97 (post-merge smoke gate; SOP 5.5 residual)
   - Slack data-integrity: #6 (X2 retainer demote)
   
   Four of these (#16, #20, #22, #86) fit brief §8 B2/B3 milestone hardening scope. Two (#52, #88) are security. All P1 items should get triage attention this cycle.

3. **Six needs-check items** (#31, #58, #67, #24, #25, #38) may already be shipped or superseded by v4 / PR #119. Verify in step 4 before assigning triage effort. #67 especially — v4 retainer + sections may have addressed most of it.

4. **Design-first track** (per brief §9 Next Steps): #12, #38, #39, #51 — of these, #39 supersedes, #38 needs re-scope post-v4, #12 + #51 still stand as design-first. Overlap with #96 + #95 (both new this arc).

5. **Fleet-board hook status = needs-hook for all 66** (my knowledge; verify against Fleet board `github.com/users/jasonburks23/projects/1/views/1`). Exec-triage step 4 owns the hookup execution.

6. **Cross-repo D-07 caveat still open:** `Fixes jasonburks23/_R1#<n>` in upstream PR bodies does NOT auto-close because `runway` is not the default branch on upstream fork. Manual `gh issue close` required post-merge. Bank as durable operational fact if not already in DECISIONS.

## What this pre-triage does NOT do

- No issue-body deep reads (per dispatch scope)
- No Fleet-board hookup execution (post-exec-triage)
- No close-execution (post-exec-triage)
- No new issue creation
- No re-scope of `needs-check` items (verification pending in step 4)

## Sequencing recco for exec-triage step 4

Per-lane parallel between Overwatch + Ops + Holdout. Suggested lane assignment based on role fit:
- **Overwatch:** Enhancements + roadmap (#10, #12, #87, #95, #96) + design-first (#51) + close-decisions (#39)
- **Ops:** Data-cascade / dates / audit (16 items, largest lane, fits SOP-authorship for cascade discipline) + Housekeeping
- **Holdout:** Slack (13 items, blind-verification fits bug-verify class) + Auth/security (4 items, adversarial-read strength)
- **Runway-TP (me):** Sheets integration (3 items, active workstream) + UI polish + Perf/infra

**Sub-recco:** run needs-check items (6) in parallel batch first — result set may prune total triage load by 30-40% before per-lane work starts.
