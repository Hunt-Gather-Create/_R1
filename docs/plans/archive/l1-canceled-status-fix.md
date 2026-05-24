# L1 `canceled` Status — Codebase Alignment + View Audit

**Created:** 2026-05-12
**Authored by:** Data Evaluator TP (post-Explore-agent audit)
**Audience:** Fresh Claude Code session in a new worktree
**Branch base:** `upstream/runway` (Hunt-Gather-Create) — cross-fork PR routing

---

## TL;DR

The Runway codebase is internally inconsistent about whether L1 (project) `status="canceled"` is supported. The MCP tool boundary already accepts it; the compat-matrix enum set doesn't list it; the schema is free-form text; UI rendering for L1 canceled is unverified. We're about to write `status="canceled"` to a real L1 in prod tonight (Inductive Top 10 Partner Announcement, Convergix client) — please make sure that lands cleanly and that the codebase formally supports L1 canceled across every surface that matters.

If the runway page would break on a L1 with `status="canceled"`, we'll roll back the data write. Don't ship a fix that depends on the data already being canceled — make the codebase tolerant first.

## Why this matters now

- Tonight (2026-05-12) the Data Integrity TP is writing `status="canceled"` to L1 `3bfb5df39d0247dba7e612dd4` (Inductive Top 10 Partner Announcement) because the client did not make the top 10 list. Operator-locked decision.
- Convergix already has one L1 sitting at out-of-enum `status="scheduled"` (Partners Page Redesign `0b74fe73`) — so out-of-enum drift exists in prod today, just not for "canceled" specifically.
- L2 (week_items) has fully supported `canceled` semantics for a long time (terminal, hidden from active views). L1 should match.
- Hard requirement: no runway-page crash, no view rendering regression, no MCP tool break.

## Findings already gathered (don't re-discover)

From an Explore-agent audit run 2026-05-12 PM:

### Schema (free-form, no constraint)

`src/lib/db/runway-schema.ts:32`
```ts
status: text("status"), // in-production, awaiting-client, not-started, blocked, on-hold, completed
```

The comment is documentation, not enforcement. SQLite (and Turso) accept any string.

### Write paths

- **`updateProjectStatus`** lives in `src/lib/runway/operations-writes.ts:58-209`. Writes the status string directly (line ~110). **No whitelist validation.** Accepts any string.
- **`updateProjectField`** at `src/lib/runway/operations-writes-project.ts:132-399` does NOT route status changes — explicit comment at lines 170-177 redirects callers to `updateProjectStatus`.
- **MCP tool** at `src/lib/mcp/runway-tools.ts:408-440` (`update_project_status`) uses Zod enum that **already includes `canceled`** as a 7th value alongside the standard 6.

### Read-side enum (incomplete)

`src/lib/runway/operations-utils.ts:1019-1026`:
```ts
const L1_PROJECT_STATUSES = new Set([
  "in-production", "awaiting-client", "not-started",
  "blocked", "on-hold", "completed",
]);
```

This is the 6-value set used by the status×category compat matrix at `operations-utils.ts:1056-1067`. Out-of-enum values silently bypass the compat check (`!L1_PROJECT_STATUSES.has(status) → return { ok: true }`). So today, writing `status="canceled"` to an L1 just skips compat validation entirely — there's no rejection, but there's also no compat protection.

### Cascade semantics

`src/lib/runway/operations-utils.ts:28`:
```ts
export const CASCADE_STATUSES = ["completed", "blocked", "on-hold"] as const;
export const TERMINAL_ITEM_STATUSES = ["completed", "canceled"] as const;
```

- `CASCADE_STATUSES` — L1 statuses that propagate to child L2s. **Does NOT include `canceled`.**
- `TERMINAL_ITEM_STATUSES` — L2 terminal states. **Includes `canceled`.**

Design question (operator may have an opinion): should L1 `canceled` cascade to children (auto-flip all child L2s to `canceled`)? Current answer is no — explicit cancel of L1 doesn't touch L2s. Operator's intent for tonight (Inductive specifically) is to flip BOTH L1 and L2 in one batch, so this isn't blocking. But documenting the design call matters for future cancels.

### UI rendering

- `src/app/runway/components/account-tier/AccountTier.tsx:124-125` explicitly filters L2 cards where `status === "canceled"`:
  ```ts
  r.status !== "completed" &&
  r.status !== "canceled",
  ```
  Comment at line 12: "Completed/canceled L2 cards are HIDDEN entirely from the By Account tab."
- **L1 canceled rendering is unverified.** No explicit handler found by the audit. Likely renders literal string. The risk is a status badge / color map / pill component that does enum-narrow lookups and crashes / shows garbage on out-of-enum values.

### Empirical prod check (Convergix snapshot)

Active + completed Convergix L1s as of `2026-05-12T22:11:56Z`:
- `in-production` (12)
- `not-started` (4)
- `awaiting-client` (2)
- `completed` (7)
- `scheduled` (1) — out-of-enum, on Convergix Partners Page Redesign

No L1 currently at `canceled`. Inductive will be the first.

## Scope of work

### 1. Align the L1 enum sources of truth

- [ ] `src/lib/runway/operations-utils.ts:1019` — add `"canceled"` to `L1_PROJECT_STATUSES` set. **This is the single most important change.** It tells the compat matrix that `canceled` is a recognized L1 status, so any future writes get evaluated by the matrix instead of silently bypassing it.
- [ ] Decide compat-matrix behavior for `canceled` × each category. Recommended rules:
  - `canceled` × `active` → HARD REJECT (a canceled project is not active)
  - `canceled` × `pipeline` → HARD REJECT (canceled in pipeline is meaningless; either keep in pipeline OR cancel, not both)
  - `canceled` × `awaiting-client` → HARD REJECT
  - `canceled` × `on-hold` → HARD REJECT (canceled supersedes on-hold)
  - `canceled` × `completed` → HARD REJECT (separate terminal states)
  - **No valid pair for canceled in the L1 category set** — which is itself a flag. Either:
    - **A.** Add `canceled` to `L1_PROJECT_CATEGORIES` set and make `canceled+canceled` the only valid pair (matches the L1 lifecycle model that uses category to mirror terminal status).
    - **B.** Allow `canceled` status with any category (skip the rule), but soft-warn in `validateStatusCategoryCompatibility` so it surfaces in audit logs.
  - **Recco: A.** Adds `canceled` category symmetric to `completed` category. Operator should confirm before code lands.

### 2. Tighten the write-path validator

- [ ] `updateProjectStatus` in `operations-writes.ts` accepts any string today. Add a whitelist validator that mirrors the MCP enum (`{in-production, awaiting-client, not-started, blocked, on-hold, completed, canceled}`). This closes the "writes garbage silently" loophole noted in `feedback_l1_vs_l2_status_enums.md`.
- [ ] Hooked at the helper layer so MCP, server actions, and migration scripts ALL get the same protection.
- [ ] On rejection, return `{ ok: false, error }` like the existing L2 path. Don't throw.

### 3. Cascade design decision

- [ ] Decide: should L1 `canceled` cascade to child L2s? Two options:
  - **A.** Add `"canceled"` to `CASCADE_STATUSES`. Any L1 flip to canceled auto-flips all child L2s to `canceled`. Destructive but unambiguous.
  - **B.** Leave `CASCADE_STATUSES` unchanged. Operator must flip child L2s separately (matches tonight's Inductive batch behavior).
  - **Recco: B.** Less destructive, matches current operator workflow, preserves L1-only cancellation for "client never delivered scope" cases where L2 child work was already done. Document the decision in code comment + skill memory.

### 4. View audit (the part operator specifically flagged)

**Empirical findings from Inductive APPLY 2026-05-12T23:57:00Z** (operator-confirmed manual UI check):

| View | Behavior on `canceled` L1 with `canceled` L2 child | Status |
|---|---|---|
| WeekOf — "This Week" section (5/15 Fri) | L1 wrapper + L2 card BOTH visible. L2 card shows full data including the appended "Canceled 2026-05-12: client did not make top 10 list" note. | **Display gap.** Terminal-state items should be hidden from active-week grid. AccountTier already filters; WeekOf needs parity. |
| By Account view | Inductive L1 NOT visible (filtered/hidden — wrapper-level filter when all L2 children are terminal). | **Working as designed.** Keep. |
| Gantt Charts tab | Inductive L1 visible in row list with "canceled" treatment (greyed bar / muted text). L2 child also greyed. No crash, no broken layout. | **Working.** Design call open: do we want canceled L1s hidden entirely from Gantt, or kept for historical visibility? Operator-discretion later. |

**No crashes, no garbage rendering anywhere.** The prod write of `status="canceled"` to L1 + L2 lands cleanly across all three views. The remaining gaps are filter discipline, not data integrity.

For each view below, trace what happens when an L1 has `status="canceled"`. Report findings + fix any crash / regression.

- [ ] **WeekOf View** — `src/app/runway/` page rendering by-week. Where does it filter / categorize L1 status? Files to audit:
  - `src/app/runway/page.tsx`
  - Any helper functions that group projects by status
  - **Specific scenario empirically confirmed broken (2026-05-12):** a canceled L2 dated 5/15 still surfaces in the "This Week" section of the WeekOf view, with its parent L1 wrapper also rendering. Expected: filter out items where `status ∈ TERMINAL_ITEM_STATUSES` (operations-utils.ts:34 = `["completed", "canceled"]`) from the active-week grid, matching AccountTier.tsx:124-125 behavior. Verify by reproducing on Inductive Top 10 (L1 `3bfb5df39d0247dba7e612dd4`, L2 `705dad227dee4eb7bac4d9d35`) until your filter lands and they drop out of the 5/15 column.
- [ ] **Project View / By Account View** — `src/app/runway/components/account-tier/*.tsx`. The L2 canceled filter is already in place at AccountTier.tsx:124-125. Check whether L1 canceled affects:
  - L1 wrapper display (does the L1 header show? grey it out? hide it?)
  - Category badge / status pill rendering
  - Sort order / grouping
- [ ] **Gantt View** — `src/lib/runway/gantt/`. Files to audit:
  - `src/lib/runway/gantt/filter-active.ts` — has `isL1Hidden` / `isWrapperHidden` predicates. Does L1 canceled satisfy "hidden"? Should it?
  - `src/lib/runway/gantt/themes.ts` — status color mapping. Add `canceled` to the color/style maps.
  - `src/lib/runway/gantt/gantt-section.tsx` and related — section rendering for canceled L1s
- [ ] **Dashboard panels** — `src/components/runway/*` if any. Status-flag panels that count L1s by status.
- [ ] **Slack Modal & Slack Bot** — `src/lib/slack/bot-tools.ts` and modal-builders. Does the Slack bot's `get_person_workload` or modal include canceled-L1 children? Probably should exclude (terminal state).

For each view: write a snapshot/render test using a factory L1 with `status="canceled"`. Confirm no crash, no garbage rendering, sensible filtering.

### 5. Tests (woven into each step per CLAUDE.md)

- [ ] `operations-writes.test.ts` — new tests for `updateProjectStatus` rejecting out-of-enum values (and accepting all 7 enum values including `canceled`).
- [ ] `operations-utils.test.ts` — new tests for `validateStatusCategoryCompatibility` with canceled × each category (hard rejects per §1 rules).
- [ ] View component tests for each of the views in §4. Use factory helpers (e.g., `createProject({ status: "canceled" })`).
- [ ] Gantt filter tests — `isL1Hidden` returns true for canceled.

### 6. Documentation updates

- [ ] `feedback_l1_vs_l2_status_enums.md` — update to reflect that the codebase has been aligned. Note that L1 now formally supports canceled.
- [ ] Skill v4 patch candidates list (`docs/data-tp/skill-patches/`) — add the canceled support patch as landed once this PR merges.
- [ ] PR description must document: why this matters now (Inductive prod write tonight), what changed, deployment notes, root cause of the inconsistency, verification steps including the manual runway-page visual check.

## Branch + push routing (cross-fork PR pattern)

1. Create a new worktree:
   ```bash
   scripts/worktree l1-canceled-status
   ```
   This creates `.worktrees/l1-canceled-status/` with branch `feature/l1-canceled-status` off `main`. **Then immediately rebase / reset onto `upstream/runway`** since that's the deploy target:
   ```bash
   git fetch upstream runway
   git reset --hard upstream/runway
   ```

2. Push target: `origin` (jasonburks23/_R1 fork) → PR against `upstream:runway`. Vercel does NOT auto-fire preview for cross-fork PRs — use `/canary` (Phase 4 in pipeline) to validate.

3. Do NOT auto-push. Hand the PR-ready branch back to operator with summary + verification notes.

## Post-build pipeline (run in order, do not collapse)

Per CLAUDE.md plan-execution workflow:

1. `/code-review` — DRY, prop drilling, hooks/context, test coverage
2. `/update-docs` — sync `/docs` knowledge base if patterns/versions changed
3. `/pr-ready` — debug statements, unused imports, final cleanup
4. `/preflight` — build + grep gate + tests + lint (catches `DYNAMIC_SERVER_USAGE` etc. that build alone misses)
5. `/canary` — cross-fork Vercel preview deploy. Smoke test: load `/runway` on canary URL, scroll through the views, look for crashes / broken renders. **This is the critical operator check.**
6. `/atomic-commits` — split working tree into focused commits
7. Operator pushes the branch + opens the PR

**20-min Llama review sweep:** after PR is open, give Llama bot 20 minutes to surface any review comments. Address before requesting human review.

## Verification steps (must be in PR description)

- [ ] `pnpm test:run` passes
- [ ] `pnpm build` passes
- [ ] `/preflight` clean
- [ ] `/canary` deployment is READY (green) on Vercel
- [ ] Manual smoke test on canary URL:
  - [ ] Load `/runway` — page renders, no console errors
  - [ ] Hover/scroll through By Account view — no crashes on canceled L1s
  - [ ] Toggle Gantt Charts tab — canceled L1s either hidden or rendered with no crash
  - [ ] WeekOf view — canceled L1s behave correctly
- [ ] Inductive L1 (`3bfb5df39d0247dba7e612dd4`) renders as a canceled project on canary if its data has been written by then; if not, use a manually-inserted test record

## What NOT to do

- **No prod data writes.** This is code only. Inductive's L1 write is owned by the Data Integrity TP in a separate session — do not touch runway DB rows.
- **No fixing the Partners Page Redesign `scheduled` out-of-enum row.** That's a data integrity ticket, owned by the Data TP. If your work auto-validates that row, surface it; don't fix.
- **No changing the L2 enum.** L2 already supports canceled; only the L1 surface needs hardening.
- **No reorganization beyond the §1-§4 scope** without surfacing to operator. Resist scope drift.
- **No `--no-verify` on commits.** No `--no-gpg-sign`.

## Out of scope

- L2 canceled behavior — already supported.
- New view development. Audit existing views; don't add new ones.
- The Slack Modal `awaiting-client` cancel flow (if any). Separate concern.

## Operator preferences to honor (relevant subset)

- Tests are part of each step, not appended.
- No AI voice in user-facing copy (PR descriptions, commit messages, code comments).
- Thorough PR messages with WHY + deployment notes + root causes + verification steps.
- QA-discovered issues fixed in this PR, no "should we fix?" asks.
- Atomic commits — `/atomic-commits` runs in pipeline.

## Worktree setup quick-start

```bash
# From any worktree:
cd /Users/jasonburks/Documents/_AI_/_R1
scripts/worktree l1-canceled-status

# Inside the new worktree (it auto-launches Claude Code):
git fetch upstream runway
git reset --hard upstream/runway

# Verify baseline:
pnpm test:run
pnpm build

# Then read this plan and start scope §1.
```

## When you're done

Final checklist:
- [ ] All §1–§5 changes implemented + tested
- [ ] `pnpm test:run` green
- [ ] `pnpm build` green
- [ ] `/code-review`, `/pr-ready`, `/preflight`, `/canary` all green
- [ ] `/atomic-commits` ran
- [ ] PR description drafted (thorough per operator pref)
- [ ] Hand back to operator: branch is PR-ready, here's the summary + manual canary smoke results

Good luck. Plan is the source of truth — if anything here contradicts something you discover, the plan wins until you surface a question.

---

End of plan.
