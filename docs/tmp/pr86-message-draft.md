# PR #86 - Runway v4 Convention + MCP Tool Surface Expansion

Against `upstream/runway`. Draft prepared by Chunk 5 agent, expanded by Phase 3 Agent 6 to cover the rolled-in MCP enrichment scope. TP to review, amend, and open.

---

## Title

`feat(runway): v4 convention + MCP tool surface expansion`

*(63 chars - fits GitHub's display width.)*

Alternate (original, narrower): `feat(runway): v4 convention - retainer fields, dependencies, plate summary, In Flight, cascade audit`

Operator preference: short title with MCP expansion called out in the subtitle line of the body.

---

## Body

### Summary

Locks the v4 runway convention across schema, server layer, bot, UI, and 7 clients' data - AND fully enriches the MCP + Slack bot tool surface so every v4 field is readable from AI callers without out-of-band queries.

Two scopes ride together:

1. **v4 convention (Chunks 1-5, merged waves 1-3).** Retainer / engagement metadata on L1, explicit `blocked_by` dependencies on L2, start/end date spans everywhere, cascade audit linkage via `triggeredByUpdateId`, plate-summary refinements (past-end detector, retainer renewal pill, contract-expired pill, In Flight toggle). 7 client realigns.
2. **MCP + bot tool surface expansion (Phase 1-3).** 10 new read tools across Tier 2 (deep views + audit trail) and Tier 3 (observability), enrichment of 4 existing Tier 1 tool schemas, a shared `MutationResponse<D>` shape that surfaces cascade detail on every write, 7 description corrections to match v4 response shapes, and a new "Soft flags" section in the bot prompt that teaches the LLM to proactively surface `flags.contractExpired` + `flags.retainerRenewalDue`.

See `docs/tmp/runway-v4-convention.md` for the authoritative field + behavior reference that all code and data now match, and `docs/mcp-runway-tools.md` for the tool surface contract.

### Why

The overnight v1 cleanup (PR #84) landed a single-date L2 model, primary-helper resources, and no first-class retainer handling. Operator spent two weeks working around those limits - retainer span expressed in notes, dependencies inferred by eye, stale L2s not surfaced by status - and the data drifted client-by-client. v4 bakes in the patterns that actually matched agency workflow, then sweeps the 7 active client roll-ups to the new shape so the board, bot, and migrations converge.

Rolling the MCP expansion into the same PR was a deliberate call (operator-approved 2026-04-20): the internal v4 functions shipped by Chunks 1-5 weren't reachable through the MCP / bot surface in the shape AI callers need. Splitting that into a follow-up PR would have left the Slack bot answering with v1 field names and missing the cascade-audit chain that v4 was built to expose. Single-PR delivery keeps the surface honest.

### What changed

**Schema (Chunk 4 - merged):** 9 new columns.

- `projects.start_date`, `projects.end_date` - derived from children's min/max on every L2 write via `recomputeProjectDates`.
- `projects.contract_start`, `projects.contract_end` - manual retainer overrides.
- `projects.engagement_type` - `project / retainer / break-fix`.
- `week_items.start_date`, `week_items.end_date` - null end = single-day; drives overdue + In Flight logic.
- `week_items.blocked_by` - JSON array of L2 ids; resolved by server to `{id, title, status}` for UI dependency rendering.
- `updates.triggered_by_update_id` - links cascade-generated audit rows to their parent status/field change for the updates channel + undo trail.

Backfill script (`scripts/runway-migrations/schema-backfill-v4-2026-04-21.ts`) populated `start_date` / `end_date` on 63 week items and 23 projects before code started reading them.

**Server layer (Chunks 1 + 2, Phase 1 - merged):**

v4 rewrite of core reads + cascade writes:

- `getPersonWorkload` rewrote to v4 contract: status-aware buckets (`overdue / thisWeek / nextWeek / later`), stub filter for `awaiting-client` parent L1s, owner inheritance, Chicago-anchored "today."
- Flag detectors exclude completed / on-hold / awaiting-client from stale + bottleneck counts; completed items dropped from capacity math.
- `updateProjectStatus` cascades to all L2 categories (not just `deadline`), emits per-L2 `cascade-status` audit rows linked via `triggeredByUpdateId`.
- `updateProjectField.dueDate` cascade emits per-L2 `cascade-duedate` audit rows with the same linkage.
- `getProjectStatus(clientSlug, projectName)` + `getWeekItemsByProject(projectId)` - new drill-down primitives for bot + UI.
- Resources string parser (v4 convention: `,` = concurrent peers, `->` = sequential handoff) with canonical-arrow normalization on write.
- Bot prompt v4 context - convention summary, category tone modulation, smart plate framing.

Phase 1 enrichment + new reads (see MCP section below for how these surface):

- Tier 1 enriched in place: `getProjectsFiltered`, `getWeekItemsData`, `getClientsWithCounts` (plus new `includeProjects` opt), `getUpdatesData` (new params: `since`, `until`, `batchId`, `updateType`, `projectName`).
- Tier 2 new functions: `getOrphanWeekItems`, `getWeekItemsInRange`, `findUpdates`, `getUpdateChain`.
- Tier 3 new file `operations-reads-health.ts`: `getDataHealth`, `getCurrentBatch`, `getBatchContents`, `getCascadeLog`.
- Additions: `getFlags` (aggregate surface over past-end, stale, bottleneck, retainer-renewal, contract-expired); `getClientDetail` (deep view with team, contacts, contract, projects, pipeline, recent updates).
- New `src/lib/runway/mutation-response.ts`: typed `MutationResponse<D>` shape exposing `cascadeDetail: CascadedItemInfo[]` and `reverseCascadeDetail: ReverseCascadeInfo | null`. Populated by `updateProjectStatus`, `updateProjectField` (on `dueDate`), and `updateWeekItemField` (on deadline-category `date`). Backward-compatible with the existing `OperationResult` union - every `message / ok / data.*` field used by current callers is preserved verbatim.

**UI (Chunk 3 - merged):**

- Unified Project View: L1 + children rendered together under "by-account."
- Soft flag plate: retainer renewal pill, contract-expired pill.
- Past-end note rendered inline on cards whose `end_date < today` but `status` still `in-progress`.
- `blocked_by` dependency cue on card headers with title + status of blockers.
- In Flight toggle (default ON, persisted in `view_preferences` JSON); filters to `status='in-progress' AND today ∈ [start, end]`.

**Data (7 client realigns - merged):** Bonterra, Convergix, Soundly, LPPC, TAP, HDL, Asprey. All applied to prod Turso with `batch_id` audit tags. Filename convention splits by scope:

- 2 touchup realigns (tactical field updates): `bonterra-v4-touchup-2026-04-21.ts`, `asprey-v4-touchup-2026-04-21.ts`.
- 5 full realigns (structural rewrites): `convergix-v4-realign-2026-04-21.ts`, `soundly-v4-realign-2026-04-21.ts`, `lppc-v4-realign-2026-04-21.ts`, `tap-v4-realign-2026-04-21.ts`, `hdl-v4-realign-2026-04-21.ts`.
- Plus `schema-backfill-v4-2026-04-21.ts` for the derived-dates backfill.

All match the `<client>-v4-*` glob; every forward script has a matching `*-REVERT.ts`. Pre-snapshots in `docs/tmp/<client>-pre-snapshot-*.json`, post-snapshots in `docs/tmp/<client>-post-snapshot-*.json`.

A single pre-Phase-1 cleanup also rides along: `scripts/runway-migrations/bonterra-cleanup-2026-04-19.ts` (commit `187b958`). This landed on the base branch before the v4 scope started; it predates the convention and is a one-time data fix, not a v4 realign. Included here because the branch is cut from the commit that carries it.

Additional pre-Phase-1 cleanup: `chore(runway): archive pre-v4 cleanup migration scripts` (commit `3fa4f97`) moves 10 pre-v4 one-off scripts into `scripts/runway-migrations/_archive/` so the active directory reads as "v4 realigns + the single pre-PR Bonterra fix." And `fix(runway): normalize team on createClient write path` (commit `f7be99b`) fixes a createClient bug where `team` strings weren't run through `normalizeResourcesString`.

**Chunk 5 polish (Wave 3):**

- Past-end L2 detector on flags rail (`detectPastEndL2s`) - rolls up cards already rendered inline.
- `PROJECT_FIELDS` whitelist extended to include `engagementType`, `contractStart`, `contractEnd` (closes the Soundly raw-SQL workaround).
- `bucketWeekItem` now excludes completed L2s from forward buckets.
- `recomputeProjectDates` moved inside write transactions at all 4 call sites + no-op skip when derived values are unchanged.
- `normalizeResourcesString` wired into every resources/team write path.
- `updateProjectStatus` uses a cascade tuple pattern (no double `getLinkedWeekItems` query, no title-collision risk).
- Malformed `blocked_by` JSON now logs a structured warning instead of silently dropping.
- `resolveBlockedByRefs` cross-week invariant documented.
- InFlightSection `today` derivation moved inside `useMemo`.
- Drizzle 0001 SQL expanded to match the snapshot + 0002 migration added for `view_preferences` table.
- Batch-update skill audit - findings in `docs/tmp/batch-update-audit-2026-04-21.md`.
- 3 tests added for view-preferences fallback branch + the blocked_by log + normalize-on-write integration.

**Tooling / config:**

- `eslint.config.mjs` - added `docs/tmp/**` to the ignore list (commit `cc268a6`). Trivial, but the diff shows it; keeps lint focused on `src/`.

### MCP + Bot Tool Surface Expansion

Phase 1 + 2 of the MCP enrichment plan, rolled in per `docs/tmp/pr86-mcp-expansion-plan.md`. Phase 3 produced the reference doc and this message rewrite.

**Read enrichment (Tier 1 - 4 existing tools enriched):**

Every Tier 1 tool now returns the v4 fields AI callers need, and the tool descriptions name the return-shape keys concretely instead of hand-wavy prose.

- `get_projects` - now returns `id`, `dueDate`, `updatedAt`, `resources`, `startDate`, `endDate`, `engagementType`, `contractStart`, `contractEnd` in addition to the pre-PR fields.
- `get_week_items` - now returns `id`, `projectId`, `clientId`, `status`, `updatedAt`, `batchId`, `startDate`, `endDate`, `blockedBy`.
- `get_clients` - new `includeProjects: boolean` param; when set, nests the client's v4-enriched `projects[]` array so the bot can answer "what's on Convergix's plate" without a second tool call.
- `get_updates` - new params: `since`, `until`, `batchId`, `updateType`, `projectName`. Lets the bot scope audit-trail questions precisely.

**New reads (Tier 2 + Tier 3 + additions - 10 new tools):**

Registered in both `src/lib/mcp/runway-tools.ts` (MCP server) and `src/lib/slack/bot-tools.ts` (AI SDK surface the Slack bot LLM consumes). Bot tool-count assertion goes from 23 to 33.

Tier 2 - deep views + audit trail (5 tools):

- `get_client_detail(slug)` - deep view: team, contacts, contract, projects, pipeline, recent updates. One call instead of five.
- `get_orphan_week_items(clientSlug?)` - L2s with `projectId = null`. Used by data-health triage.
- `get_week_items_range(fromDate, toDate, clientSlug?, owner?, category?)` - L2s in a date window.
- `find_updates(since?, until?, clientSlug?, updatedBy?, updateType?, batchId?, projectName?)` - audit-trail search returning `AuditUpdate[]` with `id`, `batchId`, `triggeredByUpdateId`.
- `get_update_chain(updateId)` - walks cascade linkage from any update id to root + leaves via `triggeredByUpdateId`.

Tier 3 - observability + flags (5 tools, new file `operations-reads-health.ts`):

- `get_flags(clientSlug?, personName?)` - single surface over past-end, stale, bottleneck, retainer-renewal, contract-expired.
- `get_data_health` - totals, unlinked count, stale count, batch state.
- `get_current_batch` - active batch id + metadata for THIS process.
- `get_batch_contents(batchId)` - all audit rows in a batch.
- `get_cascade_log(windowMinutes)` - cascade rows grouped by parent in a time window.

**Write cascade surfacing (`MutationResponse<D>` shape):**

All mutation tools in `src/lib/mcp/runway-tools.ts` now return JSON-wrapped responses via `OperationResult` / `MutationResponse<D>`, so AI callers can read `cascadeDetail` / `reverseCascadeDetail` fields directly instead of scraping prose.

- `update_project_status` - returns `cascadeDetail: CascadedItemInfo[]` enumerating every L2 that inherited the new status, with per-item `previousValue`, `newValue`, and `auditId` (so the bot can link back to the audit rows via `triggeredByUpdateId`).
- `update_project_field` - same `cascadeDetail` shape when the field is `dueDate`.
- `update_week_item_field` - returns `reverseCascadeDetail: ReverseCascadeInfo | null` when a deadline-category L2 date change bubbles back up to the parent project's `dueDate`.

Backward-compat guarantees documented at the top of `src/lib/runway/mutation-response.ts`: `ok`, `message`, `error`, and every existing `data.*` field are preserved verbatim.

**Description audit (7 tool descriptions corrected):**

Systematic pass over every tool description on both surfaces (MCP + Slack bot) to flag drift vs v4 response shapes. Key correction:

- `get_person_workload` - was "grouped by client"; now accurately describes the v4 contract: `ownedProjects`, bucketed `weekItems` (`overdue / thisWeek / nextWeek / later`), `flags`, and `totals`.

Six other descriptions updated to name the return-shape keys concretely.

**Bot prompt: soft flags awareness**

`src/lib/runway/bot-context-sections.ts` gained a "Soft flags" section in `buildQueryRecipes` that teaches the bot to proactively surface `flags.contractExpired` and `flags.retainerRenewalDue` BEFORE the bucketed plate when those arrays are non-empty. Expired contracts use re-engagement phrasing; retainer renewals use proactive "start the conversation" phrasing with the `contract_end` date. When both flag sets are empty, the bot stays silent on flags to avoid noise on standard plate responses. Contract-regression test asserts the section exists, names both flag keys, appears before smart plate framing, and instructs silence on empty.

### Root causes addressed

v4 convention:

- **L2 status unchanged past end_date** - detected as critical/warning flags and rendered inline.
- **Retainer span lost in notes** - first-class `contract_end` + engagement_type.
- **Cascade audit invisible in updates channel** - `triggeredByUpdateId` links parent → children.
- **Stale derived dates after a crash between child write and parent recompute** - recompute now runs inside the same tx.
- **Spurious `updated_at` bumps from no-op recomputes** - skip when derived values unchanged.
- **Resources stored in drift formats (`=>`, `→`, whitespace noise)** - canonical form on write.
- **Future-dated completed L2s inflating plate counts** - bucket filter added.

MCP expansion:

- **Bot answering with v1 field names** - tool descriptions drifted from v4 response shapes; systematic audit closed the gap.
- **AI callers couldn't see cascade outcomes** - writes returned `message` prose only; `MutationResponse<D>` now exposes structured `cascadeDetail`.
- **"What's on X's plate" required 5 tool calls** - `get_client_detail` returns the same shape in one call.
- **Audit trail was unreachable from AI** - `find_updates`, `get_update_chain`, `get_cascade_log` make the `triggeredByUpdateId` graph queryable.
- **Observability blind spot** - `get_data_health`, `get_current_batch`, `get_batch_contents` expose batch / drift state to bot conversations.
- **Retainer renewal window missed by bot** - prompt-level guidance now teaches the bot to lead with `flags.contractExpired` / `flags.retainerRenewalDue` when present.

### Deployment notes

1. **Schema:** already pushed to prod Turso via `pnpm runway:push`. Both drizzle migrations (0001 expanded + 0002 view_preferences) are reconciled with the snapshot for fresh-DB replays, but prod is ahead of both - they are no-ops for the existing Turso DB.
2. **Data:** all 7 client v4 realigns + the pre-PR Bonterra cleanup are already applied to prod (see commit trail + audit rows tagged `*-v4-*-2026-04-21` and `bonterra-cleanup-2026-04-19`).
3. **Vercel deploy:** click-through to promote preview → prod after merge. No env var changes. No new secrets.
4. **MCP tool descriptions / schemas** - consumed by the MCP server + the AI SDK bot-tools registry; description changes take effect on next deploy. No schema-migration coordination needed; clients re-read on connect.
5. **Bot prompt** - soft-flags section injected into `buildQueryRecipes`, picked up on next bot restart. If the bot is running in long-lived mode, cycle it post-deploy.
6. **Slack:** cleanup batches were NOT run through `runway:publish-updates` (per project memory: low-signal for channel). Post-merge retainer/contract flows WILL emit notifications on the next user-driven write.
7. **Rollback:** every data migration has a matching `*-REVERT.ts`. Schema columns are additive and nullable - reverting the code alone is safe. The MCP enrichment is additive (new tools, enriched schemas, backward-compat `MutationResponse`); removing any of it does not break existing callers.

### Deferred (documented, not blocking this PR)

- **Missing Bonterra Design L2s** - pre-existing audit trail gap (2 expected L2s absent from prod, no delete audit rows). Pre-dates PR #86. Post-merge investigation.
- **Soundly audit rows missing `batchId`** - minor filtering impact on `publish-updates --batch`; data is correct. Post-merge touchup.
- **Chunks 1/2 mid-series commits not bisect-safe** - test commits bundle fixture updates for two features that landed earlier. Squash-merge eliminates if operator prefers clean history.
- **Team roster interpretation inconsistency** - Soundly normalized with full-team, others with engaged-roles only. Operator ratification post-merge.
- **Drop `projects.target` column** - separate PR, breaking change (documented in MCP expansion plan as out-of-scope).
- **Week item status enum standardization** - behavioral + data migration; separate PR.
- **Title convention migration** - one-off script post-merge.

### Verification

- `pnpm test:run` - **1800 tests pass**, 0 failures, 105 test files. (Baseline before this PR: 1529. Delta: +271 tests across v4 server-layer, UI, MCP + bot tool contracts, mutation-response shape, and description audits.)
- `pnpm build` - production build succeeds; all routes compile.
- `pnpm lint` - 0 errors; 13 warnings - all pre-existing or test-fixture unused imports (9 `@typescript-eslint/no-unused-vars` in drizzle query-builder imports not referenced in specific code paths, 1 `react-hooks/incompatible-library` on TanStack Table, 1 unused mock helper in a pipeline write test, 2 unused params). None introduced by this PR's code paths.
- `drizzle-kit generate --config drizzle-runway.config.ts` - **"No schema changes, nothing to migrate"**; snapshot + SQL fully reconciled.
- Runtime smoke: local `pnpm dev` renders `/runway` without runtime errors, In Flight toggle toggles, past-end flag surfaces on the rail, bot plate query returns v4-shaped response. MCP tool registry loads cleanly via `/api/mcp/runway` with all 33 bot tools and the expanded MCP tool set exposed.

### Commits by wave

- **Wave 0** (pre-Phase-1 base, 3 commits): Bonterra 2026-04-19 cleanup migration (ride-along), archive of 10 pre-v4 cleanup scripts, `createClient` team normalize fix.
- **Wave 1** (schema + data, Chunks 1 + 4): 9 code commits (Chunk 4 schema + Chunk 1 queries) + 6 client realign pairs + 1 Asprey pair = 21 commits.
- **Wave 2** (bot + UI, Chunks 2 + 3): 2 merge integrations + 7 feat commits covering the v4 bot prompt, drill-down tools, cascade audit, L2 owner inheritance, soft flags, In Flight toggle, and unified Project View.
- **Wave 3** (polish, Chunk 5): 11 commits - past-end detector, whitelist extension, bucket filter, transaction safety + no-op skip, normalize-on-write, cascade tuple refactor, blocked_by log + invariant comment, view-preferences tests, InFlight memo fix, drizzle drift reconciliation, skill audit.
- **Phase 1** (MCP reads + write response shape, 18 commits): Tier 1 enrichment across `getProjectsFiltered`, `getWeekItemsData`, `getClientsWithCounts`, `getUpdatesData`; Tier 2 functions (`getOrphanWeekItems`, `getWeekItemsInRange`, `findUpdates`, `getUpdateChain`); Tier 3 file + 4 functions (`getDataHealth`, `getCurrentBatch`, `getBatchContents`, `getCascadeLog`); additions (`getFlags`, `getClientDetail`); `MutationResponse<D>` shape + per-mutation adoption (`updateProjectStatus`, `updateProjectField`, `updateWeekItemField`).
- **Phase 2** (tool registration + description audit + bot prompt, 7 commits): 10 new MCP tools; 10 mirrored bot tools (23 → 33); MCP + bot description audits; bot prompt v4 soft flags.
- **Phase 3** (docs + message, in progress): `docs/mcp-runway-tools.md` checked-in reference; this message rewrite; llama iteration playbook.

Total on branch vs `upstream/runway`: **93 commits**.

### References

- `docs/tmp/runway-v4-convention.md` - the authoritative v4 reference.
- `docs/mcp-runway-tools.md` - MCP + bot tool surface contract (params, return shapes, per-tool description copy).
- `docs/tmp/pr86-mcp-expansion-plan.md` - MCP enrichment scope + execution phases.
- `docs/tmp/pr86-orchestration-amendment.md` - how the original v4 work was orchestrated across 4 concurrent agents.
- `docs/tmp/pr86-wave-1-2-details.md` - client-by-client summary.
- `docs/brain/pr86-chunk4-known-debt.md` - 14-item debt list; 9 resolved in Chunk 5, 4 deferred (documented above), 1 filed separately.
- `docs/tmp/batch-update-audit-2026-04-21.md` - Chunk 5 batch-update skill audit.
- `docs/tmp/pr86-llama-iteration-playbook.md` - post-merge llama iteration playbook.

### Reviewer context: planning artifact volume

~45 files under `docs/tmp/` came along with this PR - orchestration plans, CC pre-plans in `docs/tmp/cc-prompts/` (6 files), QA templates + reports (`docs/tmp/qa-templates/`, `docs/tmp/qa-reports/`), migration specs, client-by-client apply / dryrun logs, pre/post snapshots. Normal volume for orchestration-heavy work across 6 concurrent agents spanning 3 phases. These files are in `docs/tmp/` by convention (see `feedback_temp_docs_convention.md`) - gitignored for stale cleanup but checked in while the work is live. `eslint.config.mjs` was updated to ignore `docs/tmp/**` so these artifacts don't show up in lint reports.
