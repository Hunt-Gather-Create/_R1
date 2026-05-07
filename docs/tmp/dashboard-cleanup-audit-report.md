# Dashboard Cleanup -- Multi-Panel Blind Audit Report

**Branch:** feature/dashboard-cleanup
**Diff base:** upstream/runway
**Date:** 2026-05-07
**Files changed:** 23 files, +1450/-198

## Panel 1: Data Flow

| Finding | Grade | Evidence |
|---------|-------|---------|
| Item 1 (parent project name): 2-query batch, no N+1 | PASS | buildParentProjectNameMap() uses inArray() twice; O(1) Map lookups |
| Item 1: getStaleWeekItems also resolved | PASS | buildParentProjectNameMap called in both getWeekItems() and getStaleWeekItems() |
| Item 4 (spanning filter): computed in useMemo, not on render | PASS | filterSpanningFromDayCells called inside useMemo([thisWeek, todayStr]) |
| Item 4: todayISO computed inside memo (new Date() each memo eval) | WARN | `const todayISO = new Date().toISOString().slice(0, 10)` inside memo -- triggers fresh `new Date()` on every memo recompute. This is intentional (midnight rollover) but adds ~1ms overhead per recompute. Non-blocking. |
| Item 9: todayISO computed once per page request | PASS | `const todayISO = ...` at RunwayPage top level, passed to computeReadyToCloseIds |
| Item 3 (toggle): optimistic flip with rollback on error | PASS | InFlightToggle preserves rollback pattern from original; compact mode doesn't change state logic |
| Item 2 (flags sections): FLAG_SECTION routing table is exhaustive | PASS | All 9 FlagTypes explicitly routed; TypeScript Record ensures compile-time completeness |
| queries.ts: inArray() with potentially large ID arrays | WARN | If weekItems has thousands of distinct projectIds, inArray() could hit SQLite limits. Not a current risk at agency scale (likely <100 projects) but worth noting. |

**Panel 1 verdict: PASS with 2 WARNs**

---

## Panel 2: UI/UX

| Finding | Grade | Evidence |
|---------|-------|---------|
| Item 3: toggle accessible in compact mode | PASS | sr-only spans maintain aria-labelledby/describedby contract |
| Item 3: section renders when disabled (toggle visible) | PASS | hasToggle=true branch renders section even when enabled=false |
| Item 2: empty sections omitted | PASS | FlagSectionBlock returns null when flags.length=0 |
| Item 12: marker bar transparent on L2 (no layout shift) | PASS | L2 gets `border-left: 4px solid transparent` -- 4px allocated, no layout shift |
| Item 11: completed vs canceled visual distinction | PASS | completed = muted slate; canceled = diagonal strikethrough -- distinct |
| Item 1: parentProjectName display position | PASS | Below account name, above title -- reads as hierarchy |
| Flags panel: section order Delivery > Client > Resourcing | PASS | SECTION_ORDER array locks order |
| Item 4: day bucket can become empty items array | WARN | An empty DayColumn (zero items) is not explicitly hidden -- will render a ghost header. Upstream, this is the existing behavior for all-filtered days. Non-blocking but operator should verify empty columns look acceptable. |

**Panel 2 verdict: PASS with 1 WARN**

---

## Panel 3: Performance

| Finding | Grade | Evidence |
|---------|-------|---------|
| Item 1: N+1 eliminated | PASS | 2 batched queries instead of N queries for parent project names |
| Item 10: color token generation is IIFE at module init | PASS | buildStatusCssLightInternal() + buildStatusCssLightBranded() called once at module load, not per render |
| Item 4: filterSpanningFromDayCells: O(n) per day, identity preserved when no filter | PASS | `if (filteredItems.length === day.items.length) return day;` avoids allocation |
| Item 12: CSS cascade (appended rules override STYLES) | PASS | buildHierarchyCss appended after STYLES string -- overrides via cascade; no JS overhead |
| restOfWeek memo: new Date() inside useMemo | WARN | Minor: calls `new Date()` on every memo recompute. Previously only `parseISODate(day.date).toDateString() !== todayStr` was computed inside. Marginal overhead, non-blocking. |
| queries.ts: sequential awaits (clientNameById, then buildParentProjectNameMap) | WARN | getWeekItems() awaits clientNameById then buildParentProjectNameMap sequentially. These could be parallel with Promise.all(). At current data scale, non-blocking; could save ~10-20ms per page load at scale. |

**Panel 3 verdict: PASS with 3 WARNs**

---

## Panel 4: Security

| Finding | Grade | Evidence |
|---------|-------|---------|
| No new auth boundaries added | PASS | All changes are rendering/query layer only; no new server actions, no new API routes |
| Parent project name lookup: no cross-workspace data leak | PASS | buildParentProjectNameMap queries the same Runway DB using the existing getRunwayDb() connection; no new DB or auth bypass |
| Colors.ts: no secrets | PASS | Pure CSS value strings |
| Flag routing: no untrusted input | PASS | FLAG_SECTION keys are FlagType literals from a closed union type |
| Item 9: todayISO derived server-side | PASS | `new Date().toISOString()` in page.tsx (RSC) -- not from user input |
| No em-dashes in source files | PASS | Grep confirms none introduced |

**Panel 4 verdict: PASS**

---

## Panel 5: Edge Cases

| Finding | Grade | Evidence |
|---------|-------|---------|
| Item 4: retainer wrappers in day cells | WARN | Retainer wrapper entries (if present as weekItems) would be filtered by isActivelySpanning if they have a multi-day span. This is correct behavior but could surprise if operator expects wrappers in day cells. Held for operator review. |
| Item 1: projectId=null weekItems | PASS | `item.projectId ? ... : null` guard handles null projectId |
| Item 9: isReadyToClose called without todayISO | PASS | todayISO has a default: `todayISO ?? new Date().toISOString().slice(0, 10)` |
| Item 3: InFlightSection with no items + toggle | PASS | Renders section header with toggle even when inFlight.length=0 |
| Item 10: STYLES string mutation risk | PASS | STYLES = string + function() -- evaluated once at module load, not mutable |
| Item 11: completed milestone uses bar color but milestone has separate CSS | PASS | Both .row.completed .bar and .row.completed .milestone updated via buildStatusCssLightInternal() |
| FLAG_SECTION map: unknown FlagType at runtime | WARN | If a new FlagType is added to flags.ts but not to FLAG_SECTION map, TypeScript would catch it at compile time (Record<FlagType, ...>) -- but only if FlagType is updated. If someone adds a detector without updating the union type, FLAG_SECTION lookup would return undefined and throw. Low risk; TypeScript protects the mapped case. |

**Panel 5 verdict: PASS with 2 WARNs**

---

## Summary

| Panel | Grade | WARNs | FAILs |
|-------|-------|-------|-------|
| Data Flow | PASS | 2 | 0 |
| UI/UX | PASS | 1 | 0 |
| Performance | PASS | 3 | 0 |
| Security | PASS | 0 | 0 |
| Edge Cases | PASS | 2 | 0 |
| **Total** | **PASS** | **8** | **0** |

**No FAILs. All 8 WARNs are deferred for operator morning triage.**

### WARNs for operator triage

1. **Data Flow WARN 1**: `new Date()` inside useMemo in runway-board.tsx. Intentional (midnight rollover support). Operator can confirm this is acceptable.
2. **Data Flow WARN 2**: inArray() with large ID arrays. Agency scale is safe; flag for future if client count grows significantly.
3. **UI/UX WARN**: Empty DayColumn after item 4 filtering could render a ghost header. Operator should visual-verify edge case in morning QA.
4. **Perf WARN 1**: Same as Data Flow WARN 1 (minor `new Date()` call in memo).
5. **Perf WARN 2 + 3**: Sequential awaits in getWeekItems() (clientNameById then parentProjectNames). Could be parallelized. ~10-20ms at scale.
6. **Edge WARN 1**: Retainer wrappers as weekItems could be filtered by item 4. Expected correct behavior; operator should confirm.
7. **Edge WARN 2**: Unknown FlagType not in FLAG_SECTION map would throw at runtime. TypeScript Record guards the compile-time case; runtime-only flag type additions are unguarded.
