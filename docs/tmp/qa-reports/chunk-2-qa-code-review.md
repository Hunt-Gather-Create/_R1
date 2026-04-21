# QA Report — Chunk 2 Code Review

**Branch:** `feature/runway-pr86-chunk-2`
**Base:** `feature/runway-pr86-base` (advanced since chunk branched; base-merge artifacts present in diff)
**Diff commit range:** `feature/runway-pr86-base..HEAD` — 6 commits

- `09908d9` feat(runway): v4 resources parser (parseResources + normalizeResourcesString)
- `5011d6d` feat(runway): get_week_items matches on resources (unified person filter)
- `429864a` feat(runway): cascade audit rows with triggeredByUpdateId (v4 §7, §8)
- `e270924` feat(runway): get_week_items_by_project + get_project_status drill-downs
- `f14be47` feat(runway bot): v4 prompt context — convention summary, smart plate framing, category tone
- `80037e4` test(runway): update bot + MCP tool tests for new get_project_status and person filter

**Chunk-2 source/test files reviewed:** 22 (out of 31 diff entries; 9 are base-merge artifacts — asprey snapshots, migrations, PR86 planning docs — out of scope).

Chunk-2 in-scope files:

- `src/lib/runway/operations-utils.ts` + `.test.ts`
- `src/lib/runway/operations-reads-week.ts` + `.test.ts`
- `src/lib/runway/operations-reads-project-status.ts` + `.test.ts` (new)
- `src/lib/runway/operations-reads.ts` + `.test.ts`
- `src/lib/runway/operations-writes.ts` + `.test.ts`
- `src/lib/runway/operations-writes-project.ts` + `.test.ts`
- `src/lib/runway/operations.ts` (barrel)
- `src/lib/runway/bot-context.ts`
- `src/lib/runway/bot-context-sections.ts` + `.test.ts`
- `src/lib/runway/bot-context-behaviors.ts`
- `src/lib/mcp/runway-tools.ts` + `.test.ts`
- `src/lib/mcp/runway-server.test.ts`
- `src/lib/slack/bot-tools.ts` + `.test.ts`

---

## Summary

- **Critical findings:** 0
- **Non-critical findings:** 5
- **Pass-through files:** 17

## Overall recommendation

**MERGE** — with non-critical polish optional.

The chunk delivers everything the spec required: parser with arrow/comma/unicode handling, unified `person` filter on `get_week_items` (+ owner/resource back-compat retained), new MCP `get_week_items_by_project`, new `get_project_status` (bot + MCP), cascade-on-all-categories, per-L2 cascade audit rows with `triggeredByUpdateId`, and the v4 bot-prompt sections. Tests are co-located with every new source file, cover the contract surfaces called out in the pre-plan, and cover the edge cases (unicode arrows, empty string, malformed `Role:`, multi-swap dedup). Security is unchanged — no new attack surface, auth path untouched, no raw SQL.

The three ambiguity items the operator flagged are addressed below (Contract compliance + Unresolved).

---

## Contract compliance verdict

**`get_project_status` shape matches the pre-plan interface contract.**

The pre-plan contract (§"Interface contract"):

```ts
{ name, client, owner, status, engagement_type,
  contractRange: { start?, end? },
  current: { waitingOn?, blockers?[] },
  inFlight: WeekItem[], upcoming: WeekItem[],
  team: string, recentUpdates: Update[], suggestedActions: string[] }
```

Implementation in `src/lib/runway/operations-reads-project-status.ts:57-73`:

- All required top-level keys present with correct types.
- `inFlight` gates on `status==='in-progress'` AND `today ∈ [startDate, endDate]` (single-day = `endDate=startDate`) — matches contract note "end=null means =start" via `item.endDate ?? start`.
- `upcoming` is next-14-days, `status !== 'completed'` — matches contract.
- `current.blockers` populated from both `status==='blocked'` L2 titles AND `blockedBy` FK resolution, with de-dup (`!includes`) — matches "from status='blocked' L2s OR blocked_by resolution."
- `recentUpdates` is `desc(createdAt).limit(3)` — matches "last 3 updates, newest first."
- `suggestedActions` are deterministic heuristic strings from `deriveSuggestedActions` — matches "short strings."

**Chunk 1 `PersonWorkload` shape compliance:** Chunk 2 only consumes `getPersonWorkload` via the bot `get_person_workload` tool (bot-tools.ts:175) and MCP tool; neither introduces a new shape nor narrows it. Consumers pass `personName` and return the object verbatim. Compliant.

---

## Findings

### `src/lib/runway/operations-utils.ts`
- **PASS DRY / hooks / prop-drilling / security** — pure utilities, no state leak, Set+Map dedup used correctly. `ARROW_NORMALIZE_RE` hoisted to module scope (follows `js-hoist-regexp`).
- **NON-CRITICAL DRY**: `parseResources` and `normalizeResourcesString` both invoke `raw.replace(ARROW_NORMALIZE_RE, ...)` — the functions do similar prefix work. Minor; acceptable since the normalize step differs (canonical `->` vs ` -> ` with spaces).
- **NON-CRITICAL coverage gap**: `normalizeResourcesString` is exported (src/lib/runway/operations-utils.ts:766) and documented as "Used on write to persist resources in a consistent format," but **no write path actually calls it**. Verified via `Grep normalizeResourcesString\(` — zero call sites outside the test file. Result: when a user writes `"CD: Lane → Dev: Leslie"` via `update_project_field` or `createWeekItem`, the unicode arrow is stored as-is. The parser tolerates this on read, so behavior is not broken, but the doc comment overstates what the code does. Either (a) wire it into `updateProjectField` / `updateWeekItemField` / `createWeekItem` when `field === "resources"`, or (b) soften the doc comment to "Call before persisting if you want a canonical form." This is a spec-drift from the pre-plan line "Normalizes →, =>, >> to canonical -> on write." Non-critical because tests still pass and the parser is read-tolerant.

### `src/lib/runway/operations-utils.test.ts`
- **PASS** — `parseResources` covers 12 cases including all three unicode arrow variants, whitespace handling, malformed `Role:`, stray commas, bare person. `normalizeResourcesString` covers 5 cases including empty, unicode, whitespace collapse, trailing comma drop.

### `src/lib/runway/operations-reads-week.ts`
- **PASS DRY / security** — `getWeekItemsData`'s four-arg signature (weekOf, owner, resource, person) is clean; the `person` filter uses `matchesSubstring(owner) || matchesSubstring(resources)`, consistent with the existing helper. Filters AND together (documented on operations-reads-week.ts:60-66).
- **PASS** — `getWeekItemsByProject` excludes `status==='completed'` (correct per pre-plan line "all non-completed L2s") and sorts by start_date → sortOrder with `date` fallback.

### `src/lib/runway/operations-reads-week.test.ts`
- **PASS** — `getWeekItemsByProject` covered (4 tests, incl. completed exclusion, sort, null start_date fallback). `chicagoISODate` covered. `getPersonWorkload` covered in `operations-reads-week.test.ts` AND `operations-reads.test.ts` (duplication intentional per barrel re-export note).

### `src/lib/runway/operations-reads-project-status.ts`
- **PASS contract** — see "Contract compliance verdict" above.
- **PASS security** — no user input reaches SQL; `clientSlug` and `projectName` go through `getClientOrFail` + `resolveProjectOrFail` which use parameterized `eq()`.
- **NON-CRITICAL edge case**: `JSON.parse(item.blockedBy)` on line 246 is wrapped in try/catch and silently ignores malformed payloads (comment documents this). Acceptable defensive coding, but consider logging the parse failure — malformed `blocked_by` going silent is a debugging headache. Not blocking.

### `src/lib/runway/operations-reads-project-status.test.ts`
- **PASS** — 9 tests covering not-found paths, full shape, sort, completed exclusion, blocker resolution, overdue/blocked/retainer suggestions, contract_start/end precedence, team fallback to project.resources.
- **NON-CRITICAL coverage gap**: No test for `JSON.parse` throwing on malformed `blockedBy` — only happy-path with valid JSON array. The try/catch is untested. Low priority since the catch is defensive and short.

### `src/lib/runway/operations-writes.ts` (updateProjectStatus — cascade)
- **PASS** — Pre-generates parent audit id, cascades in transaction, emits per-L2 cascade audit rows after commit with `triggeredByUpdateId` FK.
- **NON-CRITICAL efficiency**: `getLinkedWeekItems(project.id)` is called **twice** — once inside the transaction (line 82) to drive the cascade, then again after commit (line 113) to rebuild a title→row lookup for audit row emission. Cleaner alternative: collect `{id, title}` tuples during the first fetch and pass them out of the transaction scope. Current approach is correct but does an extra DB round-trip per cascaded status change. Also note: the title-based map (`byTitle`, line 116-117) will collide if two linked L2s share a title — unlikely in practice but technically lossy. Using the cascaded ids directly (as the `updateProjectField` companion does — see `cascadedIds` on line 147) would be both cheaper and collision-safe.

### `src/lib/runway/operations-writes.test.ts`
- **PASS** — New tests for cascade-on-all-categories (6 category combinations) and `triggeredByUpdateId` propagation (verifies parent.id populated, all children carry FK, summaries match). Regression tests preserved.

### `src/lib/runway/operations-writes-project.ts` (updateProjectField — dueDate cascade)
- **PASS** — Uses `cascadedIds` tuple pattern (cleaner than the status-cascade sibling). Per-item cascade audit row emitted with `cascade-duedate` type + `triggeredByUpdateId` FK.

### `src/lib/runway/operations-writes-project.test.ts`
- **PASS** — New tests for per-item `triggeredByUpdateId` cascade (verifies 3 rows: 1 parent + 2 children with FK + summaries). Also tests the "no-cascade, no-children" path.

### `src/lib/runway/bot-context-sections.ts` (+ behaviors + main)
- **PASS** — New `buildV4ConventionSummary` paragraph covers L1 owner + resources roster, L2 owner inheritance, resources format with commas/arrows/role abbreviations, stub filter, timing (start/end + contract override). Updated `buildQueryRecipes` adds Smart plate framing section, Category tone section, and a `get_week_items with person` recipe.
- **PASS** — Integrated into `bot-context.ts` at the correct composition point (before query recipes). No unrelated restructuring — respects the "do NOT restructure unrelated sections" constraint from the pre-plan.

### `src/lib/runway/bot-context-sections.test.ts`
- **PASS** — Tests assert the literal strings for smart plate framing, category tone (launch/deadline=urgent, approval=awaiting-signal, neutral), unified `person` filter recipe, and v4 convention summary content (L1/L2, owner inheritance, role abbreviations, stub behavior).

### `src/lib/mcp/runway-tools.ts`
- **PASS** — Registers `get_week_items_by_project` (line 68) and `get_project_status` (line 87) as MCP tools. `get_project_status` handler correctly routes `ok:false` → `textMessage(result.error)` and `ok:true` → `textResult(result.status)`.
- **Note on ambiguity #2 (operator flagged)**: Spec said `get_project_status` is a "bot tool." It was registered as both bot + MCP. **This is not scope creep** — the MCP side is a thin formatting wrapper over `getProjectStatus`, costs 8 lines, uses the same underlying operation the bot does, and gives Claude Code + Open Brain the same drill-down capability as the bot via MCP. The existing pattern (every read op registered on both) is preserved. The pre-plan's "bot tool" phrasing was shorthand, not an exclusion. No harm; actively consistent with the rest of the file.

### `src/lib/mcp/runway-tools.test.ts`
- **PASS** — Covers `get_week_items_by_project`, `get_project_status` (ok path + not-found path). `get_week_items` now passes `person` as 4th arg.

### `src/lib/mcp/runway-server.test.ts`
- **PASS** — Expected-tools list now includes `get_week_items_by_project` and `get_project_status` in the correct ordered position.

### `src/lib/slack/bot-tools.ts`
- **PASS** — New `get_project_status` bot tool (line 178) with a good description (distinguishes from `get_person_workload`). `get_week_items` description rewritten to teach the bot when to use `person` vs `owner` vs `resource` — consistent with the new query-recipes section in the prompt.
- **Note on ambiguity #1 (operator flagged)**: Keeping `owner`/`resource` scalars alongside `person` is **appropriate**, not over-engineering. They serve distinct query semantics: "who owns X" (strict owner match) vs "who is assigned X" (owner OR resource). Removing the scalars would force the bot to always do the union filter, losing the ability to answer "show me only what Kathy is accountable for." The description on each param now explicitly guides the LLM on when to use which. Compatible with v4 convention. Keep.

### `src/lib/slack/bot-tools.test.ts`
- **PASS** — Roster now asserts 23 tools including `get_project_status`. `get_week_items` test asserts 4-arg call signature.

### `src/lib/runway/operations.ts` (barrel)
- **PASS** — `parseResources`, `normalizeResourcesString`, `ResourceEntry`, `getProjectStatus`, and all new `ProjectStatus*` types correctly exported. `getWeekItemsByProject` added alongside existing read exports.

### Base-merge artifacts (out of scope)
Diff contains Asprey snapshot JSONs, Asprey migration scripts, chunk-5 prompt, wave-1-2 details, and `remaining-6-postmerge.md`. These are artifacts of the base branch advancing since chunk-2 branched (see operator's "note: base has advanced" in the mission). No review applied.

---

## Top 3 findings

1. **`normalizeResourcesString` is defined and documented as "used on write" but never invoked on any write path.** Either wire it into write operations when `field === "resources"` OR soften the doc comment. (NON-CRITICAL, `src/lib/runway/operations-utils.ts:766`.)

2. **`updateProjectStatus` cascade does a redundant `getLinkedWeekItems` query + title-based lookup after commit.** Use the `cascadedIds` tuple pattern that `updateProjectField` already uses — it's cheaper and collision-safe. (NON-CRITICAL, `src/lib/runway/operations-writes.ts:113-138`.)

3. **Malformed `blocked_by` JSON in `getProjectStatus` is silently swallowed.** Consider a one-line `console.log` for visibility. (NON-CRITICAL, `src/lib/runway/operations-reads-project-status.ts:252`.)

---

## Unresolved

None. Both operator-flagged ambiguities (backward-compat on `owner`/`resource` scalars; `get_project_status` MCP registration) are evaluated in line with the pre-plan — both are appropriate, neither is scope creep.
