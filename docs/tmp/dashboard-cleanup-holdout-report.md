# Dashboard Cleanup -- Holdout QA Report

**Branch:** feature/dashboard-cleanup
**Date:** 2026-05-07
**Tests added:** 22 holdout tests across 3 files

## Tests Added

### in-flight-toggle-holdout.test.tsx (5 tests)
- InFlightToggle rapid double-click: button disabled during isPending transition, second click does NOT fire onToggle
- Compact mode: aria-labelledby + aria-describedby targets still in DOM (sr-only)
- Compact mode: aria targets have correct text content when enabled=false

### runway-board-utils-holdout.test.ts (10 tests)
- isActivelySpanning: status=undefined (absent) field treated as non-terminal -- item spans
- isActivelySpanning: status=null treated as non-terminal -- item spans
- isActivelySpanning: empty string startDate/endDate treated as falsy -- returns false
- isActivelySpanning: status=blocked (non-terminal) -- actively spans
- filterSpanningFromDayCells: all items spanning -- day bucket remains but has empty items array (day NOT dropped)
- filterSpanningFromDayCells: preserves date/label metadata on filtered day
- filterSpanningFromDayCells: multiple days processed independently

### filter-active-holdout.test.ts (7 tests)
- isReadyToClose Branch B boundary: endDate = today NOT past (strict less-than)
- isReadyToClose Branch B: endDate one day before today IS past
- isReadyToClose Branch B: status=null + past endDate fires
- isReadyToClose Branch B: status=null + future endDate does NOT fire
- isReadyToClose Branch B: awaiting-client + past endDate fires
- isReadyToClose Branch B: on-hold + past endDate fires
- isReadyToClose: todayISO parameter controls comparison, not system clock
- isL1Hidden: empty string status (not terminal) -- returns false
- isWrapperHidden: orphan with status="" (non-terminal) keeps wrapper visible

## Bugs Found

**None.** All holdout tests passed immediately.

## Edge Cases Documented (no code fixes needed)

1. **isActivelySpanning with null/absent status**: null and absent (undefined) are treated as non-terminal -- correct per the domain convention (null = scheduled = not done). Tests document this explicitly.

2. **filterSpanningFromDayCells with all-spanning bucket**: The day bucket itself remains in the result with an empty items array. It does NOT get dropped from the days list. This is correct -- dropping would change the grid structure; an empty column is valid.

3. **isReadyToClose Branch B endDate = today**: `"2026-05-07" < "2026-05-07"` is false, so today is NOT treated as past. Edge is strict less-than, matching the spec "endDate < today". Test locks this boundary.

4. **isWrapperHidden orphan with empty string status**: `"" != null` is true but `TERMINAL_STATUSES.has("")` is false, so the orphan keeps the wrapper visible. Correct behavior -- empty string is not a known terminal status.

## Summary

22 holdout tests added across 3 files. No bugs found. All tests pass (3531 total up from 3509 pre-holdout). Edge cases are documented via tests for future regression protection.
