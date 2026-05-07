# Skill v4 Patch Candidates — 2026-05-02 (post-Convergix close)

Eight patch candidates surfaced during the Convergix arc (3 batches APPLIED clean, 169 audit rows). Five primary (numbered), three secondary (drafter discipline). Operator + evaluator review → land selectively → bump skill version.

Cohort context: queue is Hop / TAP / Sou / Cgx, all closed 2026-04-29 → 2026-05-02. Cgx was the largest scope (21 L1s + 45 L2s + retainer wrapper) and the only client where #20, #22, #23, #25 surfaced. #24 was a recurring within-Cgx pattern (3 distinct catches across 3 batches).

---

## #20 — `category` not in PROJECT_FIELDS MCP whitelist

**Pattern:** The MCP `update_project_field` tool whitelist (`PROJECT_FIELDS`) does not include `category`. Any batch that needs to flip a project's category (e.g., `kickoff` → `delivery`, `active` → `completed`) cannot use the MCP path — must drop into the triplet path with `updateProjectField` helper directly.

**Evidence today:**
- `convergix-status-sweep-2026-05-02` Card 1 (Cert Page): paired `status=completed` + `category=completed` write. MCP `update_project_field` cannot perform the category half — Card 1 alone is sufficient evidence the whitelist gap forced triplet path.

**Cohort signal:** 1-of-4 (Cgx only); single concrete batch within Cgx — but the constraint applies to any future batch where status terminal flip pairs with category terminal flip, which is the convention. Recurring by design.

**Proposed location:** `data-conventions.md` § MCP write paths (or new § if not present); cross-reference in `SKILL.md` § Common Failure Modes.

**Proposed text:**

> **MCP `update_project_field` does not allow `category`.** The tool's PROJECT_FIELDS whitelist excludes the category enum (`active` / `awaiting-client` / `kickoff` / `delivery` / `approval` / `review` / `deadline` / `completed` / `canceled` / `on-hold`). When a corrective batch needs to flip category, drop into the triplet path with `updateProjectField` helper. Do not attempt MCP — it will silently no-op or error. This is a recurring constraint, not an oversight.

**Risk if not landed:** Future TPs waste a triplet-vs-MCP decision cycle every time a category flip is in scope.

---

## #22 — Status flip kickoff→in-progress should auto-flip cat kickoff→delivery

**Pattern:** When an L1's status moves from `kickoff` to `in-progress` (or `in-production`), the category typically also moves from `kickoff` to `delivery` (or `active`). The skill currently treats these as independent decisions — which means every status flip prompts an operator question about whether category needs flipping.

**Evidence today:**
- Status sweep Card 4 (Daniel Scope Ask kickoff → scheduled — special case, didn't trigger).
- Status sweep Card 6 (Fanuc Post-Event Article Kickoff: status=blocked, category=kickoff → kept kickoff because category fits "kickoff phase").
- Status sweep Card 8 (Corp PPT Updates: status=in-progress, category=kickoff → operator decided to keep kickoff because PPT was still in setup phase).
- The "should auto-flip" pattern held in cards batch but not status-sweep — meaning the rule isn't deterministic. It's a *prompt* for the operator, not an auto-write.

**Cohort signal:** 1-of-4 (Cgx only).

**Proposed location:** `drafter-prompt.md` § Status changes; `data-conventions.md` § Category transitions.

**Proposed text (drafter prompt addition):**

> When a row in your spec includes a status transition out of `kickoff` (i.e., to `in-progress`, `in-production`, `blocked`, `at-risk`, `scheduled`), inspect the current `category` value. If category is `kickoff`:
> 1. Default behavior: warn in spec output, do NOT auto-flip. Drafter surfaces the candidate flip to TP.
> 2. TP decides per-row: flip to `delivery`/`active` (typical post-kickoff phase) OR keep `kickoff` (if work is still in setup despite status change).
> 3. Add explicit `category` field to spec when TP decides flip; omit when TP decides keep.

**Risk if not landed:** Manual cross-check on every status-out-of-kickoff transition. Low priority — current pattern works, just slightly slower.

---

## #23 — Multi-day work-window vs single-day milestone decision pattern

**Pattern:** When an L2 has `date != endDate` (multi-day shape) or `date == startDate == endDate` (single-day), the convention math differs significantly. Drafters currently flag the shape difference as "ambiguity" when in fact convention is clear — the ambiguity is which intent applies: work-window or milestone. TP must decide per-row before drafter dispatch, not during.

**Evidence today:**
- Convention sweep CAT 1: drafter flagged "potential inconsistency" on CAT 1-1, 1-3...1-7 startDate stays unchanged. Was not inconsistent — multi-day shape convention is `startDate=work begin, date==endDate, startDate < endDate`. Drafter misread because skill prompt didn't pre-state intent.
- Convention sweep CAT 1-8 (New Capacity PPT Complete): originally specced as multi-day but operator decided single-day milestone (`date=startDate=endDate=2026-05-08`) because PPT delivery is a single deliverable, not a window. Required spec edit before drafter dispatch.

**Cohort signal:** 1-of-4 (Cgx only — 8 rows in convention sweep).

**Proposed location:** `drafter-prompt.md` § Pre-spec decision matrix; `data-conventions.md` § L2 shape conventions.

**Proposed text (decision matrix for drafter prompt):**

> Before dispatching drafter on any L2 row that touches `date`/`startDate`/`endDate`, TP states the intent explicitly:
> - **Multi-day work-window:** `startDate=work begin, date==endDate, startDate < endDate`. Use when the row represents a continuous activity over multiple days (research phase, copy round, design pass, production sprint).
> - **Single-day milestone:** `date=startDate=endDate`. Use when the row represents a discrete deliverable on one date (a launch, a sign-off, a meeting, a hand-off).
> - **Default if unclear:** ASK operator before specing. Do not let drafter infer.
>
> Drafter prompt: never flag "ambiguity" on shape — TP has already decided. If shape looks wrong, REVERSE-flag to TP for re-spec.

**Risk if not landed:** Drafter ambiguity flags introduce a false-positive review cycle on every multi-day batch.

---

## #24 — dayOfWeek/date calendar verification at spec-time

**Pattern:** When a spec includes a `date` field for a future row, the drafter must verify `dayOfWeek` matches the actual calendar day for that date. Currently TP is catching mismatches at review time, after spec is written.

**Evidence today (3 distinct catches across 3 batches):**
- `convergix-cards-2026-05-01` Cards D2/D3: dayOfWeek mismatch caught in pre-APPLY rails review.
- `convergix-status-sweep-2026-05-02` Card 4 (Daniel Scope Ask): TP originally specced "5/5 monday" — 5/5/2026 is Tuesday. Caught pre-drafter-dispatch via halt rule.
- `convergix-convention-sweep-2026-05-02` CAT 1-8 (New Capacity PPT Complete): 5/8/2026 is Friday — verified at spec time, no catch needed.

**Cohort signal:** 3-of-3 within Cgx batches → strong within-client signal. 1-of-4 across cohort but high-volume.

**Proposed location:** `drafter-prompt.md` § Calendar verification; `rails-reference.md` § 12-point pre-APPLY checklist (add point 13).

**Proposed text (drafter prompt addition):**

> For every row in spec with a `date` field, drafter MUST verify `dayOfWeek` against the actual calendar day for that date BEFORE writing the triplet. Use a known-correct reference (e.g., `date -j -f "%Y-%m-%d" "$DATE" "+%A"` on macOS, or runway calendar helper if available). If mismatch found:
> 1. Drafter does not silently fix — surfaces to TP with the proposed correction.
> 2. TP confirms which side is canonical: the date or the dayOfWeek. (Usually date is canonical and dayOfWeek is the typo, but not always — e.g., if the operator-stated day-of-week is part of the intent.)
> 3. After TP confirms, drafter writes spec with correction.
>
> **Rails compliance:** Pre-APPLY checklist gains point 13 — "dayOfWeek calendar match verified for every L2 row with a future date in this batch."

**Risk if not landed:** Calendar typos slip through to APPLY, requiring REVERT + re-spec or in-prod corrections.

---

## #25 — CRITICAL: Parent date override clobbered by child-triggered recompute

**Pattern:** When a batch includes (a) a parent L1 date override AND (b) child L2 writes that trigger parent recompute, the order of operations matters. If parent override writes first, child writes recompute the parent and clobber the override. Result: silent data loss until verify catches it.

**Evidence today (4 instances — pattern is robust):**
- `convergix-status-sweep-2026-05-02` Card 2 (Rockwell Co-Marketing endDate=5/16 override): Card 4 child writes (Daniel Scope Ask) triggered recompute on Rockwell L1 parent, max-of-children=5/5 clobbered the 5/16 override. Required `convergix-status-sweep-2026-05-02-fix` (1-row override re-fire) post-batch.
- Earlier today: same pattern caught twice in cards batch (rows not enumerated separately — addressed pre-APPLY via op-order rail).
- `convergix-convention-sweep-2026-05-02` did NOT clobber thanks to defensive op ordering — wrapper guard validation also passed.

**Live in-the-wild validation (4th instance, 2026-05-02 post-cohort tail fix on row 66414d4d May Calendar Draft):**

The tail fix executed the proposed op-order pattern explicitly (child writes first → parent override last in same batch). Audit trail in batchId `convergix-tail-2026-05-02` provides concrete proof both that the clobber happens AND that the defense works:

- Audit `3df565dcc74a4a8d815dbd6a9` — `week-field-change` `date` `"2026-04-28"` → `"2026-04-27"` (child write, fires recompute on parent b452f647).
- Audit `ff8f5af76a8048dbb31dc8769` — `week-field-change` `endDate` `""` → `"2026-04-27"` (child write, fires recompute on parent b452f647).
- Audit `9ecdba330173434190ca7bc5b` — `date-override` on parent `b452f647` `endDate`: **`previousValue: "2026-04-27"` → `newValue: "2026-05-29"`**.

The `previousValue=2026-04-27` is the smoking gun. It confirms parent endDate was clobbered from operator-pinned `2026-05-29` down to `2026-04-27` (max-of-children after the two child writes) BEFORE step 3 fired. The override re-pin then restored to `2026-05-29`. Post-write parent state verified: `endDate = 2026-05-29` ✓ (override held).

First concrete validation that the proposed op-order rail (parent override AFTER child writes in same batch) works exactly as predicted. The audit log preserves both the clobber evidence AND the recovery, all inside a single batchId — exactly the "verifiable defense pattern" the proposed rail describes.

**Cohort signal:** 1-of-4 (Cgx only) BUT 4× within-day. 3 instances were catches (problem observed in cards batch R2/R3 + Rockwell status sweep); 4th was successful application of the proposed defense (validation that op-order rail works as designed). Rule must land before next high-volume batch on any client with a wrapper.

**Proposed location:** `SKILL.md` § Triplet authoring rails (add explicit op-order rail); `data-conventions.md` § Recompute behavior; `holdout-panels.md` Cascade Integrity panel additions.

**Proposed text (SKILL.md rail addition):**

> **Op-order rail: parent date overrides last.** When a batch includes both (a) a parent L1 `overrideProjectDate` call AND (b) child L2 writes on that same parent's children, the parent override MUST come AFTER all child writes within the same batch. Otherwise the child writes trigger recompute on the parent and clobber the override.
>
> Implementation options (pick one based on batch shape):
> - **Op-order in triplet:** drafter writes child writes first, parent override last per parent.
> - **Sticky-override flag:** if helper supports `pinOverride: true`, parent override survives child-triggered recompute. (Verify in `operations-writes-project.ts` whether this flag exists; if not, this is a code-side patch candidate.)
> - **Post-batch fix override:** if op-order is impossible (e.g., cascading parent dependencies), accept that verify will catch the clobber and fire a 1-row fix-override batch with bumped `updatedBy`.
>
> **Verification:** Cascade Integrity holdout panel must check every parent override against post-batch parent.dueDate/endDate/startDate. If parent value differs from override target, FAIL the batch.

**Proposed text (Cascade Integrity panel addition):**

> Panel adds explicit check: enumerate every `overrideProjectDate` op in the batch. For each, post-state parent date field MUST equal override target. If different, parent was clobbered — flag CRITICAL.

**Risk if not landed:** Silent prod data loss. Caught today only because verify scripts had explicit assertions on Card 2 endDate. If verify weren't there, the clobber would have shipped.

---

## SECONDARY-1 — Mandatory cascade guard on every dueDate write

**Pattern:** Every `update_project_field({field: "dueDate"})` call should ship with the `cascade-safe` recipe (flip category to `delivery` → write date → flip category back to `deadline`). Without it, dueDate writes can leak forward-cascade onto deadline-category L2 children and corrupt them.

**Evidence today:**
- `convergix-cards-2026-05-01` R2/R3/R4 pattern: Round 4 added 9 cascade guards retroactively after rails review caught missing guards on dueDate writes that touched deadline-L2-having parents.
- Fix worked, but the retroactive add was a process gap.

**Cohort signal:** 1-of-4 within Cgx. LPPC's Pencils Down recipe was the original anchor — already in skill, but not enforced.

**Proposed location:** `drafter-prompt.md` § Project field writes; `rails-reference.md` checklist.

**Proposed text (drafter prompt addition):**

> Every `dueDate` write on a project that has deadline-category L2 children MUST ship with the cascade-safe recipe:
> 1. `update_project_field(category="delivery")` — temporarily flip out of `deadline`
> 2. `update_project_field(dueDate=<target>)` — write the new date
> 3. `update_project_field(category="deadline")` — restore original category
>
> All three ops in same `batch_apply`, sequential. Drafter must enumerate the three ops explicitly in spec. Rails review FAILS if any dueDate write on a deadline-L2-having parent is missing the recipe.

**Risk if not landed:** Forward-cascade corruption on deadline L2s. Caught Round 4 today; could ship undetected if rails reviewer is rushed.

---

## SECONDARY-2 — Drafter checklist: single-day L2 needs paired endDate write

**Pattern:** When drafting a single-day L2 row (whether new create or convention fix), drafter must include both `date` and `endDate` writes (with `endDate=date`). Currently easy to forget the `endDate` half — leaves rows in non-conforming "single-day with endDate=null" shape.

**Evidence today:**
- `convergix-cards-2026-05-01` cards B9/E1: caught pre-DRY_RUN that the spec specced `date` but not `endDate` — drafter added both before dispatch.
- `convergix-convention-sweep-2026-05-02` CAT 4: explicit batch to fix 5 stale single-day endDate=null rows that had been created without paired endDate writes.

**Cohort signal:** 1-of-4 within Cgx (5 rows CAT 4 + 2 cards). LPPC pattern — already noted but not in drafter checklist.

**Proposed location:** `drafter-prompt.md` § L2 shape requirements.

**Proposed text:**

> When specing a single-day L2 row (new create, status change to scheduled, or convention fix), spec MUST include BOTH `date` and `endDate` (with `endDate==date`). Drafter checklist:
> - `date` set ✓
> - `startDate` set (==date for single-day, work-begin for multi-day) ✓
> - `endDate` set (==date for single-day, ==date for multi-day with date==endDate convention) ✓
> - `dayOfWeek` set (matches calendar for `date`) ✓
> - `weekOf` set (==Monday(date)) — write LAST per row ✓
>
> Five-field spec for every L2. If any are missing, drafter HALTS spec and surfaces gap to TP before writing the triplet.

**Risk if not landed:** Stale single-day endDate=null rows accumulate. Eventually surface as CAT 4 sweep candidates on a future client.

---

## SECONDARY-3 — Notes replace-vs-append discipline

**Pattern:** When writing notes updates, drafter must distinguish "replace" (overwrite the field with new content) from "append" (concatenate to existing). MCP path defaults to replace; helper path can do either. Without explicit intent in the spec, drafter has guessed wrong → duplicate sentence drift.

**Evidence today:**
- `convergix-cards-2026-05-01` A8 R2 (CDS Vertical Campaign): the R2-presentation sentence was duplicated in notes because a prior write appended instead of replacing. Required A8 dedupe in the convention sweep batch.
- A12 (New Capacity Daniel-blocker): same pattern — duplicate Daniel-blocker sentence required dedupe.

**Cohort signal:** 1-of-4 within Cgx (2 rows in convention sweep dedupes). Could surface on any client where notes are updated multiply.

**Proposed location:** `drafter-prompt.md` § Notes writes; `data-conventions.md` § Notes style (already present — extend).

**Proposed text:**

> Every notes write in a spec MUST declare `replace` or `append` explicitly. Drafter writes the helper call accordingly:
> - **Replace:** `updateProjectField({field: "notes", value: "<full new notes string>"})` — overwrites prior content.
> - **Append:** `updateProjectField({field: "notes", value: existingNotes + " " + newSentence})` — drafter pulls existing notes, concatenates, writes back.
>
> When in doubt, default to `replace` and include the full intended notes string in the spec. If the spec says "add a sentence about X" without declaring intent, drafter HALTS and surfaces to TP.
>
> **De-dupe rule:** Before any notes write, drafter scans the proposed new value for sentences that exist verbatim in current notes. If duplicate sentence detected, drafter flags to TP — this is the A8/A12 pattern.

**Risk if not landed:** Duplicate sentences accumulate over multi-pass updates. Each one is a row touch on the next sweep.

---

## Summary index

| Patch # | Severity | Location | Lines of skill text |
|---|---|---|---|
| #20 | Reference | `data-conventions.md` | ~5 |
| #22 | Ergonomic | `drafter-prompt.md` + `data-conventions.md` | ~10 |
| #23 | Process | `drafter-prompt.md` + `data-conventions.md` | ~12 |
| #24 | Process | `drafter-prompt.md` + `rails-reference.md` | ~10 |
| **#25** | **CRITICAL** | `SKILL.md` + `data-conventions.md` + `holdout-panels.md` | ~20 (multi-file) |
| SEC-1 | Process | `drafter-prompt.md` + `rails-reference.md` | ~8 |
| SEC-2 | Process | `drafter-prompt.md` | ~8 |
| SEC-3 | Process | `drafter-prompt.md` + `data-conventions.md` | ~10 |

**Recommended landing order:**
1. **#25 first — lands BEFORE next-cohort first batch begins.** CRITICAL, lands in 3 files, blocks future high-volume batches with wrappers. If next cohort kickoff occurs without #25 landed, escalate to operator before authorizing any prod-write batch on a wrapper-having client.
2. **#24 + SEC-1 + SEC-2 + SEC-3** — drafter discipline cluster, lands together in `drafter-prompt.md`. ~36 lines combined.
3. **#23** — pre-spec decision matrix, complementary to drafter discipline cluster.
4. **#20 + #22** — lower priority reference/ergonomic patches, land together when convenient.

**Bump signal — operator decision point:**
- Default proposal: 6-of-8 landed → bump v4.1; all 8 landed → v4.2.
- Alternative: bump only when #25 lands (CRITICAL is the version-defining patch); other 7 are non-version-bumping additions.
- Operator picks. Default is "land all 8 before bumping" (cleaner) but #25-only-bump is defensible if landing pace is slow.
