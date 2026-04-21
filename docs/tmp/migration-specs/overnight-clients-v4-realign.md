# Overnight Client v4 Realigns — Migration Specs

**Scope:** 6 clients touched overnight with v1/v2 convention. Realign each to v4.
**Clients:** Bonterra, Convergix, Soundly, TAP, HDL, LPPC.
**Runs in:** Wave 1 Batch A (Bonterra, Convergix, Soundly) + Batch B (TAP, HDL, LPPC). Concurrency cap 4.

**Precondition:** Chunk 4 schema pushed to prod (new columns: `engagement_type`, `contract_start/end`, `start_date`, `end_date`, `blocked_by`, `triggered_by_update_id`, and derivation logic).

---

## Generic spec pattern (applies to each client below)

Each data agent does the following:

### 1. Pre-snapshot

```ts
// scripts/runway-migrations/<client>-v4-touchup-2026-04-21.ts
import { createSnapshot } from './helpers';
await createSnapshot('<client-slug>', `docs/tmp/<client>-pre-snapshot.json`);
// captures: client row, all L1s with all fields, all L2s with all fields
```

### 2. Discovery + diff

Agent reads pre-snapshot, applies v4 target-state rules below, computes ops.

### 3. Dry-run

`pnpm runway:migrate <client>-v4-touchup-2026-04-21 --dry-run --target prod`

Log full diff. Agent verifies diff matches target-state expectation. If any UNEXPECTED ops surface (ops the target-state spec didn't predict), halt and log.

### 4. Apply

`pnpm runway:migrate <client>-v4-touchup-2026-04-21 --apply --target prod --yes`

### 5. Post-snapshot

Same fields as pre-snapshot, new file: `docs/tmp/<client>-post-snapshot.json`.

### 6. Forward + reverse script

Both committed to `scripts/runway-migrations/`. Reverse script exports `revert()` that reads `<client>-pre-snapshot.json` and sets every field back to pre-values.

### 7. QA data-integrity agent runs

See `docs/tmp/qa-templates/qa-agent-data-integrity.md`.

---

## v4 target-state rules (apply to every client unless noted)

### Client row
- Verify `team` field is in role-prefix format (`AM: Jill, CD: Lane, Dev: Leslie`); fix if not
- Verify `contract_status` is accurate (`signed` / `unsigned` / `expired`)
- `nicknames` populated if known variants exist

### Every L1 (project)
- `owner` = single accountable person (no role prefix)
- `resources` = full team roster for this engagement (not just primary helper). Role-prefix format.
- `engagement_type` populated (`project` / `retainer` / `break-fix`)
- `status` accurate (not stale — e.g., if L2s are in-flight but L1 shows `not-started`, flip to `in-production`)
- `category` matches status (`active` / `awaiting-client` / `pipeline` / `on-hold` / `completed`)
- `contract_end` set ONLY if retainer (manual override for retainer span); otherwise leave null (derived)
- Title format: drop client name prefix, drop category word (client + category fields carry that info). Use em-dash `—` not hyphen. Example: rename `Bonterra Impact Report — deadline handoff` → `Impact Report — Dev Handoff`.
- `waitingOn` populated if awaiting-client

### Every L2 (week item)
- `projectId` FK set (not orphan)
- `owner` = inherits from parent L1 unless explicitly overridden (single person, no role prefix)
- `resources` = specific doers on this task if team > 1. Null OK if single person (inferred from L1)
- `start_date` required (backfilled from legacy `date` field by Chunk 4)
- `end_date` set for multi-day spans, null for single-day
- `category` from enum: kickoff / review / approval / delivery / launch / deadline
- `status` from enum: null (default, not-started) / in-progress / blocked / completed
- `blocked_by` populated if dependency on another L2
- Title format: `[Project Name] — [Specific Milestone]` (no client name, no category word), em-dash

### After all L1/L2 writes
- Verify derivation: project.start_date = MIN(children.start_date), project.end_date = MAX(children.end_date OR start_date)

---

## Per-client specs

### Bonterra — restart halted touchup

**Context:** overnight agent halted on status drift (`Dev K/O 4/15` L2 was `in-progress`, not null as expected).

**Target-state rules (additions to generic):**
- Accept `in-progress` as valid pre-state for `Dev K/O 4/15` L2; flip to `completed` if end_date has passed
- Apply v4 resources format to all L1s (full team, arrow syntax where handoff existed)
- `engagement_type='project'` on all Bonterra L1s (default; verify none are retainers)
- Verify `Impact Report` L1 has proper handoff arrow: `CD: Lane -> Dev: Leslie` not `CD: Lane, Dev: Leslie`

**Script:** `scripts/runway-migrations/bonterra-v4-touchup-2026-04-21.ts`
**Reverse ready:** yes

### Convergix — full v4 realign

**Context:** 33% L1 drift from v1 found in earlier audit. Multiple null-resources L1s, partial rosters, inconsistent status.

**Target-state rules (additions to generic):**
- All L1s get full team roster (not just primary helper); pull roster from `clients.team`
- Status flips per pre-snapshot audit (agent reads prod, identifies L1s where L2s are in-flight but L1 is stale, flips to in-production)
- `engagement_type='project'` default on all Convergix L1s (verify none are retainers)
- If stale target field exists on any L1 (v4 removes target), null it

**Script:** `scripts/runway-migrations/convergix-v4-realign-2026-04-21.ts`
**Reverse ready:** yes

### Soundly — full v4 realign

**Target-state rules (additions to generic):**
- 3 L1s need full team roster expansion
- `Payment Gateway` L1 → `engagement_type='retainer'`, set `contract_end` to appropriate date (agent queries operator-memory note or halts if unclear)
- Other Soundly L1s → `engagement_type='project'`

**Script:** `scripts/runway-migrations/soundly-v4-realign-2026-04-21.ts`
**Reverse ready:** yes

### TAP — v4 realign

**Target-state rules (additions to generic):**
- `engagement_type='project'` on all TAP L1s
- Verify team roster on L1s; expand to full if partial
- Dates/statuses per v4 derivation

**Script:** `scripts/runway-migrations/tap-v4-realign-2026-04-21.ts`
**Reverse ready:** yes

### HDL — v4 realign + contract-expiry

**Target-state rules (additions to generic):**
- Full team roster on L1s
- `engagement_type='project'` on all HDL L1s
- If HDL client has `contract_status='expired'`, verify expiry surfaces on owner's plate (Chunk 1 does this at read time — no data-side work needed, just verify data sets up the signal)

**Script:** `scripts/runway-migrations/hdl-v4-realign-2026-04-21.ts`
**Reverse ready:** yes

### LPPC — v4 realign

**Target-state rules (additions to generic):**
- Full team roster on L1s
- `engagement_type='project'` default (verify no retainers)
- Derive L1 start/end from children (Chunk 4 derivation logic should auto-fire on L2 writes; explicit one-time derivation call at end of migration for safety)

**Script:** `scripts/runway-migrations/lppc-v4-realign-2026-04-21.ts`
**Reverse ready:** yes

---

## Halt rules (per data agent)

- Drift from pre-expectation affecting >1 record → HALT + log
- Drift changes intended outcome (e.g., would flip a status you didn't intend) → HALT + log
- Missing linkWeekItemToProject helper → HALT + log (precondition failure)
- Turso write failure → HALT + log full error
- QA data-integrity report returns UNEXPLAINED critical → mark migration for REVERSE, log

Sub-threshold drift = note in post-run log, proceed.

---

## Asprey (Wave 2 background)

**Context:** Already partially migrated. Needs v4 touchup: add `engagement_type='retainer'`, set `contract_end='2026-04-30'`.

**Script:** `scripts/runway-migrations/asprey-v4-touchup-2026-04-21.ts`
**Reverse ready:** yes

**Target-state rules:**
- Set `engagement_type='retainer'` on Asprey L1 (verify name via prod query, likely `Dave Asprey — Retainer` or similar)
- Set `contract_end='2026-04-30'`
- Verify team roster full and in v4 format
- Derive L1 start/end from children

Runs as single background agent in Wave 2, not Batch.

---

## Output per agent

Each migration agent reports to TP:
- Pre-snapshot path
- Post-snapshot path
- Script paths (forward + reverse)
- Dry-run output summary (count of ops)
- Apply output summary (count of records touched)
- Pre/post diff summary
- QA data-integrity recommendation (ACCEPT | REVERSE | INVESTIGATE)
- Any halt conditions triggered
- Ambiguity resolved (with reasoning)
