# Cross-check templates

Per-artifact verification templates. Apply the matching template at the start of every cross-check task. Templates are checklists, not scripts — adapt to scope.

## Spec

Triggered by: `"spec written, ready for evaluator at <path>"`.

### What to verify

- [ ] Audit row count math: ops listed in spec sum to claimed audit count
- [ ] Field whitelist: every `field:` is in PROJECT_FIELDS or WEEK_ITEM_FIELDS (use data-tp's `rails-reference.md`)
- [ ] Helper choices: each op uses the correct helper (updateProjectField vs overrideProjectDate vs updateProjectStatus etc.)
- [ ] Wrapper handling: any retainer wrapper date write uses `bypassGuard: true`
- [ ] Category-first ordering: any L2 deadline-category row changing date+category flips category in earlier op
- [ ] Paired startDate / dayOfWeek / weekOf writes on date changes
- [ ] Cascade implications: every dueDate write notes the expected cascade row count
- [ ] Locked operator decisions: spec reflects current cohort decisions, not prior ones
- [ ] Pre-flagged issues: spec acknowledges or addresses every flag from prior cross-check or operator escalation
- [ ] Idempotency: unique batchId, unique updatedBy (bumped if retry after revert)

### Verdict guide

- **GREEN**: all checks pass, no flags, ready for drafter dispatch
- **GREEN with hygiene**: minor doc-quality issues (typos, ID format, comment cleanup) — fix before drafter or note for amendment
- **YELLOW**: a check fails but is fixable in spec edit (operator decision needed on flag, or one missing op) — fix before drafter dispatch
- **RED**: structural issue (wrong helper, missing wrapper guard, audit math off, cascade unaccounted) — drafter dispatch blocked

### Output format

```
Spec cross-check verdict: <GREEN/YELLOW/RED>

Findings:
- <severity> | <flag> | <evidence path or row id>
...

Locked decision verification:
- <flag>: <spec value> matches operator-stated <decision>
...

Recommended next step: <drafter dispatch / spec edit / operator escalation>
```

## Triplet (T2)

Triggered by: `"triplet ready for evaluator T2 at <path>"`.

### What to verify

Read all 3 files: forward + verify + REVERT.

**Forward batch:**

- [ ] DRY_RUN output count matches spec audit count (read DRY_RUN log if data-tp surfaced it)
- [ ] setBatchId at start, unset at end
- [ ] Helper-only writes (no raw drizzle unless field is outside whitelist + manual insertAuditRecord)
- [ ] Each op matches its spec line (no extra ops, no missing ops)
- [ ] Apply 12-point rails compliance check from data-tp's `rails-reference.md`

**Verify script:**

- [ ] One assertion per intended state change
- [ ] Audit count assertion: `find_updates(batchId)` length === spec count
- [ ] Reads prod, exits non-zero on any failure

**REVERT script:**

- [ ] Inverse writes for every forward write
- [ ] Bumped `updatedBy` (e.g., `<original-updatedBy>-revert`)
- [ ] Same DRY_RUN/APPLY mode pattern as forward
- [ ] Documents which audit rows will be reversed

### Verdict guide

- **GREEN**: all 3 files clean, rails check passes, DRY_RUN matches spec
- **GREEN with hygiene**: minor formatting / comment issues
- **YELLOW**: rails violation that's fixable in drafter re-dispatch (e.g., missing paired startDate, audit count off by 1)
- **RED**: structural rails violation (missing wrapper guard, wrong helper, cascade unaccounted, REVERT inverse wrong)

### Output format

```
Triplet T2 verdict: <GREEN/YELLOW/RED>

Forward findings: <list>
Verify findings: <list>
REVERT findings: <list>
12-point rails compliance: <pass/fail per point>

Recommended next step: <APPLY-ready / drafter re-dispatch / operator escalation>
```

## Handoff doc section

Triggered by: `"<handoff doc> ... written to disk at <path>, ready for evaluator review"`.

### What to verify

- [ ] Audit row math: claimed counts sum correctly across batches
- [ ] Batch ledger: each batch enumerated with correct audit count + brief description
- [ ] Outcomes section: each outcome traceable to a specific row write or operator decision
- [ ] Operator-locked deferrals: complete list, no surprise omissions
- [ ] Cohort table: rows + columns consistent with prior tables; new entries cleanly added
- [ ] File index: every cited file path exists on disk (use `ls`)
- [ ] Skill v4 patches list: matches the count + names in the snapshot's `v4PatchCandidatesQueued`
- [ ] No stream-of-consciousness leaks ("wait, current=...", "actually maybe...", mid-thought interruptions)
- [ ] ID formatting: project IDs in 8-char short form, not malformed strings
- [ ] TL;DR or summary lines accurately reflect closed status

### Verdict guide

- **GREEN**: all checks pass, no flags
- **GREEN with hygiene**: doc-quality items (ID normalization, leak cleanup, file-index gaps) — fix before final commit
- **YELLOW**: factual error in batch description, audit count, or cohort table — must fix before commit
- **RED**: misrepresents what shipped (e.g., claims a row state that prod doesn't reflect) — operator must see immediately

### Output format

```
Handoff doc cross-check verdict: <GREEN/YELLOW/RED>

Hygiene items (non-blocking): <list>
Substantive findings (blocking): <list>
File-index verification: <ls output summary>

Recommended next step: <commit / amend then commit / operator escalation>
```

## Skill v4 patches

Triggered by: `"skill v4 patch candidates written to disk at <path>, ready for evaluator review"`.

### What to verify per patch

- [ ] Pattern claim is accurate (not "this might happen" — actual occurrence in this session)
- [ ] Evidence cites real batches/rows that you can verify by reading the spec/triplet/snapshot
- [ ] Cohort signal is correctly counted (1-of-N, M-of-N) per the cohort table
- [ ] Severity classification (CRITICAL / Process / Ergonomic / Reference) defensible
- [ ] Proposed location is sensible (correct skill file)
- [ ] Proposed text is operator-actionable (not vague)
- [ ] Risk-if-deferred section names a concrete failure mode

### Verdict guide

- **GREEN**: all checks pass per patch, evidence verified
- **YELLOW**: pattern is real but evidence is misattributed or cohort signal is off — tighten before operator review session
- **RED**: pattern claim is not supported by session evidence (e.g., claims a behavior that didn't happen) — drop the patch or rewrite

### Output format

```
Skill v4 patches cross-check verdict: <GREEN/YELLOW/RED per patch>

Per-patch:
- #<N>: <verdict> | <one-line summary of issue if any>
...

Recommended landing order (if all GREEN): <see proposal in candidates doc, or amended order>
Operator decision points (surface for review session): <list>
```

## Snapshot JSON

Triggered by: data-tp surfaces a snapshot for cross-check (often as part of cohort close or post-APPLY verification).

### What to verify

- [ ] _meta block: snapshotAt timestamp, scope, round name accurate
- [ ] Predecessor batches enumerated correctly with audit row counts
- [ ] globalHealth: counts match what get_data_health currently returns (sanity check)
- [ ] Per-scope state: L1/L2 counts plausible, orphan count = 0
- [ ] Wrapper guard: state matches expected (engagementType=retainer, parentProjectId=null, dates intact)
- [ ] L1 highlights: each entry traces to a row write in the cited batch or operator decision
- [ ] Operator-locked deferrals: complete enumeration
- [ ] No stream-of-consciousness leaks
- [ ] ID format: 8-char short form throughout

### Verdict guide

- **GREEN**: all checks pass
- **GREEN with hygiene**: doc-quality items only
- **YELLOW**: prod-state claim doesn't match what MCP returns (re-pull or correct)
- **RED**: structural data integrity claim is wrong (e.g., orphan count = 0 but get_orphan_week_items returns rows)

## Audit prior work

No signal-file trigger — operator briefs directly.

### What to verify

- [ ] Pull `find_updates(batchId=<batchId>, limit=100)` for the audited batch
- [ ] Pull current prod state for affected entities
- [ ] Read original spec doc + triplet (if available) — verify what was intended
- [ ] For each intended write: did prod end up in the right state?
- [ ] Audit count: does `find_updates` length match the documented count?
- [ ] Cascade rows: were they expected? do they reflect correctly?
- [ ] Any post-batch drift: has anything changed since the batch landed (Slackbot writes, manual MCP edits)?
- [ ] If multiple batches in scope, repeat per batch + check inter-batch consistency

### Verdict guide

- **CLEAN**: prod matches intent, audit log complete, no drift
- **DRIFT**: prod state differs from intent in non-trivial ways — recommend corrective batch or operator decision
- **MISSING WRITES**: documented audit count > actual `find_updates` count — possible idempotency collision or partial APPLY

### Output format

```
Audit verdict: <CLEAN/DRIFT/MISSING WRITES>

Per-row check: <table or list of intent vs actual>
Cascade verification: <expected vs actual count>
Post-batch drift: <list of changes since batch APPLY, if any>

Recommended next step: <accept clean / corrective batch in scope <X> / operator decision needed on <Y>>
```

## Investigation

No signal-file trigger — operator briefs directly with a question.

### What to verify

- [ ] Narrow hydration: pull only what's needed for the question
- [ ] Read relevant code rails (e.g., recompute behavior for a "why did this date shift" question)
- [ ] Trace evidence: file paths, audit row ids, MCP tool outputs
- [ ] Don't escalate scope: answer the question asked, not adjacent ones (note adjacent gaps if relevant, don't investigate them)

### Output format

```
Investigation finding: <one-line answer>

Evidence:
- <file:line or row id or audit row id>
- <citation>
...

Recommended next step (if applicable): <one option only, no menu>
```

## Template-not-applicable cases

If the artifact you're asked to cross-check doesn't match any of the above templates, escalate to operator — don't improvise. Examples: a one-off MCP override, a brain-doc rewrite, a code change to runway helpers. Those are out of scope for the evaluator role.
