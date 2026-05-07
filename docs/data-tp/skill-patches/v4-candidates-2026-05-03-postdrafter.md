# Skill v4 Patch Candidates — 2026-05-03 (post-AG1 drafter dispatch)

**Source:** AG1 batch `ag1-batch-2026-05-03` drafter findings (operations-writes-week.ts + operations-utils.ts read on `upstream/runway`).

**Status:** Surfaced for evaluator T2 review during AG1 batch flow. Operator decision on landing pace at AG1 close (alongside the existing 8 candidates from `v4-candidates-2026-05-02.md` if not yet landed).

**Cohort scope:** AG1 is 1 client; below thresholds reflect post-AG1 state pre-cohort-close.

---

## #26 — Cascade-date-change should emit audit row

**Pattern:** When an L2 `date`/`startDate`/`endDate` write triggers `recomputeProjectDatesWith` and the parent's derived `start_date` / `end_date` shifts, the parent change is raw-UPDATEd into the `projects` table with NO audit row emitted. The codebase exposes `cascade-status` and `cascade-duedate` as cascade `update_type` values, but no `cascade-date-change`.

**Evidence today:**
- AG1 batch `ag1-batch-2026-05-03` Op 4: L2 endDate `2026-04-30` → `2026-05-08` causes parent (`AG1 PRO Content` 92708ffc) endDate to recompute. Parent `end_date` raw-updates silently.
- Result: post-APPLY audit query `find_updates(batchId='ag1-batch-2026-05-03')` returns **5 rows, not 6**. The cascade is observable in the projects table state but invisible in the audit trail.
- Verified in code: `src/lib/runway/operations-writes-week.ts` L83 `recomputeProjectDatesWith` body — single `executor.update(projects).set({ startDate, endDate, updatedAt })` call, no `db.insert(updates)`.

**Cohort signal:** 1-of-1 NEW pattern. Below 2-of-N skill-patch threshold, but **high audit-integrity value** — every prior cohort batch that touched L2 dates likely under-counted audit rows by 1 per affected parent. Recompute the cohort cohort-handoff audit-row tallies if this matters for accountability.

**Severity:** **HIGH** (audit-trail completeness). When the operator reviews "what happened to project X recently?" via `find_updates(projectName='X')`, parent-date recomputes are missing. They show up only in the child write's `triggeredByUpdateId` cascade chain — but only when the cascade emits an audit row.

**Proposed location:** Code patch on `recomputeProjectDatesWith` in `src/lib/runway/operations-writes-week.ts`, NOT a skill text patch. Plus skill documentation update in `data-conventions.md` § Cascade behavior describing what audit emission to expect.

**Proposed text (skill `data-conventions.md` patch — to land alongside code patch):**

> **Cascade audit emission:** Every cascade-triggered write to a parent record MUST emit an audit row. Currently:
> - `cascade-status` ✓ (status-change cascades)
> - `cascade-duedate` ✓ (dueDate-change cascades)
> - `cascade-date-change` ✗ (NEW — required) — parent `start_date` / `end_date` recomputes via `recomputeProjectDatesWith` must emit an audit row.
>
> Audit emission rule: if the parent's recomputed value differs from the prior value, emit a `cascade-date-change` row with `triggeredByUpdateId` pointing at the originating L2 write. If the parent value is unchanged (no-op skip), no row.

**Proposed code patch (concept — full implementation in code-patch session):**

```ts
// In recomputeProjectDatesWith, after the no-op skip check + before/after the raw update:
if (current && (current.startDate !== minStart || current.endDate !== maxEnd)) {
  // existing raw update
  await executor.update(projects).set({ startDate: minStart, endDate: maxEnd, updatedAt: new Date() }).where(eq(projects.id, projectId));

  // NEW: emit cascade audit row
  await executor.insert(updates).values({
    id: generateId(),
    projectId,
    updateType: "cascade-date-change",
    summary: `${projectName}: dates recomputed via L2 cascade (start: ${current.startDate} → ${minStart}, end: ${current.endDate} → ${maxEnd})`,
    previousValue: JSON.stringify({ startDate: current.startDate, endDate: current.endDate }),
    newValue: JSON.stringify({ startDate: minStart, endDate: maxEnd }),
    updatedBy: getActiveUpdatedBy() ?? "cascade-recompute",
    batchId: getActiveBatchId() ?? null,
    triggeredByUpdateId: getActiveTriggerUpdateId() ?? null,
    createdAt: new Date(),
  });
}
```

Concrete impl needs verification against actual `updates` table schema, the audit-helper conventions in `operations-utils.ts`, and whatever ambient context (`setBatchId`, current update id) is available inside `recomputeProjectDatesWith`'s transaction.

**Risk if not landed:** Audit-trail incompleteness. Future operator audits will undercount by 1+ per L2-date write that crosses a parent boundary. Cohort retro-tally would need adjustment if accountability matters.

**Bump signal:** This is a code patch + skill doc update, not pure skill text. Landing pace operator-decided at AG1 close.

---

## Corrections to existing v4 candidates (2026-05-02 file)

### #20 — clarify gap is at MCP wrapper, not helper level

Pre-drafter framing: "category not in PROJECT_FIELDS MCP whitelist" — implied category gap was at the helper level.

**Drafter-confirmed code reality:** `category` IS in `PROJECT_FIELDS` at `src/lib/runway/operations-utils.ts` L323. The helper `updateProjectField` accepts category writes. The gap is in the **MCP wrapper layer** (`update_project_field` MCP tool surface), not the helper.

**Updated framing for v4-candidates-2026-05-02.md § #20:**

> **MCP `update_project_field` tool does not allow `category` writes.** The MCP wrapper exposes a narrower whitelist than the underlying helper. The helper-level `PROJECT_FIELDS` (in `operations-utils.ts`) DOES include `category` — `updateProjectField` accepts category writes when called directly from a triplet. The gap is at the MCP-wrapper layer: when a corrective batch needs to flip category and is using MCP path (e.g., from row-by-row operator session), drop into triplet path with `updateProjectField` helper. Helper-only batches (drafter-authored triplets) can write category directly via the helper — no skill v4 #20 workaround needed.

This narrows the scope of #20 — it's an MCP wrapper gap, not a foundational gap. Triplet authors can write category freely.

### Helper-name accuracy in skill conventions

Drafter found pre-drafter spec referenced `updateWeekItem` but actual helper is `updateWeekItemField` (with `weekOf + weekItemTitle` resolution). Spot-check `data-conventions.md` § Helper signatures and `drafter-prompt.md` for any stale `updateWeekItem` references; correct to `updateWeekItemField` if found.

---

## Summary index

| Patch # | Severity | Location | Type |
|---|---|---|---|
| #26 | HIGH (audit-integrity) | code patch + `data-conventions.md` § Cascade | new |
| #20 (clarification) | Reference | `v4-candidates-2026-05-02.md` § #20 | scope narrowing |
| Helper-name accuracy | Reference | `data-conventions.md` + `drafter-prompt.md` | grep + fix |

**Recommended landing order if all candidates land:**

1. **#26 first** — high audit-integrity value, code-side patch. Lands BEFORE next L2-date-write batch on any client. If next cohort kickoff occurs without #26 landed, document audit-row-undercount expectation in cohort handoff so successors don't misread post-APPLY audit counts.
2. #20 clarification + helper-name accuracy — light reference edits, land together when convenient (alongside #26 or in next operator review session).

**Sources:**
- AG1 batch drafter return summary 2026-05-03 (`docs/tmp/data/ag1-spec-2026-05-03.md` § Code-reality discovery).
- TP-side grep verification on `upstream/runway` (`operations-utils.ts` L323, `operations-writes-week.ts` L83).
- `v4-candidates-2026-05-02.md` (existing 8 candidates — #20–#25 + 3 secondaries — #26 is additive).
