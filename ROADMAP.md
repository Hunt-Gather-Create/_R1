# Roadmap — Runway

**GitHub Issues is the source of truth** for individual items: https://github.com/jasonburks23/_R1/issues

This file defines the two-track structure (Phased Build XOR Continuous Tracks) and the
current sequencing. Every open issue has ONE primary home: a milestone (Phased Build) OR
a continuous-track label.

**Last refreshed:** 2026-05-23

---

## Phased Build (milestones)

Sequential work with done criteria. Each milestone terminates. Maps 1:1 onto branches.

| Milestone | Branch | Issues | Done when… | Status |
|---|---|---|---|---|
| **B1 — Auth gate** | `fix/13-runway-password-gate` | #13 | `/runway` accessible only behind shared password gate at `/runway/auth` | ✅ Shipped (PR #103) |
| **B2 — Data-cascade root hardening** | `fix/cascade-root` | #15, #16, #17 | Validator + concurrency + clobber fixed; helper layer stable | 🔴 Queued (next up after this PR) |
| **B3 — Data-cascade follow-ups** | `fix/cascade-followups` | #4, #5, #8 | Cascade cluster fully closed; depends on B2 | 🔴 Queued |
| **B4 — Cleanup grab-bag** | `chore/cleanup-grab-bag` | #18, #40, #41, #49 (+ #3 done in PR #104) | Low-risk small fixes batched and shipped | 🟡 Partially done via PR #104 |
| **B5 — Slack modal retainer-edit** | `fix/slack-modal-bug-x2` | #6, #28 | `/runway-edit-project` no longer demotes retainers; retainer toggle preserves state | 🔴 Queued |
| **B6 — K3 prod backfill (data only)** | data-only via DI-TP | #29 | Silently-demoted retainers restored; depends on B5 | 🔴 Queued |
| **B7 — Slack data correctness** | `fix/slack-correctness` | #31, #32, #33, #34 | Inactive members filtered; modal lifecycle stable; idempotency keys present | 🔴 Queued |
| **B8 — Card UX** | `feat/card-ux` | #9, #10, #11 | Click-to-complete + attachments + cascading picker (#11 needs design first) | 🔴 Queued |
| **B9 — Infra cleanup** | `chore/infra-cleanup` | #45, #46, #47, #48 | FK indexes added; lint warnings cleared; Inngest app renamed; worktree script fixes | 🔴 Queued |
| **B10 — Concurrency hardening follow-up** | `fix/concurrency-followup` | #44, #50 | TTL leak fixed; parallelization research closed; depends on B2 | 🔴 Queued |
| **B11 — Slack misc / Q5** | `fix/slack-misc` | #35, #36 | Non-atomic submit + engagement-type bug closed | 🔴 Queued |
| **B12 — Data-cascade chores** | `chore/cascade-chores` | #19–#27, #30 | Audit emissions, validators, MCP whitelists, owner-convention drift | 🔴 Queued |

### Design-first track (sequenced separately, gated on operator alignment)

These need operator-aligned spec before any code work:

| # | Title | Recommended order |
|---|---|---|
| #12 | Resourcing flag redesign | First |
| #51 | "What's on my plate" bot revamp | Second |
| #38 | Categories & Status enums review | Third |
| #39 | L3 hierarchy + flexible top-level wrapper | Fourth |
| #37 | Google Sheet integration | Fifth |
| #43 | Three competing timezone models | Could fold into B4 cleanup |

---

## Continuous Tracks (labels)

Ongoing work that never terminates; holds a quality target. Open-ended membership.

| Track label | Quality target | Issues currently in track |
|---|---|---|
| `track:data-integrity` | No prod data corruption surviving > 24h after detection. Every prod write through DI-TP. | (all data-cascade + data-tp items as supporting labels; primary-home is a milestone above) |
| `track:design-debt` | All `needs-design` items have an operator-aligned spec within 7 days of being filed | #12, #38, #39, #51 (also live in design-first track above) |
| `track:reliability` | No P0 bug open > 7 days | (cross-cutting; not primary home for any issue) |
| `track:cost` | LLM token cost per workspace stays within tracked budget; no Sonnet sneak-ups | (cross-cutting; not primary home for any issue) |

Continuous tracks are *supporting* labels for visibility, not primary homes. Every issue's
primary home is a milestone above (B1..B12) or the design-first track.

---

## Critical bundle visibility

Issues currently labeled `critical` (8 total) and their primary-home milestone:

| # | Title | Milestone |
|---|---|---|
| ✅ #3 | Dashboard auto-promote | B4 (closed via PR #104) |
| #5 | Cascade on-hold | B3 |
| #8 | Retainer wrapper guard | B3 |
| ✅ #13 | Public auth exposure | B1 (closed via PR #103) |
| #15 | updateProjectStatus validator | B2 |
| #16 | Parent date clobber | B2 |
| #17 | _currentBatchId concurrency | B2 |
| #18 | Post-Track-4 bundle | B4 |

Quick filter: https://github.com/jasonburks23/_R1/issues?q=is%3Aissue+is%3Aopen+label%3Acritical

---

## Conventions

- **Source of truth:** GitHub Issues. This file is the strategy / sequencing view, not a parallel tracker.
- **One PR per milestone branch.** Multi-close via `Fixes jasonburks23/_R1#N, #M, #O` in PR body.
- **Pre-plan docs** for active CC handoffs live in `docs/plans/<branch>-fix.md`. Plans whose PRs ship are archived to `docs/plans/archive/`; any locked architectural decisions in them graduate to `DECISIONS.md`.
- **`needs-design` label** = operator alignment required before any code.
- **`batch-candidate` label** = small enough to bundle with another PR.

---

## What's NOT here

- Per-issue CC handoff details — live in `docs/plans/<branch>-fix.md` files alongside this roadmap.
- Skill v4 patch tracking — lives in `docs/plans/data-tp-skill-v4-triage.md`, owned by DI-TP.
- Historical session logs — live in private memory.
- Closed / shipped work history — GitHub PR + issue history is the durable record.
