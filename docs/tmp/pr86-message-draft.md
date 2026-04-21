# PR #86 — Runway v4 Convention + Cleanup

Against `upstream/runway`. Draft prepared by Chunk 5 agent. TP to review, amend, and open.

---

## Title

`feat(runway): v4 convention — retainer fields, dependencies, plate summary, In Flight, cascade audit`

*(70 chars — fits GitHub's display width.)*

---

## Body

### Summary

Locks the v4 runway convention across schema, server layer, bot, UI, and 7 clients' data. Introduces retainer/engagement metadata on L1, explicit `blocked_by` dependencies on L2, start/end date spans everywhere, cascade audit linkage via `triggeredByUpdateId`, and a batch of plate-summary refinements (past-end detector, retainer renewal pill, contract-expired pill, In Flight toggle). Chunks 1-5 are fully integrated on `feature/runway-pr86-base` and merged into this branch.

See `docs/tmp/runway-v4-convention.md` for the authoritative field + behavior reference that all code and data should now match.

### Why

The overnight v1 cleanup (from PR #84) landed a single-date L2 model, primary-helper resources, and no first-class retainer handling. Operator spent two weeks working around those limits — retainer span expressed in notes, dependencies inferred by eye, stale L2s not surfaced by status — and the data drifted client-by-client. v4 bakes in the patterns that actually matched agency workflow, then sweeps the 7 active client roll-ups to the new shape so the board, bot, and migrations converge.

### What changed

**Schema (Chunk 4 — merged):** 9 new columns.

- `projects.start_date`, `projects.end_date` — derived from children's min/max on every L2 write via `recomputeProjectDates`.
- `projects.contract_start`, `projects.contract_end` — manual retainer overrides.
- `projects.engagement_type` — `project / retainer / break-fix`.
- `week_items.start_date`, `week_items.end_date` — null end = single-day; drives overdue + In Flight logic.
- `week_items.blocked_by` — JSON array of L2 ids; resolved by server to `{id, title, status}` for UI dependency rendering.
- `updates.triggered_by_update_id` — links cascade-generated audit rows to their parent status/field change for the updates channel + undo trail.

Backfill script (`scripts/runway-migrations/schema-backfill-v4-2026-04-21.ts`) populated `start_date` / `end_date` on 63 week items and 23 projects before code started reading them.

**Server layer (Chunks 1 + 2 — merged):**

- `getPersonWorkload` rewrote to v4 contract: status-aware buckets (`overdue / thisWeek / nextWeek / later`), stub filter for `awaiting-client` parent L1s, owner inheritance, Chicago-anchored "today."
- Flag detectors exclude completed/on-hold/awaiting-client from stale + bottleneck counts; completed items dropped from capacity math.
- `updateProjectStatus` cascades to all L2 categories (not just `deadline`), emits per-L2 `cascade-status` audit rows linked via `triggeredByUpdateId`.
- `updateProjectField.dueDate` cascade emits per-L2 `cascade-duedate` audit rows with the same linkage.
- `getProjectStatus(clientSlug, projectName)` + `get_week_items_by_project(projectId)` — new drill-down primitives for bot + UI.
- Resources string parser (v4 convention: `,` = concurrent peers, `->` = sequential handoff) with canonical-arrow normalization on write.
- Bot prompt v4 context — convention summary, category tone modulation, smart plate framing.

**UI (Chunk 3 — merged):**

- Unified Project View: L1 + children rendered together under "by-account."
- Soft flag plate: retainer renewal pill, contract-expired pill.
- Past-end note rendered inline on cards whose `end_date < today` but `status` still `in-progress`.
- `blocked_by` dependency cue on card headers with title + status of blockers.
- In Flight toggle (default ON, persisted in `view_preferences` JSON); filters to `status='in-progress' AND today ∈ [start, end]`.

**Data (7 client realigns — merged):** Bonterra, Convergix, Soundly, LPPC, TAP, HDL, Asprey. Every migration committed as `scripts/runway-migrations/<client>-v4-<date>.ts` with a matching `*-REVERT.ts`. Pre-snapshots in `docs/tmp/<client>-pre-snapshot-*.json`, post-snapshots in `docs/tmp/<client>-post-snapshot-*.json`. All applied to prod Turso with `batch_id` audit tags.

**Chunk 5 polish (this chunk):**

- Past-end L2 detector on flags rail (`detectPastEndL2s`) — rolls up cards already rendered inline.
- `PROJECT_FIELDS` whitelist extended to include `engagementType`, `contractStart`, `contractEnd` (closes the Soundly raw-SQL workaround).
- `bucketWeekItem` now excludes completed L2s from forward buckets.
- `recomputeProjectDates` moved inside write transactions at all 4 call sites + no-op skip when derived values are unchanged.
- `normalizeResourcesString` wired into every resources/team write path.
- `updateProjectStatus` uses a cascade tuple pattern (no double `getLinkedWeekItems` query, no title-collision risk).
- Malformed `blocked_by` JSON now logs a structured warning instead of silently dropping.
- `resolveBlockedByRefs` cross-week invariant documented.
- InFlightSection `today` derivation moved inside `useMemo`.
- Drizzle 0001 SQL expanded to match the snapshot + 0002 migration added for `view_preferences` table.
- Batch-update skill audit — findings in `docs/tmp/batch-update-audit-2026-04-21.md`.
- 3 tests added for view-preferences fallback branch + the blocked_by log + normalize-on-write integration.

### Root causes addressed

- **L2 status unchanged past end_date** — now detected as critical/warning flags and rendered inline.
- **Retainer span lost in notes** — first-class `contract_end` + engagement_type.
- **Cascade audit invisible in updates channel** — `triggeredByUpdateId` links parent → children.
- **Stale derived dates after a crash between child write and parent recompute** — recompute now runs inside the same tx.
- **Spurious `updated_at` bumps from no-op recomputes** — skip when derived values unchanged.
- **Resources stored in drift formats (`=>`, `→`, whitespace noise)** — canonical form on write.
- **Future-dated completed L2s inflating plate counts** — bucket filter added.

### Deployment notes

1. **Schema:** already pushed to prod Turso via `pnpm runway:push`. Both drizzle migrations (0001 expanded + 0002 view_preferences) are reconciled with the snapshot for fresh-DB replays, but prod is ahead of both — they are no-ops for the existing Turso DB.
2. **Data:** all 7 client v4 realigns already applied to prod (see commit trail + audit rows tagged `*-v4-*-2026-04-21`).
3. **Vercel deploy:** click-through to promote preview → prod after merge. No env var changes. No new secrets.
4. **Slack:** cleanup batches were NOT run through `runway:publish-updates` (per project memory: low-signal for channel). Post-merge retainer/contract flows WILL emit notifications on the next user-driven write.
5. **Rollback:** every data migration has a matching `*-REVERT.ts`. Schema columns are additive and nullable — reverting the code alone is safe.

### Deferred (documented, not blocking this PR)

- **Missing Bonterra Design L2s** — pre-existing audit trail gap (2 expected L2s absent from prod, no delete audit rows). Pre-dates PR #86. Post-merge investigation.
- **Soundly audit rows missing `batchId`** — minor filtering impact on `publish-updates --batch`; data is correct. Post-merge touchup.
- **Chunks 1/2 mid-series commits not bisect-safe** — test commits bundle fixture updates for two features that landed earlier. Squash-merge eliminates if operator prefers clean history.
- **Team roster interpretation inconsistency** — Soundly normalized with full-team, others with engaged-roles only. Operator ratification post-merge.

### Verification

- `pnpm test:run` — **1666 tests pass**, 0 failures, 101 test files.
- `pnpm build` — production build succeeds; all 25 routes compile.
- `pnpm lint` — 0 errors; 4 pre-existing warnings unrelated to this PR (TanStack Table incompatibility + unused mock helper).
- `drizzle-kit generate --config drizzle-runway.config.ts` — **"No schema changes, nothing to migrate"**; snapshot + SQL fully reconciled.
- Runtime smoke: local `pnpm dev` renders `/runway` without runtime errors, In Flight toggle toggles, past-end flag surfaces on the rail, bot plate query returns v4-shaped response.

### Commits by wave

- **Wave 1** (schema + data): 9 code commits (Chunk 4 schema + Chunk 1 queries) + 6 client realign pairs + 1 Asprey pair = 21 commits.
- **Wave 2** (bot + UI): 2 merge integrations + 7 feat commits covering the v4 bot prompt, drill-down tools, cascade audit, L2 owner inheritance, soft flags, In Flight toggle, and unified Project View.
- **Wave 3** (polish, this chunk): 11 commits — past-end detector, whitelist extension, bucket filter, transaction safety + no-op skip, normalize-on-write, cascade tuple refactor, blocked_by log + invariant comment, view-preferences tests, InFlight memo fix, drizzle drift reconciliation, skill audit.

Total: 61 commits against `upstream/runway`.

### References

- `docs/tmp/runway-v4-convention.md` — the authoritative v4 reference.
- `docs/tmp/pr86-orchestration-amendment.md` — how the work was orchestrated across 4 concurrent agents.
- `docs/tmp/pr86-wave-1-2-details.md` — client-by-client summary.
- `docs/brain/pr86-chunk4-known-debt.md` — 14-item debt list; 9 resolved in Chunk 5, 4 deferred (documented above), 1 filed separately.
- `docs/tmp/batch-update-audit-2026-04-21.md` — Chunk 5 batch-update skill audit.
