# Slackbot "What's on X's plate" — accuracy + architecture fix

**Branch:** `feature/slackbot-plate-fix` (off `upstream/runway`)
**Worktree:** `.worktrees/slackbot-plate-fix/`
**Originating eval:** Data Evaluator TP session, 2026-05-12 AM. CD: Lane test query.
**Status:** Plan written. Diagnostic + architecture audit pending.

---

## 1. The bug (one-paragraph version)

Operator queried the Slack bot for Lane's plate on Tue 2026-05-12. Bot replied "Lane doesn't have anything specifically today (Tuesday)" and listed ~10 items for Wed/Thu/Fri. Cross-check against prod surfaced:

- **0/2 of Today panel cards mentioning Lane were called out** (LPPC Post-launch Revisions 5/12, Hopdoddy Home Page revisions 5/12→5/18). Both have `start_date=2026-05-12`.
- **6/13 of In Flight panel cards mentioning Lane** were listed; 4 were missed (Full-Page Ad, Cover Image, New Capacity One-Pager Kickoff, Hopdoddy Overall Typography).
- **~21 active L2s** on Lane this week per `getPersonWorkload`; bot named ~10.
- Bot analytical summary "four blocked all on messaging approval" was wrong on 2 of 4 (mixed messaging-approval and R1-feedback blockers).

Full eval lives in the originating conversation. Prod snapshot for verification: `docs/tmp/lane-plate-prod-snapshot-2026-05-12.txt`. Eval script: `scripts/runway-migrations/_eval-lane-plate-2026-05-12.ts` (read-only, re-runnable).

## 2. Architectural root cause (most consequential finding)

`getPersonWorkload` (`src/lib/runway/operations-reads-week.ts:397`) buckets L2s into `{ overdue, thisWeek, nextWeek, later }`. **There is no `today` bucket in the data layer.** The bot prompt (`src/lib/runway/bot-context-sections.ts:126,151-155`) instructs the LLM to derive "today" from `thisWeek`:

> "Lead with concrete work: 'You have [L2 title] [bucket context]' where bucket context = 'today', 'this week', 'overdue', 'next week', or 'later'."
> "Time ladder — if today is empty, keep looking forward: Today empty? 'Today looks clear, but tomorrow you have...'"

The data structure doesn't carry `today` as a key, so the LLM has to derive it from `thisWeek[].startDate == today`. The LLM dropped that derivation step for Lane and said "nothing today." **This is the structural failure that needs fixing.**

Additional architectural issues:

- **No `inFlight` bucket either.** Multi-day in-progress items (e.g., Cover Image 5/4→5/18, status=in-progress) live in `thisWeek` because `bucketWeekItem` has a "spans current Monday" fallback (`operations-reads-week.ts:373-375`). The LLM sees them but can't tell they're "currently working on" vs. "starts later this week." `filterInFlight` already exists in `plate-summary.ts:151` with the right semantic (`start < today <= end AND status==in-progress`) — just not wired into `PersonWorkload`.
- **Stub filter over-hides** L2s under `awaiting-client` L1s (`operations-reads-week.ts:425-429`). Hides ALL children. New Capacity One-Pager Kickoff (5/11→5/13, in-progress, CD: Lane) was correctly filtered by the rule but is the L2 *that closes the awaiting-client wait*. Edge case worth re-evaluating: should `status='in-progress'` L2s under awaiting-client parents still surface?

## 3. Recommended fix shape (subject to Phase 1 validation)

### 3.1 Data-layer partition

Modify `PersonWorkload.weekItems` from:

```ts
{ overdue, thisWeek, nextWeek, later }
```

to:

```ts
{ overdue, today, inFlight, thisWeek, nextWeek, later }
```

Bucket definitions:

| Bucket | Condition |
|---|---|
| `overdue` | `(endDate ?? startDate) < today AND status != 'completed'` *(unchanged)* |
| `today` *(new)* | `startDate == today` |
| `inFlight` *(new)* | `status == 'in-progress' AND startDate < today <= (endDate ?? startDate)` |
| `thisWeek` *(narrowed)* | `startDate > today AND startDate <= thisSunday` |
| `nextWeek` | `startDate in [nextMonday, nextSunday]` *(unchanged)* |
| `later` | `startDate > nextSunday` *(unchanged)* |

The existing "spans current Monday" fallback in `bucketWeekItem:373-375` is subsumed by the new `inFlight` rule.

### 3.2 Bot prompt update

`bot-context-sections.ts` query-recipes section: replace "time ladder" derivation instructions with explicit bucket-key references. New prompt language sketch:

> "Lead with today + inFlight first, then thisWeek, then nextWeek/later. If today and inFlight are both empty, the time ladder kicks in: 'Today's clear; tomorrow you have...'"

### 3.3 MCP tool description

`bot-tools.ts:262` and `runway-tools.ts:226` descriptions need updated bucket enumeration. Also: confirm Open Brain consumers aren't broken by schema addition (additive change — should be safe but verify in Phase 1).

### 3.4 Stub filter edge case

Decision needed (Phase 1 question): Should `status='in-progress'` L2s under `awaiting-client` L1s bypass the stub filter? Options:

- **A**: Keep current rule (hide all children). Operator picks up edge cases via L1 drill-down.
- **B**: Bypass stub filter when L2 status is `in-progress`. Surfaces the active kickoff L2s like New Capacity One-Pager.
- **C**: Bypass stub filter when L2's own start_date is within current week (regardless of status).

Recommend **B** with a unit test pinning the behavior — but operator gates.

## 4. Code quality / DRY audit (Phase 1.5)

Run alongside the diagnostic. Checklist:

1. **Duplicated person-match logic** — `getWeekItemsData` (`operations-reads-week.ts:189-194`) and `getPersonWorkload` (`:416-418`) both do `matchesSubstring(owner, p) || matchesSubstring(resources, p)`. Extract to a shared helper or inline both via a `personMatches` predicate.

2. **Date utilities mixed into operations file** — `chicagoISODate` (`:292`), `mondayOf` (`:307`), `addDaysISO` (`:321`) are generic enough to live in their own module. Candidate: `src/lib/runway/dates.ts`. Other call sites for these utilities should be grepped before the move.

3. **NULL-compat status filter** (`:203-205`) — inline `status === null || status === 'scheduled'` is sprinkled. Helper: `isScheduledStatus(s)`. Consolidates the rollout-tail logic.

4. **`getPersonWorkload` is 200+ lines** — already has pure helpers extracted (`bucketProject`, `bucketWeekItem`, `sortWeekItems`). Could lift them out of the file and unit-test independently. Worth doing only if the test surface gets cleaner.

5. **Today/thisWeek partition in two places** — once data-layer (new), once still in UI components and prompt. Audit those for consistency once data layer changes. `filterInFlight` in `plate-summary.ts` becomes the canonical predicate the data layer uses too (DRY).

6. **Spec-vs-tool consistency** — bot prompt enumerates buckets in prose; MCP tool description does too; the TS type does too. Three places to keep in sync. Consider a single source of truth — e.g. tool description generated from the TS type, or both reference a `BUCKETS` constant.

7. **Type-on-the-wire size** — `PersonWorkload` returns full row objects. With a `today` bucket added, row counts ~stable but type surface grows. Confirm Slack-bot prompt fits in token budget (currently around 8-12k for a busy person's plate). Truncate via `notes.slice(0, N)` if needed.

Each item above is a code-review surface, not a guaranteed change. Phase 1.5 produces a delta list; operator picks what lands in this PR vs. follow-up.

## 5. Phases + compact gates

Each phase ends with a state-write to disk + natural compact opportunity. Target: stay under 300k context per phase.

| Phase | Output | Compact gate |
|---|---|---|
| **1. Diagnostic** | Confirm hypothesis: re-run `getPersonWorkload("Lane")` directly, dump bucket structure. Verify Today panel UI data source matches/differs from bot. Decide on stub-filter edge case (operator gate). | ✅ End of phase |
| **1.5 Architecture audit** | Delta list per § 4 checklist. Each item: keep/defer/scope-out with one-line rationale. | ✅ End of phase |
| **2. Plan finalization** | Tightened plan doc (this file) updated with audit deltas. Operator one-pass review. | ✅ Operator gate |
| **3. Code + tests** | Implement § 3.1, § 3.2, § 3.3 changes. Tests woven into each step per CLAUDE.md: bucket logic in `operations-reads-week.test.ts`; prompt-section in `bot-context-sections.test.ts`; MCP tool in `runway-server.test.ts`. | ✅ End of phase |
| **4. Pipeline** | `/code-review` → `/update-docs` (if patterns changed) → `/pr-ready` → `/preflight` → `/canary` → `/atomic-commits`. | (each is its own gate) |
| **5. PR** | Operator opens PR upstream. | — |

If a phase compacts mid-work: state file at `docs/tmp/slackbot-plate-fix-phase-state.md` carries the in-progress chunk forward.

## 6. Test strategy

Per CLAUDE.md, tests are part of each step, not appended.

- **`operations-reads-week.test.ts`** — Add cases for `today` bucket boundary (single-day item with `start=today`, multi-day spanning today, Chicago timezone DST edges). Add `inFlight` cases (in-progress spans today, scheduled spans today should NOT inFlight, completed in-progress span ignored). Add narrowed `thisWeek` cases (start tomorrow, start Sunday, items at thisMonday boundary).
- **`bot-context-sections.test.ts`** — Cover new prompt language. Snapshot tests likely already exist for query-recipes section — update baselines.
- **`runway-server.test.ts`** + **`bot-tools.test.ts`** — Verify new bucket keys surface through both MCP and direct-tool paths.
- **`plate-summary.test.ts`** — May exist; if `filterInFlight` is invoked from `getPersonWorkload`, ensure shared-semantics regression test (data layer + UI return same predicate).
- **Live verification** — Re-run eval script post-fix: `npx tsx scripts/runway-migrations/_eval-lane-plate-2026-05-12.ts`. Verify Lane plate buckets contain expected items per `docs/tmp/lane-plate-prod-snapshot-2026-05-12.txt`.

## 7. Open questions for Phase 1

1. **Stub-filter edge case** — A / B / C from § 3.4? *(operator gate)*
2. **Schema additive vs. replacement** — Add `today` + `inFlight` as new keys (additive, safer) vs. restructure `weekItems` to drop the now-redundant "spans current Monday" branch entirely (cleaner, breaks any consumer reading `thisWeek` for spanning items). *(operator gate)*
3. **Open Brain / non-Slack consumers** — Are there other callers of `getPersonWorkload` whose surface assumptions break if `thisWeek` no longer contains span-overlap items? Audit `bot-context-sections.ts:128-150` and any UI components. *(Phase 1 task)*
4. **Bot prompt for "no plate" case** — Time ladder kicks in if both `today` AND `inFlight` are empty. Empty-week recovery sketch in § 3.2 — operator approves wording. *(operator gate)*
5. **Dashboard parity** — Today panel + In Flight panel in `/runway` UI: do they share predicate code with `getPersonWorkload`, or independent? If independent, fix-once-or-fix-twice question. *(Phase 1 task)*

## 8. Out-of-scope for this PR

- Fixing the `dayOfWeek` column data drift (Hopdoddy Home Page + LPPC Post-launch Revisions both store `dayOfWeek='monday'` while `startDate='2026-05-12'` which is Tuesday). That's a data backfill, not a code change. Surfaces a DI-TP migration if Phase 1 confirms the drift is systemic. Surface to operator at end of Phase 1.
- The In Flight panel UI rendering "BLOCKED" badges from notes content while `status='in-progress'` in DB — separate UI-data drift, separate fix.
- "All four blocked on messaging approval" narrative oversimplification — prompt-engineering follow-up, defer until data layer is solid.

## 9. Pipeline reference (from CLAUDE.md)

Order matters; each is its own step:

1. `/code-review` — DRY, prop drilling, hooks/context, test coverage
2. `/update-docs` — sync `/docs` knowledge base if patterns/versions changed
3. `/pr-ready` — debug statements, unused imports, final cleanup
4. `/preflight` — build + grep gate + tests + lint
5. `/canary` — cross-fork Vercel preview deploy
6. `/atomic-commits` — split working tree into focused commits
7. Push the branch + open the PR (operator-run, do NOT auto-push)
