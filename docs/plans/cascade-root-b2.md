# B2 — Cascade root hardening (#17 + #16)

Bundled PR closing two cross-dependent cascade bugs. Targets `Hunt-Gather-Create:runway`.

## 1. Problem

**#17 — Fluid Compute concurrency bleed.** Batch state lives in module-level
`let _currentBatchId: string | null = null` at `src/lib/runway/operations-utils.ts:445`,
mutated by `setBatchId()` / read by `getBatchId()` / referenced directly at line 490
inside `insertAuditRecord`. On Fluid Compute a single Node instance serves many
concurrent requests, so a `set_batch_mode("A")` from request 1 leaks into request 2's
audit rows (tagged `A` instead of null) and into request 2's Slack-suppression checks
(silently suppressed because `getBatchId()` is truthy). `batch_apply` has the same
issue if any other request runs while it is inside its `try { … } finally { setBatchId(null) }`
window. Fix is mechanical: replace the module variable with `AsyncLocalStorage` so the
batch id is request-scoped.

**#16 — Parent date override clobber.** `overrideProjectDate`
(`src/lib/runway/operations-writes-project.ts:434`) writes `projects.start_date` or
`projects.end_date` directly and emits an audit row with
`update_type = "date-override"`. Any subsequent child write in the same batch reaches
`recomputeProjectDatesWith` (`src/lib/runway/operations-writes-week.ts:91`), which
derives MIN/MAX from `weekItems` and unconditionally UPDATEs `projects` if the derived
value differs from current. Existing protection at lines 95–117 only covers retainer
L1s that have L1 children; non-retainer L1s and retainer-L1s with only L2 children are
exposed, so the operator's override gets silently overwritten by the next child write.
Operator-reccoed approach (per issue body) is Option B: helper-level guard, no schema
change. Same-batch detection requires #17's reliable per-request batch id, hence the
bundle.

## 2. Approach — #17 AsyncLocalStorage migration

**New module `src/lib/runway/runway-als.ts`** (≈25 lines). Exports:

```ts
import { AsyncLocalStorage } from "node:async_hooks";
type BatchStore = { batchId: string };
const als = new AsyncLocalStorage<BatchStore>();
export function withBatchId<T>(batchId: string, fn: () => Promise<T>): Promise<T>;
export function getCurrentBatchId(): string | null;
```

**`operations-utils.ts` swap (load-bearing).** Delete `_currentBatchId`. Rewrite
`getBatchId()` to `return getCurrentBatchId();`. Rewrite `setBatchId(id)` as a
**deprecated thin shim** that no-ops when called with a value and logs a one-line
`console.warn` (`"setBatchId() is deprecated; use withBatchId(id, fn)"`). It stays
exported only so legacy tests and the migration runner compile until they are
rewritten in the same PR. After PR lands and downstream callers are migrated, a
follow-up issue removes the shim. Direct read at line 490 swaps to
`getCurrentBatchId()`.

**Entry-point wrappers** (every place that today calls `setBatchId(id)` … `setBatchId(null)`):

1. `src/lib/mcp/runway-tools.ts:1032` — `batch_apply` body wraps its entire `for (const op of ops)` loop in `withBatchId(batchId, async () => { … })`. Drop the `finally { setBatchId(null) }`. **This is the only batch entry point that today actually pairs set/clear correctly.**
2. `src/lib/mcp/runway-tools.ts:824` — `set_batch_mode` becomes a **no-op tool that returns an error message**: "set_batch_mode is deprecated under per-request batch scoping. Use batch_apply with a batchId for multi-op batches." The standalone "set the flag, fire a sequence of unrelated MCP calls, clear the flag" model cannot survive ALS — separate HTTP requests have separate async contexts by design, which is the bug being fixed.
3. `scripts/runway-migrate.ts:167` — wrap `migration.up(ctx)` in `withBatchId(migrationBatchId, async () => migration.up(ctx))`. Drop the `setBatchId(null)` cleanup.

**No-batch behavior.** `getCurrentBatchId()` returns `null` outside any `withBatchId`
scope. Single-request MCP calls and Inngest writes (`slack-modal-submit.ts`) keep
working unchanged — they were already null-batch before. The Slack-suppression checks
(`if (!getBatchId()) postMutationUpdate(...)`) keep posting Slack updates because the
batch id is null, which is correct: those calls were never part of a batch.

**Justification for shim-not-rewrite of `setBatchId`.** The alternative is rewriting
every `setBatchId(...)` test site as `withBatchId(...)` in the same PR. There are 3
real callers and ~10 test sites. Keeping `setBatchId` as a deprecated noisy shim
limits the blast radius of the migration commit and keeps the diff readable; the test
rewrites can be a follow-up that doesn't touch production code.

## 3. Approach — #16 audit-table guard inside `recomputeProjectDatesWith`

**Insertion point.** Inside `recomputeProjectDatesWith` (operations-writes-week.ts:91),
after the retainer-wrapper short-circuit (line 117) and after the no-op skip check
(line 152), before the `executor.update(projects)` call (line 156). The guard runs
only when derived values actually differ from current — the cheapest case stays
zero-query.

**Schema reality check.** The `updates` table (`src/lib/db/runway-schema.ts:114`) has
no top-level `field` column. `overrideProjectDate` writes `field` into the
`metadata` JSON blob (`metadata: JSON.stringify({ field })`,
operations-writes-project.ts:516). The guard query must filter on metadata.

**Query shape (sqlite JSON1).**

```sql
SELECT json_extract(metadata, '$.field') AS field
FROM updates
WHERE project_id = ? AND update_type = 'date-override' AND batch_id = ?;
```

Drizzle exposes `json_extract` via `sql` template. The query returns 0..N rows; build a
`Set<"startDate" | "endDate">` of overridden fields for this batch.

**Per-field guard logic.**

- If `minStart !== current.startDate` AND `overridden.has("startDate")` → keep
  `current.startDate`; only update `endDate`.
- If `maxEnd !== current.endDate` AND `overridden.has("endDate")` → keep
  `current.endDate`; only update `startDate`.
- If both overridden → skip the UPDATE entirely; return `{ startDate: current.startDate, endDate: current.endDate }`.
- If neither overridden → existing behavior, UPDATE both.
- If `getCurrentBatchId()` returns null → guard is a no-op; existing recompute runs.
  Outside a batch the operator isn't doing the override-then-child-write pattern.

**Return shape.** The function returns the dates it wrote. When the guard skips a
field, the return value reflects the kept value (current), not the derived value,
so downstream callers that thread the result into audit metadata stay accurate.

**Cross-batch is intentionally unprotected.** If yesterday's batch overrode
`endDate` and today's separate batch updates a child, recompute runs normally and
overwrites yesterday's override. This matches the operator's stated workaround model
("do it in one batch") and avoids leaking forever-pinned project dates.

## 4. Test strategy

**#17 concurrent-request isolation.** New test in
`src/lib/runway/runway-als.test.ts`:

- Two parallel `withBatchId("A", async () => { … await getCurrentBatchId() … })` and
  `withBatchId("B", async () => { … await getCurrentBatchId() … })` calls that each
  yield via `await new Promise(setImmediate)` between read assertions.
- Assert each call sees its own id, never the other's, across 100 interleavings.
- Negative: outside any `withBatchId`, `getCurrentBatchId()` returns null.

**#16 in-batch clobber prevention.** New test in
`src/lib/runway/operations-writes-week.test.ts` (extend file, use `db.transaction` +
fixture project + fixture child weekItems):

- Inside `withBatchId("test", async () => { … })`: (a) call
  `overrideProjectDate({ field: "startDate", newValue: "2025-01-01" })`, (b) call
  `updateWeekItemField` on a child with a wider date range, (c) read the project row
  and assert `startDate` is still `"2025-01-01"`, `endDate` is the recomputed value.

**#16 per-field granularity.** Override `endDate` only; child write affects
`startDate`; assert `endDate` preserved, `startDate` recomputed.

**#16 cross-batch SHOULD clobber.** Override `startDate` inside batch A, exit batch A,
enter batch B, write a child with a different date range. Assert `startDate` is the
recomputed (clobbered) value. This is the intended behavior — protects against
forever-pinned dates from old overrides.

**#16 no-batch behavior.** Outside any `withBatchId`, override + child write +
recompute clobbers as before. Existing tests cover this; verify they still pass.

**Regression.** All existing tests in
`src/lib/runway/operations-utils.test.ts`, `operations-writes-week.test.ts`,
`operations-reads-health.test.ts`, `runway-tools.test.ts`,
`runway-server.test.ts`, `batch-apply-validators.test.ts` must pass. Tests that today
call `setBatchId("…")` directly continue to compile (shim stays) but log deprecation
warnings; a TODO comment in the test file flags them for follow-up rewrite to
`withBatchId`.

## 5. Risk register

**Other readers of `_currentBatchId`.** Grep confirms 1 direct in-file reader
(operations-utils.ts:490). All external callers route through `getBatchId()`. The
direct read swaps cleanly to `getCurrentBatchId()`.

**`set_batch_mode` deprecation breaks any tool consumer that depended on it.** Grep
across the repo finds no real caller — only the tool definition in
`runway-tools.ts:824` and tests at `runway-tools.test.ts:787` and
`runway-server.test.ts:124`. External MCP clients (Claude Desktop sessions, Open
Brain) may have learned to call it; the deprecation message names the replacement.
**Action: confirm with TP before shipping that operator is willing to deprecate the
standalone tool**. Alternative: keep `set_batch_mode` as a no-op that returns
"batch mode is per-request; use batch_apply" — this is the proposed behavior.

**Slack-suppression continuity.** The 15 `if (!getBatchId()) postMutationUpdate(...)`
checks in `runway-tools.ts` keep working because `getBatchId()` returns the ALS
value. Inside `batch_apply` (wrapped in `withBatchId`), they suppress as today.
Outside a batch they post as today. No behavior change for the legitimate cases.

**Tests that survive.** `operations-utils.test.ts:500-521` (3 `setBatchId`
roundtrips), `operations-reads-health.test.ts:66/71/155/213/227` (5 sites),
`runway-tools.test.ts:787/789/791-792/1057+` (~5 sites). Estimated 13 test sites
keep compiling via the shim. None need behavioral changes; the shim is a noop that
mutates a discarded variable. Follow-up issue tracks the rewrite to `withBatchId`.

**Migration script behavior.** `scripts/runway-migrate.ts` is a one-off Node process,
no concurrency. Wrapping `migration.up(ctx)` in `withBatchId` is purely additive.
**Out-of-scope risk:** the 4 untracked migration scripts in
`scripts/runway-migrations/` (hopdoddy / hdl 2026-05-28 align scripts) are not part of
this PR per the brief — they stay untracked and untouched.

**JSON1 availability.** Turso (libSQL) supports JSON1 functions including
`json_extract`. Confirmed via Drizzle docs for the libSQL driver. If it turns out
Turso's libSQL build is missing JSON1, fallback is `metadata LIKE '%"field":"startDate"%'`
which is correct but uglier. Verify during implementation by running the query in
Drizzle Studio against prod.

**Audit-table read inside a write helper.** `recomputeProjectDatesWith` already does 3
SELECTs before the UPDATE; one more is negligible. The new SELECT runs only when the
derived values differ from current (no-op skip dodges it in the common case). No
index added — the query filters on `project_id` (indexed by FK) and `batch_id`
(unindexed, but per-batch row counts are small).

## 6. Files touched

- `src/lib/runway/runway-als.ts` — NEW. ALS instance + `withBatchId` + `getCurrentBatchId`.
- `src/lib/runway/operations-utils.ts` — delete `_currentBatchId`; rewrite `getBatchId`/`setBatchId` (shim with deprecation warn); swap direct read at line 490.
- `src/lib/mcp/runway-tools.ts` — wrap `batch_apply` body in `withBatchId`; rewrite `set_batch_mode` tool body to return deprecation message.
- `scripts/runway-migrate.ts` — wrap `migration.up(ctx)` in `withBatchId`.
- `src/lib/runway/runway-als.test.ts` — NEW. Concurrency isolation tests.
- `src/lib/runway/operations-writes-week.ts` — add audit-query guard inside `recomputeProjectDatesWith` before the UPDATE.
- `src/lib/runway/operations-writes-week.test.ts` — extend with #16 in-batch + per-field + cross-batch tests.
- (Touch-not-rewrite) `operations-utils.test.ts`, `operations-reads-health.test.ts`, `runway-tools.test.ts`, `runway-server.test.ts`, `batch-apply-validators.test.ts` — keep compiling via shim, leave a `TODO(post-B2)` comment near each `setBatchId` site for the rewrite follow-up.

## 7. Open questions for TP

1. **`set_batch_mode` deprecation.** Plan deprecates the standalone tool with an error message that points to `batch_apply`. Confirm acceptable. Alternative is keeping it as a silent no-op, which I think is worse (operators get no signal that their workflow is broken).
2. **`setBatchId` shim vs full rewrite.** Plan keeps `setBatchId` as a deprecated shim. Alternative is rewriting all 13 test sites in this PR. I lean shim+follow-up to keep the diff focused, but TP can override.
3. **TP brief said consumer file is `src/lib/runway/runway-tools.ts`.** Actual path is `src/lib/mcp/runway-tools.ts`. Confirming you meant the MCP tools file (only one with `setBatchId`/`getBatchId` calls outside of operations-*).
4. **TP brief mentioned ~15 consumers.** Counted 15 `getBatchId()` calls + 2 `setBatchId()` calls in `src/lib/mcp/runway-tools.ts`. Match.
5. **ROADMAP B2 lists #15, #16, #17.** Brief is clear that this PR is #17 + #16 only and #15 ships separately within B2. Confirming.
6. **JSON1 vs `LIKE` fallback for `metadata` field extraction.** Will verify Turso's libSQL build supports `json_extract` during implementation. Fallback documented in §5. Acceptable to leave that determination to implementation?
7. **D-10 (DI-TP for prod writes).** PR is code-only — no data writes. The #16 guard would, if hypothetically backfilled across historical overrides, need to route through DI-TP. This PR doesn't backfill; it only changes future behavior. Confirming this is in line with D-10.

---

After approval, implement in the order in the brief (§"After approval — Step 4"):
#17 first, #16 second, atomic commits, full post-build pipeline, push for operator
to open the PR.
