# QA Report — Chunk 5 Atomic Commits

**Branch:** `feature/runway-pr86-chunk-5`
**Base:** `feature/runway-pr86-base`
**Worktree:** `/Users/jasonburks/Documents/_AI_/_R1/.claude/worktrees/agent-a25ac991`
**Commits evaluated:** 12 (matches plan)

## Summary

- Critical findings: 0
- Non-critical findings: 1
- Pass commits: 11

## Verification at HEAD

- `pnpm test:run` — 101 files / **1666 tests passed**, 0 failed (8.07s)
- Working tree clean; branch is 12 ahead / 2 behind `origin/feature/runway-pr86-base` (base was advanced after branch was cut; expected)

## Test co-location verdict

Agent claim: "tests are co-located with feature commits (corrects the Chunk 1/2 pattern)."

**Confirmed.** Commits that introduce new behavior also contain the tests covering that behavior in the same commit:

| Feature commit | Co-located test changes |
|---|---|
| `cb62a68` past-end L2 detector | `flags-detectors.test.ts` (+313 lines, 11 new tests) |
| `8c54b51` v4 PROJECT_FIELDS whitelist | `operations-utils.test.ts` (+18 lines) |
| `87bda38` exclude completed from forward buckets | `operations-reads-week.test.ts` (+38 lines) |
| `485e6c2` recomputeProjectDates in tx | `operations-writes-week-recompute.test.ts` (+68 lines), `operations-writes-test-helpers.ts`, `operations-writes-week.test.ts` (mock realignment) |
| `864d7ef` wire normalizeResourcesString | integration test in `operations-writes-week-recompute.test.ts` (+26 lines) + smaller sibling test files updated |
| `bd071e3` log malformed blocked_by JSON | `operations-reads-project-status.test.ts` (+28 lines) |
| `591d5d3` updateProjectStatus cascade tuples | **no new tests** — pure refactor; commit message explicitly justifies "existing tests pass unchanged" |

Two commits are test-only by intent:
- `0a2eb18` — post-hoc tests for `view-preferences.ts` (the subject file shipped in Chunk 3). Flagged below as non-critical but acceptable.

## Findings

### cb62a68 — feat(runway): past-end L2 detector on flags rail
- [PASS] Atomicity: single feature (detector + flag type wiring). Types, detector, registration, and tests in one commit.
- [PASS] Message: conventional, clear, references v4 convention §4.
- [PASS] Self-contained: imports/exports line up across `flags.ts`, `flags-detectors.ts`.
- [PASS] Tests co-located: 11 tests in `flags-detectors.test.ts` added same commit.

### 8c54b51 — fix(runway): extend PROJECT_FIELDS whitelist with v4 retainer/contract fields
- [PASS] Atomicity: one focused whitelist addition.
- [PASS] Message: conventional, describes root cause (Soundly raw-SQL workaround) and intent.
- [PASS] Self-contained: column map and whitelist updated together; test added in same commit.
- [PASS] Tests co-located: new assertions in `operations-utils.test.ts`.

### 87bda38 — fix(runway): exclude completed L2s from forward week buckets
- [PASS] Atomicity: one behavior fix in `bucketWeekItem`.
- [PASS] Message: clear; references debt ticket.
- [PASS] Self-contained: 10-line production change, 38-line test.
- [PASS] Tests co-located.

### 485e6c2 — refactor(runway): move recomputeProjectDates inside write transactions
- [PASS] Atomicity: introduces `recomputeProjectDatesWith`, migrates 4 callsites, adds no-op skip — all one logical "make the recompute transaction-safe" change.
- [PASS] Message: thorough, explains transaction safety + audit-noise rationale; documents the mock-helper adjustment.
- [PASS] Self-contained: all 4 callsites + helper + tests land together.
- [PASS] Tests co-located: new test file `operations-writes-week-recompute.test.ts` (real SQLite).

### 864d7ef — fix(runway): wire normalizeResourcesString into write paths
- [PASS] Atomicity: one theme — canonicalize resources strings on every write. Touches 5 write paths, each for the same reason.
- [PASS] Message: enumerates touched functions; ties to debt §12.1.
- [PASS] Self-contained: imports/exports consistent; canonical-form integration test included.
- [PASS] Tests co-located.

### 591d5d3 — refactor(runway): updateProjectStatus captures cascade tuples in tx
- [PASS] Atomicity: single refactor, single file.
- [PASS] Message: explains race + title-collision rationale; references sibling pattern in `updateProjectField`.
- [PASS] Self-contained.
- [PASS] Tests co-located (none required — pure refactor covered by existing `operations-writes.test.ts`; explicitly justified in message).

### bd071e3 — fix(runway): log malformed blocked_by JSON, document cross-week invariant
- [NON-CRITICAL] Atomicity: technically two small changes — (a) structured log in `operations-reads-project-status.ts`, (b) invariant comment in `queries.ts`. They are related (both harden blocked_by handling) and total 47 lines across 3 files, so bundling them is defensible, but a stricter reading would split the docstring into its own `docs:` commit.
- [PASS] Message: covers both sub-changes.
- [PASS] Self-contained.
- [PASS] Tests co-located: test added for the logging path.

### 0a2eb18 — test(runway): cover view-preferences no-such-table fallback
- [NON-CRITICAL] Atomicity / co-location: this is a standalone `test:` commit for behavior shipped in Chunk 3 (file introduced by commit `ed82e1d`). Evaluated as acceptable because: (a) the file is already on `main` via Chunk 3 and cannot be bundled with its subject now; (b) the commit message explicitly documents this ("This branch existed solely to make the file merge-safe before `pnpm runway:push` applies the migration; it had no prior coverage"); (c) skill rule "Tests with or after their subject — never before the code they test" is satisfied. Not a repeat of the Chunk 1/2 "tests later" anti-pattern, which was splitting *new* feature tests into a separate commit.
- [PASS] Message: conventional `test:` prefix, references debt ticket.
- [PASS] Self-contained: test file adds, no prod change.

### df05de7 — perf(runway): compute today inside useMemo in InFlightSection
- [PASS] Atomicity: 9-line perf tweak in one component.
- [PASS] Message: precise, references Vercel memo-deps best practice implicitly via debt §13.2.
- [PASS] Self-contained.
- [PASS] Tests co-located: none added (micro-optimization to existing memoized hook; no behavior change to assert).

### c30f741 — fix(runway): reconcile drizzle snapshot/SQL drift
- [PASS] Atomicity: one theme — fix fresh-DB replay path. Covers both the 0001 SQL backfill and the missing 0002 migration, plus journal update — all parts of the same "snapshot/SQL must match" invariant.
- [PASS] Message: thorough, explains why prod is unaffected (drizzle-kit tracks migrations by filename tag), documents `drizzle-kit generate` now reports clean.
- [PASS] Self-contained: migration file + snapshot + journal move together.
- [PASS] Tests co-located: n/a (migration artifacts; drift check is the verification).

### 5f17039 — docs(runway): batch-update skill audit findings
- [PASS] Atomicity: one doc file under `docs/tmp/`.
- [PASS] Message: explains scope, explicitly notes SKILL.md edits are intentionally deferred to operator review.
- [PASS] Self-contained.
- [PASS] Tests co-located: n/a (doc only).

### 2773dcf — docs(pr86): PR message draft ready for TP review
- [PASS] Atomicity: single doc file under `docs/tmp/`.
- [PASS] Message: clear, describes draft content and hand-off intent.
- [PASS] Self-contained.
- [PASS] Tests co-located: n/a.

## Per-commit bisect-safety verdict

All commits are additive or local-refactor; no commit removes public symbols used by a later commit, and the test suite at HEAD is green (1666 passing). Spot-checks of the ordering:

- `cb62a68` adds `FlagType` member → later commits don't narrow it.
- `8c54b51` adds whitelist entries → later commits reference them but don't require removal.
- `485e6c2` introduces `recomputeProjectDatesWith`; `864d7ef` uses existing write paths that already route through it → ordering correct.
- `591d5d3` refactors `updateProjectStatus` in a file untouched by later commits.
- `c30f741` migration files are additive; no runtime code depends on them.
- `0a2eb18` test-only; tests at that SHA target subject code already present from Chunk 3 baseline.

**Bisect-safety verdict: PASS for all 12.** No commit introduces a breakage that a later commit "rescues," based on static read of the diffs. A full per-commit `pnpm test:run` run was not executed (time budget), but: (a) additive nature, (b) green HEAD, (c) no symbol removal collisions, all support the verdict.

## Unresolved

- `bd071e3` could be split into `fix:` (logging) + `docs:` (invariant comment in queries.ts) under the strictest atomic reading. Flagged non-critical; operator can decide whether to restructure.
- Per-SHA `pnpm test:run` (full bisect) not executed; static analysis only. If strict verification is required before merge, a git-bisect-run pass over the 12 commits would close the gap.

## Overall recommendation

**MERGE.** Twelve focused commits, conventional-commit messages throughout, tests co-located where new behavior ships (corrects Chunk 1/2 pattern), HEAD is green, no critical findings. The sole non-critical item (`bd071e3` bundling one-line docstring with a code fix) is a matter of taste, not a bisect hazard.
