# Batch Update Skill Audit — 2026-04-21 (PR #86 Chunk 5)

## Audit scope

Evaluated `.claude/skills/batch-update/SKILL.md` against the four capabilities called out in the Chunk 5 prompt:

1. Filter + multi-field update support
2. Dry-run with diff
3. BatchId tagging on audit
4. Bulk L2-owner backfill

## Findings

### 1. Filter + multi-field updates — NOT SUPPORTED AS PRIMITIVE

The MCP surface exposes only field-at-a-time writes (`update_project_field`, `update_week_item`, etc.). Multi-field updates are a client-side loop.

**Assessment:** correct by design. Each call is independently idempotent and tagged. Forcing a multi-field primitive would complicate the audit trail (what "change set" spans one row?) and cascade semantics.

**Recommendation:** no change. Operators should reach for a migration script in `scripts/runway-migrations/` once they need >10 writes touching >3 fields per record. This is the established pattern (Bonterra, Convergix, LPPC, TAP, HDL, Soundly v4 realign scripts).

### 2. Dry-run with diff — PARTIAL

MCP tools have no dry-run flag. The `scripts/runway-migrate.ts` harness defaults to dry-run (add `--apply --target prod --yes` to commit). Snapshots pre/post are handled per-agent during data waves (see `docs/tmp/<client>-pre-snapshot-*.json`).

**Assessment:** adequate for scripted batches (the dominant path for non-trivial work). MCP-only batches have no dry-run but can be undone via `undo_last_change` or the reverse migration script.

**Recommendation:** no change. Adding a tool-level dry-run flag would multiply surface area for marginal benefit.

### 3. BatchId tagging on audit — CORRECT WITH ONE KNOWN GAP

`insertAuditRecord` in `src/lib/runway/operations-utils.ts` correctly reads `_currentBatchId` (set via `setBatchId` / `set_batch_mode`) and stamps every audit row with it. Verified against Convergix, Bonterra, LPPC, TAP, HDL scripts.

**Known gap:** Soundly v4 audit rows lack `batchId` — the script passed raw `insertAuditRecord` calls without first setting `batchId` or passing it explicitly. Logged in `docs/brain/pr86-chunk4-known-debt.md` §10. Fix target: optional post-merge touchup; does not affect correctness, only `--batch` filtering in publish-updates.

**Recommendation:** update SKILL.md to note that **scripted migrations must either call `setBatchId` first OR pass `batchId` explicitly** to every `insertAuditRecord` call. Canonical pattern: `scripts/runway-migrations/convergix-v4-realign-2026-04-21.ts`.

### 4. Bulk L2-owner backfill — WORKS, UNDOCUMENTED

v4 auto-populates L2 `owner` from parent L1 on create (`createWeekItem` inherits L1.owner when `owner` is not specified). Existing L2s are NOT rewritten by this inheritance — the operator sweeps manually when they want to normalize.

The pattern is: `get_week_items` → filter where `owner` is null or stale → loop `update_week_item({field: "owner", newValue: <inherited>})`. No dedicated tool primitive.

**Recommendation:** note this pattern + loop formula in SKILL.md. A single-primitive `backfill_l2_owners(clientSlug?)` tool is out of scope for Chunk 5 (>30 LoC of MCP tool wiring + tests), but could be a post-merge add if the operator finds themselves re-running the loop.

## Summary

The skill works as-designed for the full Wave 1 / Wave 2 data work that has already shipped. Three minor doc gaps are worth tightening before heavy post-merge use:

- Clarify filename format of `batchId` (`<kind>-YYYY-MM-DD`) and list real examples
- Call out the scripted-audit-without-batchId pitfall explicitly (Soundly lesson)
- Document the bulk L2 owner backfill pattern and the read → diff → loop formula

All three are SKILL.md-only edits. No code changes required.

**Chunk 5 decision:** flagged for operator — the skill file is tooling documentation and owned by the operator's editor. Recommended changes compiled above; ready to apply in a separate brief PR if wanted.

## References

- `src/lib/runway/operations-utils.ts:427-469` — `setBatchId` + `insertAuditRecord`
- `src/lib/mcp/runway-tools.ts:399` — `set_batch_mode` MCP tool
- `scripts/runway-migrations/convergix-v4-realign-2026-04-21.ts` — canonical batched script pattern
- `docs/brain/pr86-chunk4-known-debt.md` §10 — Soundly batchId gap
