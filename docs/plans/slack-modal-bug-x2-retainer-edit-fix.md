# Bug X2 — retainer edit silently demotes engagement_type (DEFERRED)

**Tracked as Batch K** (R1 TP). K1 = this fix. K2 = Bug X3 (retainer toggle wipes state in edit mode, separate root cause, do not conflate). K3 = prod backfill of already-demoted retainers (data-tp dispatch, runs after K1/K2 PR merges). Shape: 1 PR (K1+K2 atomic commits, same edit modal correctness area) + 1 data-tp dispatch (K3 backfill).

**Status:** Deferred from PR `feature/slack-modal`. Three fix attempts failed in live ngrok QA on 2026-05-05 PM. Operator chose to ship the PR without this bug closed because the rest of the slack-modal work (Bug X1, Tests 1-6, 7-resources-preserve, plus 5/6 retainer create scenarios) is solid and the PR has been in flight too long.

## Symptom

When `/runway-edit-project <retainer_name>` opens the edit modal:

1. The "This is a retainer wrapper" checkbox renders **unchecked** even on a row with `engagement_type: "retainer"`.
2. Submitting any unrelated edit (e.g. only Notes change) silently rewrites `engagement_type` back to `"project"`.
3. The DM confirmation surfaces this: "Updated. <name>: changed engagementType, notes." instead of "changed notes" alone.

Verified live on 2026-05-05 PM with two retainer rows (`TEST Retainer Standard`, `TEST Retainer Wrapper 2`). Both opened unchecked despite `engagement_type: "retainer"` in prod Turso. The first one was demoted by an edit-only-Notes save; the second was reproed but cancelled before submit (so its data is intact).

## Why this matters

Every existing retainer in prod that any user touches via `/runway-edit-project` will be silently demoted. Not just QA test data — Convergix, Source, Hop, TAP retainer wrappers are all vulnerable.

## What was tried

### Commit `80daa7a` (failed)

Hypothesis: `buildModalView` at `src/app/api/slack/commands/route.ts:157-178` always passed `retainerMode: false` to `buildProjectModal`. Fix derived `retainerMode` from `input.currentValues?.engagementType === "retainer"` for edit mode.

Test: passed (route.test.ts, mocked viewsOpen). Live: still rendered unchecked.

### Diag pass (uncaptured)

Added `console.log("[diag-retainer]", { mode, engagementType, cvKeys, retainerMode })` at the derivation site. Operator did not run a fresh slash command between adding the diag and choosing to defer, so the log was never captured. The diag has been removed from `route.ts` to keep the working tree clean for the PR.

## What we know is correct

- `loadEntityById` (`src/lib/slack/load-entity-by-id.ts:55`) projects `engagementType: projects.engagementType` for project rows. The DB row HAS the value (`engagement_type: "retainer"` confirmed via `npx tsx scripts/inspect-recent.ts "TEST Retainer Wrapper 2"`).
- Schema column is `text("engagement_type")` mapped to camelCase `engagementType` in Drizzle (`src/lib/db/runway-schema.ts:43`).
- `buildModalView` is only called from `openEditModalSingleMatch` (`route.ts:518-550`) and the multi-match path (~`line 480-503`). Single-match path passes `currentValues: { ...row }`.
- The fuzzy-name slash command path (operator typed "TEST Retainer Wrapper 2") resolves via `loadFuzzyEntitiesByKind` → `fuzzyMatchCandidates` → 1 match → `loadEntityById` → `openEditModalSingleMatch` (`route.ts:444-475`). Same final path as the ULID lookup.
- `buildProjectModal` does correctly render `is_retainer_block` with `initial_options` checked when `retainerMode: true` is passed (`src/lib/slack/modals/project.ts:273-289`). Verified by passing tests in `project.test.ts`.

## Lead hypothesis: same Slack input-element caching pattern that broke Bug X1

Bug X1 (Range-shape edit modal rendering Single-day) had structurally identical symptoms — JSON payload was correct, Slack ignored it. Root cause turned out to be a documented Slack quirk:

> **Slack input elements (radio_buttons, checkboxes, etc. inside an input block) cache their `initial_option` / `initial_options` / `initial_value` from the FIRST render and silently ignore subsequent `views.update` payloads that try to change the initial state.** Once a block with a given `block_id` has been rendered to the user, Slack treats it as carrying user state and refuses to overwrite that state from server-side initial-value changes. The element only honors `initial_*` on FIRST APPEARANCE of that `block_id` in the view's lifetime.

### How X1 was fixed (commit `e610b52`)

In task.ts, the multi-match disambiguation flow opened `views.open` with `currentValues = null` and rendered `date_type_block` with `initial_option: Single` (the default). User then picked a candidate → `views.update` sent `initial_option: Range` → Slack ignored it → user saw Single + empty date picker on a Range-shaped row.

Fix: gate `date_type_block` on `!inDisambiguationPhase` so the radio block is **omitted entirely** from the disambiguation render. After pick, the block appears for the FIRST TIME in the view's lifetime, and Slack honors the correct `initial_option` fresh. Block cache key is `block_id`; a previously-absent block_id is treated as new.

### Why this might explain X2

Project edit-modal flow:

1. `views.open` from slash command. `buildProjectModal({ retainerMode: false (pre-fix) or derived (post-fix), currentValues: row })`. `is_retainer_block` rendered with `initial_options: []` for non-retainer (or `[option]` for retainer post-fix).
2. Possibly an immediate `views.update` (cascade rebuild from `interactivity/route.ts` for client/parent picker plumbing) re-renders the same block_id with the same/different `initial_options`.
3. Slack caches state from step 1 and ignores step 2.

Pre-fix: step 1 sent `initial_options: []` (unchecked). Post-fix: step 1 sends `initial_options: [option]` (checked) only if `engagementType === "retainer"`. If the post-fix code is actually running, step 1 SHOULD render checked.

If step 1 still renders unchecked despite the fix, X1's caching mechanism doesn't apply — the bug is upstream of the render. If step 1 renders checked but step 2 overrides to unchecked... then it does apply, and the same fix pattern (suppress block on initial render, let it appear fresh on update) is the path forward.

### Fix-pattern candidates (do NOT pre-implement, need diag data first)

- **A. Block-id swap.** Change `block_id` to `is_retainer_block_<retainerMode>` so toggling generates a new block. Slack treats it as fresh and honors `initial_options`. Tradeoff: any state inside that block is lost on toggle (acceptable for a checkbox).
- **B. Suppress on first render.** Skip `is_retainer_block` on `views.open` (render with the engagement_type as a read-only context block instead), then on the first `views.update` add the checkbox with the correct `initial_options`. Mirrors the X1 fix pattern exactly.
- **C. Avoid the cascade rebuild for project edits.** If H4 turns out to be true (an unbidden `views.update` runs after `views.open`), suppress that rebuild for the project edit single-match path.

## Hypotheses to investigate

Listed in order of likelihood given what we eliminated:

### H1: HMR / dev server stale module

The dev server (PID 67377 at 2026-05-05 PM) has been running through several edits without restart. Turbopack HMR might not have picked up the `buildModalView` change. The diag would've confirmed/disproved this, but was never captured.

**Test:** Restart dev server fresh, then live-fire `/runway-edit-project TEST Retainer Wrapper 2`. If pre-checked → HMR was the issue, fix is correct. If still unchecked → continue down the list.

### H2: `loadFuzzyEntitiesByKind` returns a different row shape than `loadEntityById`

The fuzzy candidates fetcher might project a thinner column set than `loadEntityById`. The single-match path then re-fetches via `loadEntityById(spec.kind, single.id)` (`route.ts:464`) — this should restore the full projection. But verify the fetched row actually has `engagementType`.

**Test:** Add a log inside `openEditModalSingleMatch` BEFORE the `buildModalView` call: `console.log("[diag-row-shape]", JSON.stringify(row))`. The output will show whether `engagementType` is on the row at the time of the call.

### H3: views.open caching / mode plumbing

`buildModalView` rebuilds the view object each call, so caching shouldn't apply. But check whether Slack's `views.open` is being called with the latest `view` object, or whether some intermediate mock/stub is intercepting.

**Test:** Add a log at the `getSlackClient().views.open(...)` call site (`route.ts:534`) that JSON-stringifies `view.blocks.find(b => b.block_id === "is_retainer_block")` to see what blocks Slack actually receives.

### H4: A second view-builder path for project edits

There may be a `views.update` firing immediately after `views.open` (e.g. cascade rebuild from `interactivity/route.ts`) that rebuilds the modal without `currentValues.engagementType` populated. This would mirror the Bug X1 mechanism (Slack input element caches state from the first render).

**Test:** Watch `/tmp/dev-current.log` for back-to-back POST `/api/slack/commands` followed by POST `/api/slack/interactivity` in the immediate window after the slash command. If interactivity fires unbidden, inspect what it rebuilds.

### H5: Slack checkbox input element has the same caching quirk as radio_buttons

This is the lead hypothesis (see top section). Bug X1's caching mechanism applies if and only if the modal experiences a `views.open` → `views.update` sequence within the user's first interaction window, AND the FIRST render had `initial_options: []` (or absent) for the checkbox.

The single-match slash flow (`openEditModalSingleMatch`) opens the modal directly with row data — no disambiguation phase, no implicit second render. So strictly speaking X5 should NOT apply unless an external rebuild (cascade, retainer toggle handler from prior session memory, etc.) fires unbidden.

**Test:** If H1 (HMR) and H2 (row shape) confirm the post-fix server code is correct AND the row DOES carry `engagementType: "retainer"`, then X5 is the explanation. Move directly to fix candidates A or B above.

## Out-of-scope from this deferral

- **Bug X3** (separate task): toggling the retainer wrapper in EDIT mode wipes all currentValues and renders the modal as "New retainer" create-mode. Tracked as task #16. Not the same root cause as X2 — X3 is the in-modal toggle handler losing state; X2 is the initial render not honoring the row's stored value.

## Existing prod corruption to backfill (when X2 lands)

When this fix lands, audit prod for retainers that may have been silently demoted to `engagement_type: "project"` by prior edits. Cross-reference `parent_project_id` references — any project that has children pointing at it via `parent_project_id` is functionally a retainer wrapper, regardless of its current `engagement_type` value. Backfill via the data-integrity TP cohort migration pattern.

## Files touched in the failed fix attempt (kept in PR)

- `src/app/api/slack/commands/route.ts:157-178` — `retainerMode` derivation in `buildModalView` (commit `80daa7a`). Logically correct, fails live.
- `src/app/api/slack/commands/route.test.ts:39-44, 413-446` — fixture row + 2 tests asserting retainerMode plumbing for non-retainer and retainer rows. Tests pass.

The fix is shipped as-is in the PR even though it doesn't fully resolve X2 in production, because:

1. It's the correct first step (the dispatcher MUST derive retainerMode in edit mode; hardcoding `false` is wrong).
2. Removing it would re-regress to the worse baseline.
3. The fix is covered by tests so future debugging starts from a known-good unit-level baseline.

## Verification commands

```bash
pwd                                  # /Users/jasonburks/Documents/_AI_/_R1/.worktrees/slack-modal
git log --oneline -5                 # 80daa7a should be present
npx tsx scripts/inspect-recent.ts "TEST Retainer Wrapper 2"  # current row state
grep -a "\[diag-retainer\]" /tmp/dev-current.log              # if diag is re-added
```

The fresh retainer `TEST Retainer Wrapper 2` is intact in prod (engagement_type=retainer) and is the canonical reproduction target. Don't edit it via the modal until X2 is fixed, or it will get demoted.
