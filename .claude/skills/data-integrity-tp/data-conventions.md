# Data Conventions

Living reference for L1/L2 data conventions and notes style. Update when operator confirms a new rule.

## Date and weekOf invariants

### Single-day items
- `date = startDate = endDate`
- `dayOfWeek` matches `date`'s day name
- `weekOf = Monday(date)`

### Range tasks (multi-day)
- `date = endDate` (NOT startDate — the convention anchors on the end)
- `startDate` = kickoff day
- `endDate` = final day
- `dayOfWeek` matches `endDate`'s day name
- `weekOf = Monday(date)` = Monday of endDate

### weekOf must be manually updated
`weekOf` does NOT auto-update when `date` crosses a Monday boundary in `updateWeekItemField`. Always include `weekOf` in the write set when date moves week. Order it LAST in any batch (lookups use the OLD weekOf).

### Empty-string endDate (data-quality watchpoint)
Drizzle text columns allow empty strings (`""`), distinct from NULL. Some prod rows have `endDate=""` instead of NULL — observed on Bonterra and AG1 before cleanup. Both are visually "empty" in tool output but behave differently:

- SQL `endDate IS NULL` won't match empty string
- JS `endDate ?? date` (nullish coalescing) does NOT fall back on empty string — it uses `""`, which compares lexicographically wrong against ISO dates

Treat empty-string endDate as drift to fix: set it to a real ISO date (single-day → date; range → endDate) or explicitly NULL. Don't leave `""` in place. Same applies to other date-shaped fields (startDate, dueDate, contractStart, contractEnd).

## Status enum (L1 vs L2 are different)

L1 status (project) and L2 status (week_item) use different enums. Easy to mix up.

| Layer | Valid statuses |
|---|---|
| **L1 project** | `not-started`, `in-production`, `awaiting-client`, `blocked`, `on-hold`, `completed`, `canceled` |
| **L2 week_item** | `scheduled`, `in-progress`, `blocked`, `at-risk`, `completed`, `canceled` |

Common confusion: L1 active work is `in-production` (NOT `in-progress`). L2 active work is `in-progress` (NOT `in-production`).

Status changes to terminal values (`completed`, `canceled`, `on-hold` on L1) cascade to linked L2 week items.

## Categories (week_items)

| Category | When to use |
|---|---|
| `delivery` | Default for "still working" tasks. Preferred over `kickoff` once work is in motion. |
| `kickoff` | Only for true start markers. Rare. If the row describes ongoing work, use `delivery`. |
| `review` | When the row IS a review event |
| `approval` | When the row IS an approval gate |
| `deadline` | ⚠️ Triggers reverse-cascade to parent project on date changes. See trap below. |
| `launch` | Terminal marker (LAUNCH row) |

### Reverse-cascade trap
Writing `date` on an L2 with `category=deadline` AND a `projectId` set overwrites the parent project's `dueDate`. Always check category before any `date` write. To break the cascade, flip category to `delivery` first.

**Only the `date` field triggers cascade.** `endDate`, `startDate`, status, notes, and other field writes on deadline rows are safe — no cascade fires. Confirmed 2026-04-29 with 2 deadline-row endDate writes returning `reverseCascaded: false`. The MCP tool description's phrase "deadline-category date changes" is misleadingly broad; the cascade is `date`-only.

### Wrapper-guard
Retainer L1s with children pin their start/end dates. Use `overrideProjectDate` (not `update_project_field`) for date changes on wrapper-guarded projects.

## L1 dueDate anchor

Every hard-deadlined L1 must have `dueDate` set. The anchor is the terminal-deliverable date:

- **Single-event projects** (e.g., a launch): `dueDate = launch date`. Hopdoddy Brand Refresh = 2026-05-19 (launch).
- **Multi-phase projects with warranty period**: `dueDate = contract close`. TAP ERP Rebuild = 2026-11-30 (10/29–11/30 is post-go-live warranty).
- **Multi-phase projects without warranty**: `dueDate = last operational L2 endDate` (typically final phase end).

For projects without a hard deadline (open-ended retainers, exploratory work), `dueDate=null` is correct. Don't fabricate a deadline.

`dueDate` is the canonical "when is this engagement done?" field — distinct from `endDate` (auto-derived from L2 widths) and `contractEnd` (signed term). Tooling layers (Gantt, Pipeline) anchor on `dueDate` for prioritization.

`updateProjectField({field:"dueDate"})` triggers forward cascade to deadline-category L2s. If an L1 has zero deadline-category children, the dueDate write is safe (cascade hits 0 rows). If it has deadline children, expect their `date` to be rewritten in the same transaction. Add a defensive guard on the write: `if (r.data?.cascadedItems?.length > 0) fail(...)` when zero is expected.

## Contract dates and contractValue

### Contract date anchor: SOW Term, not Effective Date

L1 `contractStart` / `contractEnd` reflect the **SOW Term window**, NOT the Effective Date.

- **Effective Date** = signing/paperwork date (when the document went live legally).
- **SOW Term** = the work window the SOW covers (e.g., "March 1 – July 15, 2026").

Examples:
- TAP SOW Effective 2/13/2026, Term 3/1/2026–11/30/2026 → `contractStart=2026-03-01`, NOT 2026-02-13.
- AARP SOW Effective 3/10/2026, Term 3/1/2026–7/15/2026 → `contractStart=2026-03-01`, NOT 2026-03-10.
- Joint Soundly iFrame+PG SOW Effective 2/17/2026, Term 3/1/2026–5/31/2026 → both L1s `contractStart=2026-03-01`.

Paperwork-effective lag is normal; project-start lag is not. Anchor on the Term window. If the SOW lacks an explicit Term and only states an Effective Date, ask the operator before defaulting to Effective.

### client.contractValue scope

`client.contractValue` (and `client.contractTerm`) semantics depend on whether the client carries a retainer:

- **Client with a retainer + outside-retainer project SOWs** → `contractValue = retainer ARR only`. Outside-retainer project SOWs live at the L1 level (notes, dueDate, contractStart/End), not rolled into the client field.
  - Soundly: $41,600 retainer + $30K joint iFrame+PG SOW + $31,400 AARP SOW → `client.contractValue=$41,600`. The $61,400 in project SOWs lives on the per-project L1s.
  - Hopdoddy: $38K Digital Retainer ARR in `contractValue`; $14,800 Brand Refresh incremental NOT rolled in.
- **Project-only client (no retainer)** → `contractValue = sum of project SOWs`. LPPC, TAP precedent.

`client.contractTerm` follows the same rule: retainer window for retainer-clients, project span for project-only clients.

## Resources / owner format

- Role abbreviations: `AM`, `CD`, `Dev`, `CW`, `PM`, `CM`, `Strat`
- Format: `Role: Name`, separated by commas — `CD: Lane, Dev: Leslie`
- Vendor-specific (client-direct contractors): `Vendor: Name` — `Vendor: Ken Clark`
- Client-led work: just `HDL` (or the client name) — no further breakdown
- Strip `(client)` annotation from contractor names — `CW: Chris (client)` → `CW: Chris` (this annotation was wrong for Civ-side contractors)
- `owner` = single accountable person (account lead). `resources` = who is actually doing the work.

## Notes style

### What L2 notes ARE
Terse description of what the row IS. One sentence ideal. Names the actor and the deliverable. Dates are OK if they describe the row's scope (range), not crutches.

✅ `Lane delivers Batch 2 design 5/7–5/15.`
✅ `HDL reviews Batch 2 design.`
✅ `Civ presents content-capture options to HDL.`
✅ `HDL delivers Batch 1 feedback. Dave Edwards out 4/30–5/12 may slip the date.` (risk lives in the L2 where it's actionable)

### What L2 notes are NOT
- "What's blocking it" content — use `blockedBy` or status, not notes
- Workflow-meta narration
- Brain-doc references
- OPERATOR markers from drafter sessions
- Verbose process descriptions

### Strip these patterns
| Pattern | Why |
|---|---|
| `per schedule sheet [date]` | Date crutch — describes when the schedule was reconciled, not what the row is |
| `Per Jill [date]`, `per [person] [date]` | Same crutch |
| `(per brain doc ...)`, `Per brain-doc decision-gate map` | Brain-doc reference. Brain is archaeology. |
| `OPERATOR REVIEW`, `OPERATOR: verify` | Drafter-session markers; clean up after APPLY |
| `Final [batch] sign-off ...` | "Final" is process meta. Drop it. |
| `Client R1 Review ...` when resources=HDL | Redundant — `HDL reviews ...` |
| `(client)` after contractor names | Wrong for Civ-side contractors |
| `Single feedback cycle accepted (Dave out X — no Civ R2)` | Verbose. If Dave outage matters, name it directly. |
| `Not on client-facing schedule but tracked internally` | Visibility/routing concern, not row content |

### Dates in notes
OK if they describe the row's actual scope: `Lane delivers Batch 1 design 4/17–4/28.` — the dates ARE the work window.

NOT OK as a crutch: `... per schedule sheet 2026-04-28` — that's noise.

## L1 (project) notes scope

L1 notes are HIGHLIGHTS, not a schedule recap. The L2s carry the schedule.

L1 notes should answer: "What is this project? What's notable about its shape or constraints?"

### L1 should NOT include
- Every L2 date enumerated (the L2 rows carry that)
- Risk content (lives in the L2 row where actionable, not L1 — nobody sees it at L1)
- Schedule reconciliation references (`schedule sheet [date]`)

### L1 should include
- One-sentence project identity
- Notable shape constraints (logistics, structure, hand-offs)
- Key terminal date (LAUNCH or contract end)

✅ Good L1: `Website Build for HDL. Two design+dev batches bookending a 6/1 photo shoot in Bend. LAUNCH 7/7.`

## Structural review (do this BEFORE field cleanup)

When walking a client, run a structural pass first. Field-level cleanup on the wrong structure is wasted work.

### Check L1 notes for collapsed children

If an L1's notes describe distinct batches, sub-projects, or named workstreams with their own scope, those are likely L1 children that got jammed into notes. Examples:

- ❌ Bad: L1 notes say "Batch 1 (6 Hugh Content pieces) completed. Batch 2 = AG1 PRO Content (concepting; 5-6 pieces) nested as child Project."
- ✅ Good: Hugh Content and AG1 PRO Content are each their own L1 child of the wrapper.

If the system has only L1/L2 (no L3), retainer wrappers act as the parent layer for batches. Each batch is its own L1 child.

### Check L2 dates against L1 scope

L2 dates auto-derive their parent L1's startDate/endDate via recompute. If L1 dates look wrong, the fix is at L2, not L1 (see `row-by-row.md` § MCP write quirks for the field-whitelist gotcha).

### Reverse the question

For each L1 with notes longer than 1-2 sentences, ask: "Is anything in this paragraph really an L1 child or an L2 row that should be created?" If yes, do that BEFORE you tighten the notes.

## Mechanical sweep categories (do this AT END of cleanup)

After row-by-row writes are applied, run a mechanical sweep across the client's L1s and L2s. Before scoping the sweep, explicitly name and check these seven categories:

1. **Date conventions** — multi-day rows: `date == endDate`; single-day: `date == startDate == endDate`; `dayOfWeek` matches `date`'s day name; `weekOf == Monday(date)`. See § Date and weekOf invariants.
2. **Past-dated rows with non-terminal status** — any row with `date < today` and status NOT IN {`completed`, `canceled`, `deferred`}. Either status is wrong or the date moved forward and the row is stale.
3. **Resources missing role prefix** — bare names without `Role: Person` shape (e.g., `Leslie` instead of `Dev: Leslie`). See § Resources / owner format.
4. **Stale single-day shape on active range work** — single-day shape (`endDate=null`, `date==startDate`) on a row whose notes/scope describe multi-day work. Either widen to range or confirm row is genuinely single-day.
5. **Task-dependent role labels** — role tag mismatches the actual task (e.g., a `CW`-tagged row where the task is AM work like a client clarity ping).
6. **Resources peer-alignment gap** — L2 `resources` missing a role tag that's present on the parent L1 (e.g., L1 has `PM: Jason, Dev: Tim`; L2 has just `Dev: Tim`). Distinct from #3 (missing prefix entirely) — here the prefix exists, the *peer alignment with L1* drifted. Promoted from tracked-class 2026-05-01 after 2-of-3 cohort hits (TAP + Soundly).
7. **Missing retainer wrapper L1** — client carries a retainer per `client.contractValue` / `contractTerm` but no L1 with `engagementType=retainer + parentProjectId=null` exists. The retainer relationship is data-structurally absent. Add the wrapper (per Hopdoddy + Soundly pattern: `addProject` with retainer fields + `overrideProjectDate` for startDate/endDate; wrapper guard does NOT fire when children=0). First surfaced 2-of-3 cohort 2026-05-01 (Hopdoddy added late + Soundly missing entirely). Convergix already has wrapper. Cross-client check pending on Beyond Petro et al.

If a category is intentionally out of sweep scope for a given client, name it explicitly and say why. Don't scope a sweep narrowly without naming what's omitted — that's the LPPC-Pencils-Down failure mode.

Result of sweep: either no-op (every category was absorbed by row-by-row writes), or a small additional batch of corrective writes to close the gaps.

### Tracked but not yet enforced

Emerging drift classes — surface them in the sweep report but don't block on them yet. If 2-of-N clients in a cohort surface the same class, promote to enforced category in this list.

- **Category semantic drift** — L2 `category=kickoff` for ongoing phase work. Kickoff is a single-moment phase-start marker, not a multi-week phase. First surfaced TAP 2026-04-30 (5-of-5 phase L2s tagged kickoff for ongoing dev/migration/testing/training work).

## Title naming for L2s

Titles should be specific enough that the row is identifiable without seeing its parent. Generic titles ("Concept Writeups", "Review", "Kickoff") lose context when the client has multiple parallel projects.

- Prefix with parent identity when the title alone is ambiguous: `AG1 Pro Concept Writeups` (not just `Concept Writeups`)
- This is NOT a hard rule — when the title is already specific (`HDL R1 Site Review`, `Production Shoot`), don't add redundancy
- Trigger: if multiple clients or projects could plausibly own a row with the same title, the title is too generic

## Reference / vendor data

- **Photographer bids stay OUT of the DB.** Reference info only.
- **Stakeholder Q&A drafts.** Operator-facing, never bot-facing — keep them in `docs/tmp/`, not in row notes.
