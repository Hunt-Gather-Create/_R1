# TP-STATE — Runway

Long-form TP state, decisions, alignment notes. Per-session pointer at `.tp/TP-HANDOFF.json`. Protocol at `docs/runway-data-tp-protocol.md`.

---

## Roles active on Runway

- **`data-integrity`** — owns all Runway prod data writes. Runs from main repo path. Pairs with `data-evaluator` for high-risk batches. (Skill: `/data-integrity-tp`)
- **`data-evaluator`** — independent cross-check on data-integrity's specs before high-risk applies. (Skill: `/data-evaluator-tp`)
- **`driver` / `monitor`** — engineering TP roles. Coordinate with CC sessions on worktrees for code work.
- **`engineer`** — CC executor for engineering work. Always runs in a worktree.

Data-integrity does not pair with engineer CC directly — engineering-side prod-write needs (e.g. backfill after a schema change) route through engineering TP → data-integrity for the actual write.

---

## Launch sequences

**Data-integrity (the most common TP for this project):**
```bash
cd /Users/jasonburks/Documents/_AI_/_R1
export TP_ROLE=data-integrity
claude
```

**Engineering driver:**
```bash
cd /Users/jasonburks/Documents/_AI_/_R1
export TP_ROLE=driver
claude
```

**Engineering CC (in a worktree):**
```bash
cd /Users/jasonburks/Documents/_AI_/_R1/.worktrees/<phase-name>
export TP_ROLE=engineer
claude
```

---

## Long-running engagements

### Hopdoddy
- Brand Refresh launched 5/21. Retainer maintenance work for June (Global Nav, Homepage, Culture, Sourcing, Happy Hour, Rewards, Careers, Locations) added 2026-05-28.
- Brand Refresh Revisions L2 unparented 2026-05-28 PM to fix Gantt rendering for retainer-direct WIs.
- Careers Page status set to blocked 2026-05-29 (waiting on Hopdoddy brief + evergreen blog).
- Status Doc: https://docs.google.com/spreadsheets/d/1tCf4uu-Ht-rXjYmp04i2J-w8X4RevkQmsOqed_0kDRU/

### High Desert Law (HDL)
- Website Build L1 active, launch target 7/7.
- Overnight 2026-05-28 alignment pass closed out 6 WIs, updated Production Shoot in Bend (6/28→7/1, Director Jay + Client Dave + Client Katie), Post-Shoot Editing placeholder 7/2→7/31, new SEO Feedback Implementation WI.
- 5 follow-up flags for 6/3 status meeting at `docs/tmp/morning-state-report-2026-05-28.md`.

### EDF
- L1 renamed to "Project 4 Change" 2026-05-29. Pitch deck pitched to Lauren 5/29 PM.
- Tuesday 6/2 follow-up WI ("Pitch Meeting Feedback from Lauren") scheduled with Kathy.

### LPPC
- Website Revamp launched 5/11. Phase 2 scoping in flight 5/28→6/5.
- Webflow training for Bill scheduled Thursday 6/4 with Leslie.

### Hermitage (new client as of 2026-05-29)
- Bootstrap: client + L1 BI Power Reports - Middleware + intro-call WI Monday 6/1 + Pipeline ($20K, scoping).

### Convergix
- All Convergix data work HELD pending 2026-05-29 status meeting outcome processing.
- 17 L2s under 1H Convergix Retainer + New Capacity L1 with multiple in-flight workstreams.
- Big Win Template and Digital Twin specifically parked pending status call.

---

## Recent decisions

- **2026-05-28:** Skipped guardrail safety-net ticket in favor of structural fix #67 (wrapper layer + subtasks + checkbox UX). Operator prefers single structural fix over throwaway guardrails.
- **2026-05-28:** Hopdoddy Brand Refresh Revisions L2 → top-level L1 to fix retainer-wrapper Gantt classification bug. Single field change (`parentProjectId` → null).
- **2026-05-29:** Convergix held across all stale-sweep buckets until after status call. Sequence will be A → C → F → B (excl Convergix) → all Convergix after status.
- **2026-05-29:** Role allowlist extended with `data-integrity` and `data-evaluator`.

---

## Open gaps surfaced

- **Worktree-on-data-tp anti-pattern** discovered 2026-05-30. Data-TP work for 2026-05-28/29 ran inside `.worktrees/cascade-root-b2` (an engineering branch). Outputs landed in paths the operator couldn't easily find. Going forward: data-TP runs from main only.
- **Migration scripts uncommitted** — 8 scripts from 2026-05-28/29 sit on the worktree branch. New session will sweep these to a `chore/runway-migrations-2026-05-28-29` branch off main per the worktree-cleanup task.
- **Stale-sweep remediation** (Bucket A flips, Bucket C/F closeouts) — paused after operator approval to ship Bucket A. New session resumes here.
- **Playwright visual QA blocked** — needs `RUNWAY_SMOKE_PASSWORD` in `.env.local`.
