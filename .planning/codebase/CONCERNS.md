# Codebase Concerns

**Analysis Date:** 2026-08-04
**Repo:** Runway (_R1) - isolated snapshot

---

## Critical Open Bugs (data-cascade cluster)

**Issue #17 - Concurrency bleed on Fluid Compute (PARTIALLY FIXED):**
- Problem: `_currentBatchId` lived as a module-level variable in `src/lib/runway/operations-utils.ts:518`. On Fluid Compute, one Node instance handles many requests at once, so a batch id set by request A leaks into request B's audit rows and Slack-suppression checks.
- Current state: The main source file has been migrated to `AsyncLocalStorage` via `src/lib/runway/runway-als.ts`. `setBatchId()` is now a deprecated no-op shim. `getBatchId()` reads from ALS. The MCP `batch_apply` tool wraps its loop in `withBatchId()`. The standalone `set_batch_mode` MCP tool returns a deprecation error.
- Remaining gap: 5 migration scripts still call the deprecated `setBatchId()` directly, which is now a silent no-op. Those scripts run against prod Turso without batch scoping. Files: `scripts/runway-migrations/2026-04-21-migrate-target-to-notes.ts`, `2026-04-21-backfill-scheduled-status.ts`, `retainer-v4-cleanup-2026-04-21.ts`, `retainer-v4-cleanup-2026-04-21-REVERT.ts`, `hdl-website-build-cleanup-2026-04-20.ts`.
- Impact: Migration scripts that relied on batch-id-driven Slack suppression will fire Slack notifications they were intended to suppress. Audit rows from those scripts carry no batch tag.
- Fix: Wrap each migration script's `up()` call in `withBatchId(id, async () => { ... })` and remove the `setBatchId` import. Tracked as B2 follow-up in ROADMAP.md.

**Issue #16 - Parent date override clobbered by child-triggered recompute (PARTIALLY FIXED):**
- Problem: `overrideProjectDate()` in `src/lib/runway/operations-writes-project.ts:570` writes `projects.start_date` or `projects.end_date`. Any subsequent child write in the same batch calls `recomputeProjectDatesWith()` in `src/lib/runway/operations-writes-week.ts:127`, which derives MIN/MAX from child rows and can overwrite the operator's manual override.
- Current state: The per-batch double-write guard is implemented (line 121 comment confirms it). The guard uses the ALS batch id from #17 to detect same-batch date overrides. But #17 migration is incomplete for scripts (see above), so the guard may not fire correctly during migration runs.
- Remaining gap: The guard depends on a reliable per-request batch id (#17). As long as 5 migration scripts use the no-op `setBatchId`, those scripts run with null batch id and the override guard degrades.
- Files: `src/lib/runway/operations-writes-week.ts:95-130`, `src/lib/runway/operations-writes-project.ts:570`.
- Fix: Complete #17 script migration. Tracked as B2 in ROADMAP.md.

**Issues #5 / #8 - Cascade-statuses + retainer wrapper guard:**
- Problem: Cascade status propagation and retainer L1 wrapper guarding. Depends on B2 (issues #16, #17) being stable first.
- Status: Queued as Branch B3. Not yet in progress.
- Files: `src/lib/runway/operations-utils.ts` (CASCADE_STATUSES constant), `src/lib/runway/operations-writes-project.ts`.

---

## Tech Debt

**Deprecated `setBatchId` shim still in codebase:**
- Issue: The `setBatchId` export in `src/lib/runway/operations-utils.ts:527` is a silent no-op retained only for compilation compatibility. It emits a one-time `console.warn` per process, which is easy to miss in prod logs.
- Files: `src/lib/runway/operations-utils.ts:527-534`, plus 5 callers in `scripts/runway-migrations/`.
- Impact: No runtime error. Silent loss of batch-id context in the 5 migration scripts.
- Fix: Migrate scripts to `withBatchId` then remove the shim. Removal is a tracked follow-up per cascade-root-b2.md.

**`require()` workarounds for Turbopack static analysis:**
- Issue: `react-dom/server` cannot be statically imported in Next.js App Router entrypoints under Turbopack. Three files use `require("react-dom/server")` to bypass the analyzer.
- Files: `src/lib/runway/gantt/GanttTemplate.tsx:24`, `src/app/api/runway/gantt-embed/route.ts:32`, `src/lib/runway/gantt/share-orchestrator.ts`.
- Impact: Fragile workaround. If Turbopack starts tracing `require()` calls, these break. The pattern is documented in-file as intentional until a first-class solution exists.
- Fix: Watch for upstream Turbopack support for dynamic server imports. No immediate action required.

**Free Turso tier for production database:**
- Issue: `RUNWAY_DATABASE_URL` points to a Turso database on the free tier. No SLA, limited connections, no backup guarantees.
- Noted in: `STATUS.md` ("will migrate to dedicated R1 instance later"), `DECISIONS.md D-08`.
- Impact: Data loss or outage risk if free tier limits are hit or account changes.
- Fix: Migrate to dedicated Turso instance. Deferred by operator with no target date.

**50+ open GitHub issues, backlog untriaged:**
- Issue: `STATUS.md` notes 50+ open issues on `jasonburks23/_R1`. The critical cascade cluster (#5 / #8 / #16 / #17) is queued but not all remaining issues have priority assignments.
- Files: ROADMAP.md, STATUS.md.
- Impact: Unknown bugs may be in the long tail. The B10 concurrency hardening follow-up (issues #44, #50: TTL leak, parallelization) is queued behind B2 and not yet started.

---

## Security Considerations

**WorkOS cookie password falls back to empty string:**
- Risk: `src/lib/auth.ts:10` reads `WORKOS_COOKIE_PASSWORD` with `|| ""` fallback. If the env var is unset, `iron-session`'s `unsealData` will attempt to decrypt with an empty password, which will fail gracefully (returns null). However, this is a silent misconfiguration: the `/runway` routes are WorkOS-gated in theory but the `WORKOS_*` vars are intentionally unset on this Vercel project (D-03). WorkOS auth is effectively disabled on runway.startround1.com. The only gate is the shared password at `/runway/auth`.
- Files: `src/lib/auth.ts:10`, `proxy.ts:1` (WorkOS middleware armed but no-ops).
- Current mitigation: D-03 locks this as intentional. Password gate uses HMAC-SHA256 with `RUNWAY_AUTH_SECRET`, timing-safe comparison, 500ms wrong-password delay, and `httpOnly` / `secure` cookies. Implementation is sound.
- Recommendation: Document in runbook that removing `RUNWAY_AUTH_SECRET` from Vercel env would leave `/runway` open. No SSO fallback.

**MCP endpoint uses simple string equality for bearer token:**
- Risk: `src/app/api/mcp/runway/route.ts:24` compares `token === apiKey` with plain `===`. This is not timing-safe. A timing attack could theoretically enumerate the key one character at a time.
- Files: `src/app/api/mcp/runway/route.ts:24`.
- Current mitigation: The key (`RUNWAY_MCP_API_KEY`) is a long random string. The route is POST-only. Timing attack is impractical but not impossible.
- Recommendation: Replace `token === apiKey` with `timingSafeEqual` (same pattern used in `src/lib/runway/auth-cookie.ts:52`). Low effort, closes the theoretical gap.

**Gantt embed secret absent in dev silently proceeds without auth:**
- Risk: `src/app/api/runway/gantt-embed/route.ts:47-56` hard-fails in production when `RUNWAY_EMBED_SECRET` is unset, but in dev/staging it logs a warning and serves without auth. If a staging deploy is accidentally pointed at prod data (per `STATUS.md`: "canary deploys point at PROD Turso"), the embed endpoint is open.
- Files: `src/app/api/runway/gantt-embed/route.ts:47-56`.
- Current mitigation: Warning logged. Dev-only by design.
- Recommendation: Add a canary-deploy guard or require the secret in non-production Vercel preview environments that connect to prod Turso.

**Per-PR canary deploys write to production Turso:**
- Risk: `STATUS.md` explicitly states "Per-PR canary deploys point at PROD Turso. Do not interact with canary URLs like a normal user (clicks write to prod)." This is a manual discipline rule with no technical enforcement.
- Files: `STATUS.md` (process note only).
- Impact: Accidental prod data writes during QA on canary URLs.
- Recommendation: Add a banner or read-only mode to canary deployments, or use a staging Turso instance for preview deploys.

---

## Fragile Areas

**`src/app/api/slack/interactivity/route.ts` (1,625 lines):**
- Why fragile: This is the largest non-test source file. It handles Slack modal submissions, block actions, view callbacks, retainer toggles, client select, and date-type changes - all in one route handler. It has an extensive test file (3,575 lines).
- Safe modification: Any change requires reading the full handler dispatch logic. Add tests before touching any branch. The file dispatches on `payload.type` and `payload.actions[0].action_id` strings - silent no-match falls through to a 200 ack with a `console.warn`.
- Files: `src/app/api/slack/interactivity/route.ts`, `src/app/api/slack/interactivity/route.test.ts`.

**`src/lib/runway/operations-utils.ts` (1,576 lines):**
- Why fragile: Core utilities for all Runway data operations. Contains the batch-mode machinery (now ALS-based), field validators, audit record builder, and constants. Any change to exported names or signatures cascades to every operations-writes-*.ts file.
- Safe modification: Treat every export as a public API. Add tests for any new utility before merging. The deprecated `setBatchId` shim must remain until all 5 migration scripts are migrated.
- Files: `src/lib/runway/operations-utils.ts`.

**`src/lib/runway/gantt/GanttTemplate.tsx` (1,318 lines):**
- Why fragile: Renders the Gantt chart to static HTML via `renderToStaticMarkup`. Uses `require("react-dom/server")` Turbopack bypass. Used by both the embed route and the share flow. CSS is injected via `dangerouslySetInnerHTML` (static strings, not user data).
- Safe modification: Do not add static imports of `react-dom/server` anywhere in the App Router import graph touching this file. Test render output after any structural change.
- Files: `src/lib/runway/gantt/GanttTemplate.tsx`, `src/app/api/runway/gantt-embed/route.ts`.

---

## Performance Bottlenecks

**`src/lib/actions/knowledge.ts` (2,032 lines):**
- Problem: Largest single source file. Knowledge sync and retrieval logic. Not profiled in any file reviewed, but size alone suggests high cognitive complexity and potential for N+1 queries.
- Files: `src/lib/actions/knowledge.ts`.
- Improvement path: Profile the knowledge sync endpoint under load. Split into smaller modules.

**Turso free tier connection limits:**
- Problem: All Runway prod reads and writes share a single Turso free-tier connection pool. Under concurrent Inngest jobs + MCP calls + SSR requests, connection exhaustion is possible.
- Files: `src/lib/db/runway.ts` (client factory).
- Improvement path: Migrate to dedicated Turso instance (D-08, deferred).

---

## Scaling Limits

**Runway DB on free Turso tier:**
- Current capacity: Free tier (row limits, connection limits not documented in repo).
- Limit: Unknown. Free tier may throttle or reject writes under load.
- Scaling path: Migrate to dedicated Turso instance per D-08.

**`set_batch_mode` MCP tool is permanently deprecated:**
- Current capacity: Any AI consumer that used `set_batch_mode` to scope a multi-op batch across separate HTTP requests can no longer do so. The tool returns an error message.
- Impact: Any orchestration pattern that relied on cross-request batch scoping is broken. `batch_apply` is the replacement for single-request multi-op batches.
- Files: `src/lib/mcp/runway-tools.ts:954-961`.

---

## Dependencies at Risk

**`iron-session` for WorkOS cookie decryption:**
- Risk: Used in `src/lib/auth.ts` to decrypt WorkOS session cookies. WorkOS is intentionally disabled on this deployment (D-03). If WorkOS is ever enabled, `iron-session` version compatibility with WorkOS SDK must be verified.
- Files: `src/lib/auth.ts`.

**`@workos-inc/authkit-nextjs` middleware armed but dormant:**
- Risk: `proxy.ts` imports and applies WorkOS middleware, but `WORKOS_*` env vars are unset. The middleware no-ops. If env vars are accidentally set, WorkOS auth would activate without any operator review of the stacked-gate behavior. D-03 locks this as intentional.
- Files: `proxy.ts`.

---

## Test Coverage Gaps

**Migration scripts have minimal test coverage:**
- What is not tested: The 52 files in `scripts/runway-migrations/` are mostly untested scripts that run against prod Turso. Only a handful have paired `.test.ts` files (e.g., `retainer-v4-cleanup-2026-04-21.test.ts`, `schema-backfill-v4-2026-04-21.test.ts`, `001-april-14-updates.test.ts`).
- Files: `scripts/runway-migrations/*.ts` (approximately 45 untested).
- Risk: A migration script error writes bad data to prod with no automated catch. The DI-TP pipeline (D-10) adds a dry-run + holdout QA step, but test coverage gaps remain.
- Priority: High (prod data writes).

**MCP tool input validation is partial:**
- What is not tested: `src/lib/mcp/runway-tools.ts` uses `zod` for some tool schemas but validation coverage is not uniform across all tools. Only 2 zod usages found in the file.
- Files: `src/lib/mcp/runway-tools.ts`.
- Risk: Malformed MCP tool calls could reach operations-writes functions with unexpected input shapes.
- Priority: Medium.

---

## Misc Notes

**`local.db.bak` committed to repo:**
- `local.db.bak` (45KB) is present in the repo root and is NOT listed in `.gitignore`. `local.db` and `runway-local.db` are gitignored, but the `.bak` variant is not.
- Files: `/local.db.bak` (repo root).
- Risk: If this file contains real client data it should not be committed. Recommend: add `*.db.bak` to `.gitignore` and audit file contents before next push.
- Priority: HIGH - check contents, remove if it contains real data.

---

*Concerns audit: 2026-08-04*
