# QA Report — Chunk 2 Atomic Commits

**Branch:** feature/runway-pr86-chunk-2
**Base:** feature/runway-pr86-base
**Commits evaluated:** 6

## Summary
- Critical findings: 2
- Non-critical findings: 1
- Pass commits: 4 (partial — see self-containment findings below)

## Findings

### 09908d9 — feat(runway): v4 resources parser (parseResources + normalizeResourcesString)
- [PASS] Atomicity: Single logical change — pure parser + barrel export. No bundled changes.
- [PASS] Message: Conventional `feat(runway):` scope, body explains semantics (comma = concurrent, `->` = sequential) and why (downstream consumers).
- [PASS] Self-contained: Adds only `operations-utils.{ts,test.ts}` and a barrel export. Pure function, no external consumers, builds + tests pass in isolation.
- [PASS] Tests co-located: 138 lines of unit tests land in the same commit as the 94-line parser.

### 5011d6d — feat(runway): get_week_items matches on resources (unified person filter)
- [PASS] Atomicity: Single logical change — adds `person` parameter end-to-end (read layer + MCP + bot).
- [PASS] Message: Clear conventional `feat(runway):` message; body explains the owner/resource/person distinction and the v4 motivation.
- [CRITICAL] Self-contained: Commit is NOT buildable/testable in isolation. `src/lib/slack/bot-tools.ts` now calls `getWeekItemsData(weekOf, owner, resource, person)` (4-arg), but `src/lib/slack/bot-tools.test.ts` still asserts `expect(mockOps.getWeekItemsData).toHaveBeenCalledWith("2026-04-06", "Kathy", "Roz")` and `(undefined, undefined, undefined)` (3-arg). Vitest `.toHaveBeenCalledWith` is arity-sensitive — those two tests fail at this SHA. Breaks `git bisect` — anyone checkout’ing this commit and running `pnpm test:run` sees red.
- [CRITICAL] Tests co-located: The `operations-reads.test.ts` additions for the new `person` parameter (46 lines) ARE in this commit, but the corresponding bot-tools.test updates (new `person` call assertion) and mcp/runway-tools.test updates are deferred to `80037e4`. Per atomic-commits skill rule "Tests with or after their subject — never before the code they test" AND the project CLAUDE.md: "Tests are part of each step, not a separate step" — the bot/MCP tests belong here.

### 429864a — feat(runway): cascade audit rows with triggeredByUpdateId (v4 §7, §8)
- [PASS] Atomicity: Single logical change — adds cascade linkage to audit rows across two write paths (`updateProjectStatus`, `updateProjectField`) plus the shared helper. Tightly coupled; correctly grouped.
- [PASS] Message: Excellent conventional `feat(runway):` message, references v4 sections, explains FK semantics and transaction wrapping.
- [PASS] Self-contained: All touched files (`operations-utils.ts`, `operations-writes.ts`, `operations-writes-project.ts`) and their co-located tests are in this commit. Builds independently.
- [PASS] Tests co-located: 60 + 111 lines of new tests land alongside the production code, covering FK linkage, all-category cascade, and the no-cascade path.

### e270924 — feat(runway): get_week_items_by_project + get_project_status drill-downs
- [PASS] Atomicity: Two new read surfaces that share the drill-down purpose. Correctly grouped — `getWeekItemsByProject` is a helper used conceptually alongside `getProjectStatus` for the same project-level drill-down contract.
- [NON-CRITICAL] Message: Strong body, but the single commit title bundles two tool names. Acceptable given the shared-purpose grouping — arguably could have split into two commits (one per tool), but the operational coupling and small size justify the bundle. Flagging for style.
- [CRITICAL] Self-contained: This commit registers `get_project_status` on the MCP server (`runway-tools.ts`) and the bot tool registry (`bot-tools.ts`), bumping the bot tool count from 22 to 23. However `src/lib/slack/bot-tools.test.ts` still asserts `it("creates all 22 tools", ...)` at this SHA, and `src/lib/mcp/runway-server.test.ts` / `runway-tools.test.ts` do not yet reference the new tools. `pnpm test:run` fails here. Bisect-breaking.
- [CRITICAL] Tests co-located: `operations-reads-project-status.test.ts` (341 lines) and `operations-reads-week.test.ts` additions (64 lines) correctly co-locate with the read-layer implementation. But the bot-tool and MCP registration tests are deferred — same split as `5011d6d`. Should have been in this commit.

### f14be47 — feat(runway bot): v4 prompt context — convention summary, smart plate framing, category tone
- [PASS] Atomicity: Single logical change — all edits target prompt construction (bot-context sections + behaviors + entry point). Tightly cohesive.
- [PASS] Message: Clear `feat(runway bot):` scope, detailed body explaining each of the three additions (convention summary, plate framing, tone).
- [PASS] Self-contained: All four files live in `src/lib/runway/` and the 67-line test file (`bot-context-sections.test.ts`) ships in the same commit.
- [PASS] Tests co-located: 67 lines of new tests alongside the 41-line production addition.

### 80037e4 — test(runway): update bot + MCP tool tests for new get_project_status and person filter
- [CRITICAL] Atomicity: This commit exists only to fix tests broken by `5011d6d` and `e270924`. Per the atomic-commits skill: "Tests with or after their subject — never before the code they test" and rule 5 "Minimum viable commit — each commit should build and pass lint on its own (no broken intermediate states)". Splitting tests that track the same shape change into a trailing commit creates broken intermediate states for the two preceding feature commits. This is a cross-cutting test-only commit that retroactively repairs two features.
- [NON-CRITICAL] Message: Correctly uses `test(runway):` prefix and clearly enumerates what changed per file. Message itself is clean.
- [PASS] Self-contained: At this SHA, the full test suite (presumably) passes — this commit does build and test green, and `git checkout 80037e4` leaves the codebase in a healthy state.
- [CRITICAL] Tests co-located: The whole point of this commit is that tests are NOT co-located with their subject. bot-tools.test updates belong with `5011d6d` (person filter) and `e270924` (get_project_status registration). mcp/runway-tools.test and mcp/runway-server.test updates likewise belong with `e270924`. Splitting them out violates the premise even though the net diff at branch tip is identical.

## Overall recommendation

**RESTRUCTURE**

Two preceding feature commits (`5011d6d`, `e270924`) leave the test suite red at their SHAs. While the branch-tip diff is correct and the test commit message is honest, this breaks `git bisect`, violates the atomic-commits "self-contained" rule, and contradicts the project CLAUDE.md directive that tests are part of each build step (not a trailing cleanup).

The task prompt specifically asks whether this split is "acceptable as a large cross-cutting test update". My verdict: **not acceptable** — the test updates here are not cross-cutting infrastructure (e.g., a shared mock factory refactor). They are per-feature assertions (tool count bumps, new parameter, new mock returns) that track exactly one feature each. The appropriate split is one test update per feature commit.

### Proposed restructure (do NOT execute — operator decides)

Target: collapse `80037e4` into the two feature commits it repairs, keeping 5 commits total.

```
1. 09908d9  feat(runway): v4 resources parser (parseResources + normalizeResourcesString)
            (unchanged)

2. NEW-A    feat(runway): get_week_items matches on resources (unified person filter)
            = 5011d6d
            + bot-tools.test.ts hunks from 80037e4 (the 3-arg -> 4-arg assertions)
            + mcp/runway-tools.test.ts hunks from 80037e4 that cover the person filter

3. 429864a  feat(runway): cascade audit rows with triggeredByUpdateId (v4 §7, §8)
            (unchanged)

4. NEW-B    feat(runway): get_week_items_by_project + get_project_status drill-downs
            = e270924
            + bot-tools.test.ts hunks from 80037e4 (22->23 count, getProjectStatus mock, any new bot-level assertions)
            + mcp/runway-tools.test.ts hunks from 80037e4 (getWeekItemsByProject + getProjectStatus mocks + new-tool success/not-found cases)
            + mcp/runway-server.test.ts hunks from 80037e4 (two new tools in registered list)

5. f14be47  feat(runway bot): v4 prompt context — convention summary, smart plate framing, category tone
            (unchanged)
```

Net result: 5 commits, each buildable and test-green in isolation, bisect-safe, tests co-located with subject.

Mechanically: interactive rebase with `edit` on `5011d6d` and `e270924`, cherry-pick the relevant hunks of `80037e4` into each, then drop `80037e4`. Operator should decide — history rewrite on a feature branch is cheap but the branch is already pushed for QA review, so coordinate if other reviewers are referencing the current SHAs.

## Unresolved

- Did the author actually run `pnpm test:run` at each intermediate SHA? The clean branch-tip suggests they tested only at the end. Worth surfacing in TP review: this is the second Chunk where the test-co-location rule was interpreted as "tests green at branch tip" rather than "tests green at every SHA". If the atomic-commits premise is being routinely relaxed this way, either the premise needs updating or the CC workflow needs a per-commit test gate.
- Commit `e270924` bundles two MCP tools under one commit. Marked NON-CRITICAL because the coupling is real, but if the team prefers strict one-tool-per-commit, flag for convention.
