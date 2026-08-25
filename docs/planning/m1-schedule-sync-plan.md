# M1 Schedule Sync — Planning Doc

**Author:** Runway-TP (Sonnet subagent, 2026-08-13)
**Scope:** EPIC "Runway integration + safe automation" — Milestone M1 only
**Status:** DRAFT, for TP review + operator confirm before any ticket creation or board hookup

---

## A. Standards Digest (tight reference for TP/CC, ~15 lines)

### Ticket shape (mirror agencyos-operational-efficiency #210 / #211)

Every ticket body needs: Why (root cause and impact), Spec (what exactly to build, naming real files and functions), Acceptance Criteria (each independently verifiable, non-vacuous — must plant a true positive and confirm it fires), Gate flow (branch -> Ops gate-1 -> Holdout gate-2 -> Ops merges), References (file paths, prior issues).

### Board fields to set at creation

- Epic name (text field on Fleet Board)
- Milestone name (text field; Ops uses zero-padded names sorted by name, e.g. "01 ...")
- Priority Tier: `top` (blocking arc), `parallel` (runs alongside), or `deferred` (banked)
- Session: set to CC-Alpha when CC picks it up (not at creation)

### Board hookup

Add label `current-work-arc` to put it on the Fleet Board auto-add. For `jasonburks23/_R1` (not agency-os), run the manual one-liner too: `gh project item-add 1 --owner jasonburks23 --url <issue-url>`.

### PR ladder and merge

CC opens the PR. Runway-TP does Preflight (build + lint + smoke + tests). Runway-TP gates before paging operator for merge. Operator is the only merge hand for upstream PRs to Hunt-Gather-Create:runway. All PRs target `Hunt-Gather-Create:runway`, never main.

### Non-vacuity rule (locked by opeff#210)

Any acceptance criterion that touches a new check must plant a TRUE POSITIVE fixture that confirms the check fires, and a mutation pin that breaks the fixture if the check is removed. Never accept a test that calls only a pure classifier without calling the real wrapper.

### Closing

Holdout QA closes verifiable tickets (not CC, not TP). Holdout must cite the gate-2 PASS envelope and the merged `origin/main` SHA. Bare `holdout-verified` label with no evidence comment is invalid.

---

## B. M1 Epic

**Title:** Runway integration + safe automation — M1: Schedule Sync

**Why (plain):** The Google Doc schedules are where account managers and clients live. Runway is where the work actually tracks. Right now they drift apart. Every fix to one has to be typed into the other by hand. M1 finishes the engine that reads both, finds the gaps, and writes only what is safe to write, in a way the team can trust and audit.

**Scope IN:**
- Apply-writes engine that executes the payloads Phase 1a already emits (createWeekItem, updateWeekItemField, addProject)
- Row-identity ledger promoted from on-disk JSON to a `sheet_sync_ledger` DB table
- Google service account wired for deployed Sheet reads (replaces the fixture-file dev path)
- Dry-run + pre-snapshot + apply + post-verify triplet (the DI-TP safety gate, applied per engagement, operator-triggered)
- Timezone fix (#43) so day-bucketing is correct before sync writes land
- CLI and/or MCP surface to trigger a sync run per engagement

**Scope OUT:**
- Runway-to-Sheet write-back (Phase 2/3, issue #92, downstream of M1)
- Intelligent cascade decisions (Phase 3, requires 30 days of M1 data first)
- Staging DB + promotion pipeline (M2)
- Meeting-to-Runway routing (M3)

**M1 is done when:**

A full sync run for at least one real client engagement can be triggered by the operator, reads the current Sheet fixture, matches rows to Runway WIs using the identity ledger, and applies the safe subset of payloads (createWeekItem and updateWeekItemField for actionable deltas) to the Runway prod DB, with a pre-snapshot saved before writes, a post-verify diff showing what changed, an audit trail via `withBatchId`, and zero unguarded prod writes (dry-run mode is always available and defaults on first run per engagement). Holdout QA has verified on merged main.

---

## C. Milestone Name(s)

The roadmap has three milestones. M1 is active. Name following the zero-padded Ops convention:

| Milestone | Name |
|-----------|------|
| M1 (active) | `01 Schedule Sync` |
| M2 (next) | `02 DB Safety Tool` |
| M3 (later) | `03 Meeting Routing` |

All three belong to Epic "Runway integration + safe automation." Only `01 Schedule Sync` has tickets drafted here; M2 and M3 tickets come in future cycles after M1 ships.

---

## D. Existing Issues to Ladder Under M1

These issues already exist on `jasonburks23/_R1`. They belong to M1 scope and should be re-labeled `current-work-arc`, added to the Fleet Board, and assigned the Epic + Milestone fields below. No new issue needed for these scopes.

| # | Title (short) | Scope | Proposed Tier |
|---|---------------|-------|---------------|
| 91 | Phase 1b apply-writes engine | Core writeback engine (createWeekItem, updateWeekItemField, addProject payloads -> real Runway DB writes, ledger-promoted to DB, DI-TP triplet) | top |
| 43 | Timezone: three competing models cause day-bucketing drift | Replace browser-local + UTC `today` derivations with `chicagoISODate()` fleet-wide in the UI layer; DST `.setDate()` fix | top |
| 92 | Phase 2/3 bidirectional + intelligent cascade | Runway-to-Sheet write-back, cascade decisions, formula-safety constraints | deferred (downstream of 91) |
| 40 | Google Sheet integration: tie a sheet to a project | Sheet-to-project config surface; overlaps Phase 1b scope | parallel (design gate needed first) |

Note on #92: the pretriage says it is P2, downstream of #91, and operator confirmed Stage 3 timing = post-Stage 2. File it under `01 Schedule Sync` as deferred so it shows on the board, but do not pick it up until #91 is in prod for at least 30 days.

Note on #40: the sheet-config concept is partially handled by `scripts/runway-sheet-sync/config.ts` (SheetConfig registry). #40 may shift to a UI/API config surface. Park as parallel and revisit after #91 ships.

---

## E. First CC Ticket Batch (new tickets only)

These cover gaps not addressed by any existing issue. Sequenced so Ticket 1 is the smallest unblock, and each ticket can be started as soon as its predecessors land.

---

### Ticket E1: Wire Google service account for deployed Sheet reads

**Title:** Sheet sync: replace fixture-file dev path with deployed service account credentials

**Why:** Phase 1a reads Google Sheets via a local fixture file exported by the google-api skill. That path works for local development but cannot run in Vercel serverless (no local file system, no interactive OAuth). The apply-writes engine (#91) needs real Sheet reads in deployed environments. Without a service account, M1 cannot run on a schedule or from an MCP call.

**Spec:**

- Add a `GOOGLE_SERVICE_ACCOUNT_JSON` env var (base64-encoded service account key) to `.env.local` and Vercel env config.
- In `scripts/runway-sheet-sync/config.ts` (or a new `scripts/runway-sheet-sync/sheets-client.ts`), add a `readSheetViaServiceAccount(sheetId: string, range: string): Promise<SheetFixture>` function that:
  - Parses the env var.
  - Uses `googleapis` (already in the Node.js ecosystem; verify it is in `package.json` or add it) to call `sheets.spreadsheets.values.get`.
  - Returns the same `SheetFixture` shape that the fixture-file path returns, so `parse-sheet.ts` is unchanged.
- In the CLI entry (`scripts/runway-sheet-sync.ts`), add a `--live` flag. Without it, reads from the fixture file (dev mode). With it, calls the service account path. Default stays fixture-file so CI never needs the credential.
- The credential must NOT be committed. Add `*.service-account.json` to `.gitignore` (check if already present).

**Acceptance criteria:**
1. `pnpm runway:sheet-sync --live` (after sourcing `.env.local` with a valid service account) reads the real Soundly sheet without a fixture file present and produces a diff report with non-zero leaf tasks. (Non-vacuity: test with the credential missing and confirm a clear error message rather than a silent empty result.)
2. `pnpm runway:sheet-sync` without `--live` still reads from the fixture file and produces the same output as today. (Regression guard.)
3. A unit test in `parse-sheet.test.ts` or a new `sheets-client.test.ts` stubs the Google API call and confirms the `SheetFixture` shape returned by the service account path matches the fixture-file shape exactly (same fields, same types).
4. `pnpm build` passes with the new env var absent (build is not gated on the credential).

**Gate flow:** branch off fresh runway -> Ops gate-1 (Ops confirms `--live` flag reads real sheet from a cold start without fixture) -> Holdout gate-2 -> Ops merges same cycle -> Holdout closes on merged main.

**References:**
- `scripts/runway-sheet-sync/config.ts` (SheetConfig, registry)
- `scripts/runway-sheet-sync/parse-sheet.ts` (SheetFixture consumer)
- `scripts/runway-sheet-sync.ts` (CLI entry, fixture-file path today)
- Pre-plan Q1.11 (service account as the deployed read path)

**Board fields:** Epic: Runway integration + safe automation | Milestone: 01 Schedule Sync | Priority Tier: top

---

### Ticket E2: Promote row-identity ledger from on-disk JSON to `sheet_sync_ledger` DB table

**Title:** Sheet sync: promote identity ledger from on-disk JSON to Turso DB table

**Why:** The Phase 1a ledger persists `key -> weekItemId` state as a local JSON file. On a serverless deploy, the file is ephemeral: a second sync run on Vercel would start cold and re-derive every match from scratch, producing duplicate creates. The ledger must live in Turso alongside the rest of the Runway state so identity is durable across all execution contexts.

**Spec:**

- Add a `sheet_sync_ledger` table to the Runway Drizzle schema (`src/lib/db/runway-schema.ts`):
  ```
  sheet_sync_ledger (
    id         text primary key,          -- uuid
    sheet_id   text not null,
    key        text not null,             -- taskNo or "t:<normalized title>" per LedgerEntry.key
    task_no    text,
    title      text not null,
    row_number integer not null,
    week_item_id text,                    -- null until matched
    state      text not null,            -- "matched" | "pending-create" | "collision-flagged" | "orphaned"
    last_run_id text not null,
    updated_at text not null,            -- ISO8601
    UNIQUE (sheet_id, key)
  )
  ```
- Generate and commit a Drizzle migration (`pnpm runway:generate`).
- Add `scripts/runway-sheet-sync/ledger-db.ts`: `loadLedger(db, sheetId): Promise<Ledger>` and `saveLedger(db, ledger): Promise<void>`. These replace the `loadLedger`/`saveLedger` in `scripts/runway-sheet-sync/ledger.ts` which currently reads/writes a local `.ledger/<sheetId>.json` file.
- The in-memory `Ledger` type in `types.ts` is unchanged. Only the persistence layer changes.
- The CLI entry (`scripts/runway-sheet-sync.ts`) switches to `ledger-db.ts` when running with `--live`. Fixture-only runs keep the file-based ledger so CI needs no DB connection.

**Acceptance criteria:**
1. Run `pnpm runway:sheet-sync --live` twice for the same engagement. On the second run, previously matched rows are ledger-banked (disposition: `matched`, note: "ledger-banked match") rather than re-fuzzy-matched. Confirm via the diff report. (Non-vacuity: delete the DB ledger rows for one engagement between runs and confirm the second run re-derives the match and writes the rows back.)
2. `pnpm runway:generate` and `pnpm runway:push` succeed with the new table. No existing migration is touched.
3. A unit test in `ledger-db.test.ts` (new) stubs the DB, calls `loadLedger` on an empty table, confirms it returns an empty `Ledger`, then calls `saveLedger` with one entry and confirms `loadLedger` returns it back.
4. `pnpm test:run` passes (existing ledger.test.ts still green; the file-based path is still tested there).

**Gate flow:** branch off fresh runway -> Ops gate-1 (Ops runs the two-pass CLI sequence against the staging Turso URL and confirms row 2 shows ledger-banked) -> Holdout gate-2 -> Ops merges -> Holdout closes on merged main.

**References:**
- `scripts/runway-sheet-sync/ledger.ts` (current file-based implementation)
- `scripts/runway-sheet-sync/types.ts` (Ledger, LedgerEntry types)
- `src/lib/db/runway-schema.ts` (schema home)
- `scripts/runway-sheet-sync/diff.ts` lines 141-166 (ledger-banked match path in diffSheet)

**Board fields:** Epic: Runway integration + safe automation | Milestone: 01 Schedule Sync | Priority Tier: top

---

### Ticket E3: Apply-writes executor (dry-run + apply + post-verify) — safe interim before M2

**Title:** Sheet sync: apply-writes executor with dry-run, pre-snapshot, and post-verify

**Why:** Phase 1a emits ready-to-apply `SyncPayload[]` but never executes them. This ticket is the executor that actually drives the Runway DB writes. It must ship with dry-run as the default so the operator can review before any prod write lands. The DI-TP safety triplet (pre-snapshot, dry-run, apply, post-verify) replaces ad-hoc prod writes. This is the "safe interim" for M1 before the M2 DB-safety tool provides a reusable primitive.

**Spec:**

- Add `scripts/runway-sheet-sync/apply.ts`: `applyPayloads(db, payloads, opts: { dryRun: boolean, runId: string }): Promise<ApplyResult>`.
  - Sorts payloads by `applyOrder`.
  - Skips payloads with `requiresReview: true` unless `opts.force` is explicitly set (review-gated payloads are flagged in the result, not silently dropped).
  - For each `op`:
    - `createWeekItem`: calls `createWeekItem()` from `src/lib/runway/operations.ts` (already exists).
    - `updateWeekItemField`: calls `updateWeekItemField()` from `src/lib/runway/operations.ts`.
    - `addProject`: calls `addProject()` from `src/lib/runway/operations.ts`.
    - `flag-for-review`: writes to an `apply_review_queue` log table (see schema addition below), does not write to the target table.
  - All writes are inside a single `withBatchId(runId, ...)` ALS scope (see `src/lib/runway/batch.ts` or equivalent).
  - In dry-run mode: logs what would be written, calls nothing, returns `{ dryRun: true, planned: SyncPayload[] }`.
- Add a minimal `apply_review_queue` table to the schema (id, run_id, payload_json, created_at) so flagged payloads are surfaced without being applied.
- Pre-snapshot: before any writes, call `readClientBundle(db, clientSlug)` and store the result as JSON in `docs/tmp/data-tp/snapshots/<runId>-pre.json` (gitignored path; matches existing DI-TP snapshot convention).
- Post-verify: after all writes, call `readClientBundle` again and emit a diff of what changed vs the pre-snapshot to `docs/tmp/data-tp/snapshots/<runId>-post-diff.json`.
- CLI flag: `pnpm runway:sheet-sync --live --apply` triggers the executor. Without `--apply`, the CLI stops after emitting the payload report (Phase 1a behavior).

**Acceptance criteria:**
1. `pnpm runway:sheet-sync --live --apply --dry-run` for the Soundly engagement prints the planned ops and exits without touching the DB. Confirm by reading `readClientBundle` before and after and showing identical output. (Non-vacuity: run with `--apply` and no `--dry-run` on a test engagement in the staging Turso URL and confirm a `createWeekItem` row lands.)
2. All `requiresReview: true` payloads are skipped in a normal `--apply` run and appear in `apply_review_queue`.
3. The pre-snapshot file exists at `docs/tmp/data-tp/snapshots/<runId>-pre.json` before any DB write is attempted. If the executor crashes mid-apply, the pre-snapshot is still readable (written before writes begin, not after).
4. The post-diff file shows only the WIs that the apply actually created or updated. Running apply with no changes (all matched, no deltas) produces an empty diff.
5. `pnpm test:run` passes. A unit test in `apply.test.ts` stubs the DB operations and confirms dry-run returns `planned` without calling any operation.

**Gate flow:** branch off fresh runway (after E1 + E2 land) -> Ops gate-1 (Ops runs dry-run, reviews planned ops, then runs real apply against staging Turso, confirms pre-snapshot + post-diff files) -> Holdout gate-2 -> Ops merges -> Holdout closes on merged main.

**References:**
- `scripts/runway-sheet-sync/payloads.ts` (SyncPayload shape, what the executor consumes)
- `src/lib/runway/operations.ts` (createWeekItem, updateWeekItemField, addProject helpers)
- `src/lib/runway/batch.ts` (withBatchId ALS scope; verify the exact export name before drafting)
- DI-TP triplet convention: `docs/tmp/data-tp/` (gitignored, snapshot path)
- Issue #91 (the parent for this ticket's scope; E3 is the first buildable slice of #91)

**Board fields:** Epic: Runway integration + safe automation | Milestone: 01 Schedule Sync | Priority Tier: top

**Depends on:** E1 (service account, live reads), E2 (DB ledger, durable identity)

---

### Ticket E4: MCP tool surface for sync trigger (operator-driven, per engagement)

**Title:** Sheet sync: register `trigger_sheet_sync` MCP tool on /api/mcp/runway

**Why:** The CLI works on a developer laptop but cannot be called from an AI assistant, the Slack bot, or an automated schedule. The pre-plan (issue #91 spec) says the execution surface should be an MCP tool on `/api/mcp/runway` using the `registerRunwayTools` pattern. This ticket adds that surface so the operator can trigger a sync from Claude, a Slack command, or a scheduled job.

**Spec:**

- In `src/app/api/mcp/runway/route.ts` (or the file where `registerRunwayTools` is called; verify path before drafting), register a new tool `trigger_sheet_sync` with:
  - Input: `{ clientSlug: string, sheetId: string, dryRun: boolean }`.
  - Output: a structured result including: `runId`, `counts` (matched/missing/mismatched/orphan), `payloadsApplied` (count), `payloadsSkipped` (count), `reviewQueueCount` (count), `flags` (string[]).
  - Internally calls the same pipeline as the CLI: `readSheetViaServiceAccount`, `parseSheet`, `diffSheet`, `buildPayloads`, `applyPayloads`.
  - Respects the same `dryRun` default (true unless `dryRun: false` is explicitly passed).
  - Max uses: `maxUses: 1` per invocation (per CLAUDE.md AI compliance requirement).
  - Uses prompt caching on the sheet read result where possible.
- The tool must be authenticated: only callable via the same session gate as other `/api/mcp/runway` routes.

**Acceptance criteria:**
1. A Claude Code session with `RUNWAY_MCP_URL` configured can call `trigger_sheet_sync({ clientSlug: "soundly", sheetId: "<id>", dryRun: true })` and receive back the counts object with non-null values. (Non-vacuity: call with a bad `clientSlug` and confirm the tool returns an error, not an empty result.)
2. `dryRun: false` actually applies payloads (verify via post-verify diff showing at least one WI touched against the staging DB; never test this against prod directly).
3. The tool appears in the MCP tool list (`pnpm runway:studio` or direct API call to the tools endpoint) with its correct input schema.
4. `pnpm build` passes with the new tool registered.

**Gate flow:** branch off fresh runway (after E3 lands) -> Ops gate-1 -> Holdout gate-2 -> Ops merges -> Holdout closes.

**References:**
- `src/app/api/mcp/runway/route.ts` (verify exact path; pattern from `registerRunwayTools`)
- CLAUDE.md AI section: `maxUses`, `recordTokenUsage()`, prompt caching requirements
- Pre-plan issue #91 spec: "Execution surface: MCP tool on `/api/mcp/runway`"

**Board fields:** Epic: Runway integration + safe automation | Milestone: 01 Schedule Sync | Priority Tier: parallel

**Depends on:** E3

---

### Ticket E5: Timezone convergence — replace browser-local + UTC today derivations with `chicagoISODate()`

**Why:** This is an existing open issue (#43). It is re-listed here because it must land BEFORE the apply-writes engine (#91, E3) sends any date-based writes to prod. The sync computes `weekOf` from `chicagoISODate()` in the sheet-parse path. If the dashboard buckets days differently, items will appear under the wrong week after a sync write.

See issue #43 for the full spec and acceptance criteria. This ticket entry is here only to confirm it belongs in Tier top for M1 and should be sequenced before E3 lands.

**Board fields:** Epic: Runway integration + safe automation | Milestone: 01 Schedule Sync | Priority Tier: top

**Note:** Do NOT create a new issue for this. Hook existing issue #43 onto the M1 milestone via board fields + label `current-work-arc`.

---

## F. Open Questions for the Operator / TP

1. **Staging DB first or prod-gated dry-run?** The apply-writes executor (E3) specs against a staging Turso URL for gate-1 testing. Does a staging Turso DB exist, or does QA on E3 run against prod with `--dry-run` only? If staging does not exist, M2 should either move earlier or E3 must be more conservative. (This is the M2 DB-safety milestone's stated deliverable, but M1 needs to know if it can assume staging exists.)

2. **Operator-triggered vs scheduled?** The pre-plan says sync is "operator-triggered per engagement, not auto-sweep." Is that still the intent for M1, or should M1 also spec a cron-based trigger? Cron raises the safety bar significantly (no human in the loop per run).

3. **Which engagements are in scope for M1?** The Phase 1a config registers several clients. M1's apply-writes engine should land on one client first (Soundly was the Phase 1a reference). Which client does the operator want as the first real apply? This determines the DI-TP triplet supervision scope.

4. **`apply_review_queue` table: who clears it?** E3 proposes a DB table for flagged payloads that require AM review. Is the expected consumer a Slack notification, a Runway UI list, or just a diagnostic script? The table design depends on how the operator intends to act on it.

5. **MCP tool authentication gate:** The existing `/api/mcp/runway` route may use the Runway shared-password gate. Should `trigger_sheet_sync` require the same gate, or a separate operator-only API key? Clarify before E4 is specced.

---

_End of draft. For TP review before any ticket creation, board hookup, or CC dispatch._
