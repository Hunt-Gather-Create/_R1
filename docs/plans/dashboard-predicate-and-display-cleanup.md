# Dashboard predicate + display cleanup (5-issue bundle)

**Created:** 2026-05-18
**Authored by:** R1 TP
**Audience:** Fresh Claude Code session in a new worktree
**Branch base:** `upstream/runway`
**Branch name:** `feature/dashboard-predicate-cleanup`
**GitHub issues closed:** #3, #4, #41, #49, #53

---

## TL;DR

Five unrelated cleanup items shipped in one bundle because they all touch the runway dashboard's predicate / display layer and have low blast radius. Two are operator-tagged `critical` (#3, #53); one is `priority:high` (#4); two are `priority:low` (#41, #49).

The bundle is intentionally small: ~6 files touched, all under `src/lib/runway/` + `src/app/runway/`. No schema changes. No new helpers beyond what each issue requires.

**Sequence within the branch (recommended):** #3 → #53 → #4 → #41 → #49. Predicate work first (#3 + #53 share the same file), then enum hardening (#4 — biggest scope), then the two UI nits (#41, #49). Tests woven into each step, not appended.

---

## What this bundle is NOT

- **Not a cascade root-cause fix.** Issues #15/#16/#17 land separately in Branch 2 (see `docs/plans/roadmap.md`). The data-cascade helpers from that branch are NOT a dependency for this one.
- **Not a data backfill.** Convergix has out-of-enum rows (e.g., `status="scheduled"` L1) — those are owned by data-tp, not this PR. Surface if encountered; do not fix.
- **Not the auth fix.** PR #13 (`feature/auth-runway-page-fix`) ships separately and lands first. See "Auth dependency" below.

---

## Auth dependency (corrected 2026-05-18 PM — new password-gate branch supersedes prior WorkOS attempt)

**Pivot 5/15 (Tim):** the WorkOS-extension approach (`feature/auth-runway-page-fix`) is being **abandoned**. The in-flight auth fix is now `fix/13-runway-password-gate`, off `upstream/runway`. It uses a shared-password route gate instead of extending WorkOS for non-workspace users. Any prior TP / pre-plan references to authkit-nextjs upgrades, `src/proxy.ts`, or `src/app/runway/layout.tsx` belong to the abandoned approach — disregard.

**Relevant new-auth-branch surface for this cleanup:**

| File | Change | Why we care |
|---|---|---|
| `src/app/runway/page.tsx` → `src/app/runway/(gated)/page.tsx` | **Renamed (route group)** | This cleanup edits `page.tsx`. After auth lands, our edits live at the new path. |
| `src/app/runway/page.test.tsx` → `src/app/runway/(gated)/page.test.tsx` | **Renamed (route group)** | Same — test moves with the page. |
| `src/lib/runway/auth-cookie.ts` | **New** | Auth-only; do not edit. |
| `src/app/runway/auth/*` (page, actions, form, tests) | **New** | Auth-only; do not edit. |
| `src/app/runway/(gated)/layout.tsx` | **New** — the actual auth gate | Auth-only; do not edit. |
| `.env.example` | **Modified** — adds `RUNWAY_PASSWORD` + `RUNWAY_AUTH_SECRET` | Auth-only; do not edit. |

URL is unchanged — `/runway` still resolves. The `(gated)` route group is the pattern chosen to avoid the auth-route redirect loop while keeping the URL stable.

**Conflict surface vs this cleanup bundle:**

| Cleanup file | Auth branch touches? |
|---|---|
| `src/lib/runway/plate-summary.ts` | No |
| `src/app/runway/queries.ts` | No |
| `src/app/runway/page.tsx` | **Yes — renamed into `(gated)/`** |
| `src/app/runway/page.test.tsx` | **Yes — renamed into `(gated)/`** |
| `src/lib/runway/operations-utils.ts` | No |
| `src/lib/runway/operations-writes.ts` | No |
| `src/lib/runway/gantt/themes.ts` | No |
| `src/app/runway/components/account-tier/AccountTier.tsx` | No |
| `src/app/runway/components/rundown-content-rsc.tsx` | No |

Only `page.tsx` + `page.test.tsx` are in the contested zone, and it's a path move, not a content conflict.

**Rebase plan — if auth lands first:**

1. `git fetch upstream runway`
2. `git rebase upstream/runway` on the cleanup branch
3. Git's rename detection will move our `page.tsx` + `page.test.tsx` edits into `(gated)/page.tsx` + `(gated)/page.test.tsx` automatically in most cases. If rename detection misses (e.g., we touched too many lines), `git rebase` will surface conflicts at the old path — resolve by moving the patch hunks to the new path manually.
4. `pnpm test:run` — verify no broken imports / paths after the move.
5. `pnpm build` — Next.js route resolution sanity check.
6. Continue.

**If cleanup lands first:** auth CC will sweep our `page.tsx` + `page.test.tsx` changes into the route-group move as part of their rebase. Mechanical; no editorial work for either side. First-merged-wins.

---

## Per-issue scope

### #3 — Dashboard auto-promote, items disappear mid-window (CRITICAL)

**Problem:** L2 tasks with `status="scheduled"` whose date window includes today (`startDate <= today <= endDate`) are invisible on the dashboard. Don't qualify for **In Flight** (requires `status="in-progress"`), **Today** (only `startDate=today`), or **Needs Update** (only `endDate < today`).

**Files:**
- `src/lib/runway/plate-summary.ts:151` — `filterInFlight` predicate
- `src/app/runway/components/in-flight-section.tsx` — consumer
- `src/app/runway/page.tsx` — bucket assembly

**Recco (per issue body): display-layer fix.** Broaden `filterInFlight` to include `status="scheduled" && startDate <= today <= endDate`. No data writes, no cron, no background writer.

**Acceptance:**
- [ ] The 4 task evidence rows in issue #3 body surface in In Flight on the dashboard
- [ ] Operator's last explicit status decision is preserved in the DB (we derive a "live" view, we don't mutate)
- [ ] Unit test in `plate-summary.test.ts` covers a `scheduled` item with `startDate < today < endDate`

---

### #53 — Canceled items surface in Needs Update bucket (CRITICAL)

**Problem:** `getStaleWeekItems` filters with `status != "completed"`, so `canceled` items leak into Needs Update. Canceled is terminal — should never surface there.

**Files:**
- `src/app/runway/queries.ts` — `getStaleWeekItems` (tests at `src/app/runway/queries.test.ts:216+`)

**Recco (per issue body): positive predicate.** Use `inArray(weekItems.status, ["scheduled", "in-progress", "blocked", "at-risk"])`. Future status additions then default to "not in Needs Update" unless explicitly added — safer than enumerating exclusions.

**Acceptance:**
- [ ] Convergix "Inductive Top 10 — Social Post" and "Social: Award — TI" no longer appear in Needs Update
- [ ] Test in `queries.test.ts` explicitly covers canceled-status exclusion
- [ ] No regression: scheduled, in-progress, blocked, at-risk items still surface when their `endDate < today`

**Why bundled with #3:** both are predicate-layer bugs on the same dashboard surface. Same reviewer, same test file lineage, same blast radius. Splitting them into two PRs is pure churn.

---

### #4 — L1 canceled status + WeekOf display gap (PRIORITY:HIGH)

**Detailed spec already exists at `docs/plans/l1-canceled-status-fix.md`** — that doc is the source of truth for this issue. CC must read it end-to-end before starting #4.

**Summary of scope (per the linked plan):**
1. Add `"canceled"` to `L1_PROJECT_STATUSES` set (`operations-utils.ts:1019`)
2. Decide compat-matrix behavior — recco: `canceled × canceled` is the only valid pair (option A in the linked plan)
3. Tighten `updateProjectStatus` write-path validator (`operations-writes.ts:58-209`) — accepts any string today, should whitelist the 7-value enum
4. Cascade design decision — recco: leave `CASCADE_STATUSES` unchanged (do NOT add canceled). Operator must flip child L2s explicitly.
5. WeekOf view filter parity — hide `status ∈ TERMINAL_ITEM_STATUSES` items from the active-week grid (matches `AccountTier.tsx:124-125` behavior)
6. Gantt color map — add `canceled` to `themes.ts`

**Files:**
- `src/lib/runway/operations-utils.ts` (enum + compat matrix)
- `src/lib/runway/operations-writes.ts` (validator)
- `src/lib/runway/operations-writes.test.ts` (new tests)
- `src/app/runway/page.tsx` (WeekOf filter — the specific 2026-05-12 evidence: Inductive Top 10 L1 + canceled L2 child still rendering on 5/15)
- `src/lib/runway/gantt/themes.ts` (color map)

**Acceptance:** all checkboxes in `l1-canceled-status-fix.md` §1–§6. Plus: the operator-confirmed manual UI check listed in that doc's view-audit table.

**Why bundled here:** the linked plan was originally drafted as a standalone PR. Per the latest roadmap (2026-05-15), operator moved it into Branch 4 (this bundle). #4 is the heaviest item — budget your time accordingly.

---

### #41 — AccountTier ready-to-close chip contradicts empty-L1 state (PRIORITY:LOW)

**Problem:** An L1 whose `weekItemsForSection(section)` returns zero hits the empty-L1 branch and renders "No Scheduled Tasks" — but `readyToCloseIds.has(id)` can still be true, producing a visually contradictory "No Scheduled Tasks" + "Ready to close?" chip simultaneously.

**Files:**
- `src/app/runway/components/account-tier/AccountTier.tsx` — the empty-section render path (~lines 245-260, where `items = weekItemsForSection(section)` is computed and the empty fallback fires)

**Recco:** suppress the chip when `items.length === 0`. Operator-locked rule: ready-to-close is meaningful only when there's at least one scheduled item.

**Acceptance:**
- [ ] No simultaneous "No Scheduled Tasks" + "Ready to close" chip render
- [ ] Holdout test covers the case (factory: L1 with `raw.children` non-empty, all children non-weekitem or filtered terminal, `readyToCloseIds.has(id) === true`)
- [ ] No regression on the normal ready-to-close path (non-empty section + chip)

---

### #49 — Gantt Charts tab: client headers missing collapse chevron (PRIORITY:LOW)

**Problem:** By Account tab uses `account-tier-details` CSS (`CollapsibleSection.tsx:32-50`) and shows a chevron that rotates on `[open]`. Gantt Charts tab uses parallel `gantt-charts-details` CSS (`rundown-content-rsc.tsx:43-65`) but client headers don't show a chevron — chevron rotation CSS exists, the visual affordance is missing on the client-level `<summary>`.

**Files:**
- `src/app/runway/components/rundown-content-rsc.tsx` — the three `<details className="gantt-charts-details ...">` blocks (lines ~99, ~124, ~150). One or more `<summary>` elements likely missing the `<span className="gantt-charts-chevron">` child that the CSS rotates.

**Recco:** mirror the chevron-span pattern from `CollapsibleSection.tsx:42` (`account-tier-chevron`) into every `gantt-charts-details > summary` that currently lacks one. Confirm parity with By Account at all three nesting levels (client / wrapper / L1).

**Acceptance:**
- [ ] Client headers in Gantt Charts tab show a chevron
- [ ] Chevron rotates on open/close at every tier (client, wrapper, L1)
- [ ] No regression on By Account chevron behavior
- [ ] Visual smoke on canary URL: open Gantt Charts tab, confirm all collapse affordances render

---

## Cross-cutting concerns

### Test strategy

Tests are part of each step, not appended. For each issue:
- Pure-function tests (#3, #53, #41 detector branch, #4 enum + validator) go in `*.test.ts` co-located.
- View / rendering tests for #41 + #49 can be lighter — visual smoke on canary is acceptable for the chevron, but the #41 contradiction should be unit-testable on the predicate that gates the chip.
- Run `pnpm test:run` after each issue, not just at the end of the branch.

### Sequencing within the branch

Recommended commit / step order:
1. **#3 + #53 together** (`feat(runway): broaden In Flight predicate; exclude canceled from Needs Update`) — both in predicate-layer, same review surface. Two atomic commits in one chunk.
2. **#4** in atomic steps per the linked plan's §1-§6. This is the meaty piece — budget the most time here. Anticipate `/code-review` finding test coverage gaps on the validator.
3. **#41** (`fix(runway): hide ready-to-close chip on empty section`)
4. **#49** (`fix(runway): mirror chevron affordance into Gantt Charts client headers`)

### What if scope creeps mid-build?

If a fix uncovers a related bug not in this bundle's 5-issue list:
- **In scope:** trivial cleanup / typo / obvious local fix during code-review or pr-ready
- **Out of scope:** anything that needs its own issue → file a new GH issue on `jasonburks23/_R1`, add `batch-candidate` label, drop in PR description as "discovered, filed as #N for follow-up"
- **Never:** silently expand the bundle. The operator-locked rule is one PR closes the issues it claims to close — no surprise additions.

---

## GitHub linkage (by-the-book workflow)

**Step 1 — Self-assign all 5 issues:**
```bash
for N in 3 53 4 41 49; do
  gh issue edit $N --repo jasonburks23/_R1 --add-assignee @me
done
```

**Step 2 — Comment on each issue to start the work trail:**
```bash
for N in 3 53 4 41 49; do
  gh issue comment $N --repo jasonburks23/_R1 --body "Bundled into \`feature/dashboard-predicate-cleanup\` per \`docs/plans/dashboard-predicate-and-display-cleanup.md\`. Single PR will close #3, #4, #41, #49, #53."
done
```

**Step 3 — Branch name:** `feature/dashboard-predicate-cleanup` (set up via `scripts/worktree dashboard-predicate-cleanup`).

**Step 4 — Commits:** each atomic commit body references the relevant issue(s):
```
fix(runway): broaden In Flight predicate to include scheduled-in-window L2s

[explanation]

Refs #3
```

Use `Refs #N` on individual commits. Only the PR description gets `Closes #N`.

**Step 5 — PR title:**
```
fix(runway): dashboard predicate + display cleanup (closes #3, #4, #41, #49, #53)
```

**Step 6 — PR body** ends with each closing keyword on its own line:
```
Closes #3
Closes #4
Closes #41
Closes #49
Closes #53
```

Each line auto-closes its respective issue on merge.

**Step 7 — Once PR is open**, comment on each issue with the PR URL.

---

## Branch + push routing

```bash
cd /Users/jasonburks/Documents/_AI_/_R1
scripts/worktree dashboard-predicate-cleanup

# Inside the new worktree:
git fetch upstream runway
git reset --hard upstream/runway

# Verify baseline:
pnpm test:run
pnpm build
```

After committing, push to `origin` (jasonburks23/_R1 fork) → PR against `upstream:runway`.

Vercel does NOT auto-fire preview for cross-fork PRs. Use `/canary` for cross-fork preview.

---

## Post-build pipeline (run in order, do NOT collapse)

1. `/code-review` — DRY, prop drilling, hooks/context, test coverage. Expect findings on the #4 validator test surface.
2. `/update-docs` — sync if patterns changed. The L1 enum addition in #4 may warrant a CLAUDE.md or `.claude/MEMORY.md` "Patterns" entry.
3. `/pr-ready` — debug statements, unused imports, final cleanup.
4. `/preflight` — build + grep gate + tests + lint (and `vercel build` on this runway-targeted branch).
5. `/canary` — cross-fork Vercel preview deploy. **Canary smoke:** sign in (`@civilization.agency`), confirm:
   - In Flight section shows scheduled-in-window items (#3)
   - Needs Update count drops Convergix canceled items (#53)
   - L1 canceled renders cleanly across WeekOf + By Account + Gantt (#4)
   - No empty-section "ready to close" contradiction (#41)
   - Gantt Charts chevrons render at all levels (#49)
6. `/atomic-commits` — split into focused commits per the sequencing above.
7. Operator pushes the branch + opens the PR.

**20-min Llama review sweep:** after PR is open, give Llama bot 20 minutes to surface comments. Address before requesting human review.

---

## Verification steps (must be in PR description)

- [ ] `pnpm test:run` passes (new tests for each issue)
- [ ] `pnpm build` passes
- [ ] `/preflight` clean
- [ ] `/canary` deployment READY (green) on Vercel
- [ ] Canary smoke for each of the 5 acceptance lists above
- [ ] No regression on workspaces / non-runway pages (cleanup is runway-scoped)

---

## What NOT to do

- **No silent scope expansion.** Stick to the 5 issues. New finds → new GH issue, drop in PR description.
- **No data writes.** Code-only. Convergix out-of-enum rows are owned by data-tp.
- **No touching the auth surface.** `src/lib/runway/auth-cookie.ts`, `src/app/runway/auth/*` (page, actions, form, tests), `src/app/runway/(gated)/layout.tsx`, and `.env.example` are auth branch territory — don't edit them. (You will edit `src/app/runway/page.tsx` for #3 + #4 — that's expected; auth's rebase will move our edits into `(gated)/page.tsx` via git rename detection.)
- **No `--no-verify` on commits.**
- **No reshaping cascade semantics.** Cascade root-cause hardening (#15/#16/#17) is Branch 2 — not this PR.

---

## Out of scope (explicit)

- Cascade helper refactor (#15, #16, #17) — Branch 2
- Cascade on-hold corruption (#5), retainer wrapper guard (#8) — Branch 3 (cascade follow-ups)
- Slack modal retainer fix (#6, #28) — Branch 5
- Post-Track-4 cleanup sub-bundle (#18) — separate sub-track
- AccountTier wrapper dead zone (#40) — operator pulled this out of the cleanup bundle; ship later if surfaced

---

## Operator preferences to honor

- Tests are part of each step, not appended.
- No AI voice in PR descriptions, commits, or code comments.
- Thorough PR messages: WHY + deployment notes + per-issue verification.
- QA-discovered issues fixed in this PR (no "should we fix?" asks for trivial finds).
- Atomic commits — `/atomic-commits` runs in pipeline.
- After every atomic chunk, push to `jasonburks23` fork (durable backup, not ship signal).

---

## When you're done

- [ ] All 5 issues' acceptance criteria met
- [ ] All `*.test.ts` files updated with the new coverage
- [ ] `pnpm test:run` + `pnpm build` green
- [ ] `/code-review`, `/pr-ready`, `/preflight`, `/canary` all green
- [ ] `/atomic-commits` ran
- [ ] PR description thorough per operator preference
- [ ] All 5 issues commented with PR URL
- [ ] Hand back to operator: branch is PR-ready, here's the summary + canary smoke results

---

End of plan.
