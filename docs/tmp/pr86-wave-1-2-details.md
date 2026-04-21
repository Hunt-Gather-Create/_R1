# PR #86 Wave 1 + Wave 2 — Integration Details

**Status:** Wave 1 COMPLETE. Wave 2 in flight (Chunks 2, 3 code; Asprey data merged).

---

## Wave 1 — COMPLETE (merged to `feature/runway-pr86-base`)

### Code
- **Chunk 4 schema** (4 atomic commits + merge) — 9 new columns across `projects` / `week_items` / `updates`; `recomputeProjectDates` helper; backfill + reverse scripts
- **Chunk 1 query layer** (5 atomic commits + merge) — PersonWorkload v4 contract, bucketing, status filters, stub filter, Chicago TZ helper

### Data (all applied to prod Turso + audit tagged)

| Client | Ops | Records | Batch ID |
|---|---|---|---|
| Bonterra | 4 writes | 1 L1 + 1 L2 | bonterra-v4-touchup-2026-04-21 |
| Convergix | 30 writes | 15 L1s | convergix-v4-realign-2026-04-21 |
| Soundly | 8 writes | 3 L1s + 1 L2 | soundly-v4-realign-2026-04-21 |
| LPPC | 9 writes | 7 L1s | lppc-v4-realign-2026-04-21 |
| TAP | 13 writes | 1 client + 1 L1 + 5 L2s | tap-v4-realign-2026-04-21 |
| HDL | 6 writes | 1 L1 + 3 L2s | hdl-v4-realign-2026-04-21 |
| Schema backfill | — | 63 week_items + 23 projects | — |

**Wave 1 QA results:** all chunks and data migrations passed QA (MERGE for code, ACCEPT for data). 11 debt items logged to `docs/brain/pr86-chunk4-known-debt.md` for Chunk 5 polish.

**Wave 1 TP autonomous decisions:** 4 decisions logged to `docs/brain/pr86-tp-autonomous-decisions.md` (Payment Gateway contract_end, Soundly full-team interpretation, team-roster inconsistency across clients, Convergix missing AM role).

---

## Wave 2 — IN FLIGHT / PARTIAL

### Completed & merged

- **Asprey v4 touchup** — 3 writes (client.team normalized, engagement_type=retainer, contract_end=2026-04-30). Merged.

### In flight

- **Chunk 2 bot layer** — in isolated worktree
- **Chunk 3 UI board** — in isolated worktree

### Waiting

- 3 QA agents per chunk (code-review + atomic-commits + data-integrity where applicable) → digest
- Wave 2 integration merge → push

---

## Post-Wave-2

- Wave 3: Chunk 5 polish + PR prep (debt items from `pr86-chunk4-known-debt.md`) + Llama iteration
- Post-merge: remaining-6 cleanup (Hopdoddy, Beyond Petro, AG1, ABM, EDF, Wilsonart) — prompt at `docs/tmp/cc-prompts/cc-prompt-remaining-6-postmerge.md`

---

## Git state snapshot

Base branch `feature/runway-pr86-base` at `623bfb5` (pushed to origin). 26 commits ahead of `upstream/runway`.

Recent integration merges:
- Asprey v4 touchup
- HDL v4 realign
- TAP v4 realign
- LPPC v4 realign
- Soundly v4 realign
- Convergix v4 realign
- Bonterra v4 touchup
- Chunk 1 query layer
- Chunk 4 schema

Preflight: 1529 tests pass, 0 lint errors, build compiles.
