# Data Integrity TP — Cohort Handoff

Successor TP reads this in full before invoking `/data-integrity-tp`. Rolling cohort handoff — most recent session-close at top. Each session-close section dates itself within.

**Note on file references:** Per-session "Snapshot state on disk" sections list paths under `docs/tmp/data/...` and `scripts/runway-migrations/...`. These resolved at the time of writing within the session's worktree. Worktrees are disposed after cohort close, so post-disposal those paths resolve only via the session's feature branch history on `origin` — e.g., Convergix artifacts at `origin/feature/data-tp-cluster3` (commit `0bfee29`). Treat in-doc file references as historical audit-trail; fetch the branch if you need to reconstitute.

## Session 2026-05-04 close (HDL Q&A ✓ — trivial-path, holdout-skip, Policy A APPLY)

**High Desert Law** — `hdl-qa-2026-05-04` APPLIED clean at 2026-05-05T01:14Z. 6 audit rows. Verify 20/20 PASS. 0 cascade-duedate + 0 cascade-status-change rows. Trivial-correction path APPLY (second in this session, after LPPC Tom-contingency).

### Pipeline arc
T1 GREEN (no Qs) → drafter dispatch (a52129488297bade9, sibling-worktree to agent-af90eb60 per LPPC pattern) → T2 GREEN → Policy A APPLY (trivial-path) + verify exit 0. Holdout panels SKIPPED per skill carve-out.

### What landed (6 audit rows on `hdl-qa-2026-05-04`)

**A.1 (1 row, week-field-change)** — Calculators (5.3+5.4) L2 `8a41acc3...` notes replace per operator answer (reskin from old site, Chris writes copy aligned with Batch 2, dev-cycle L2 companion).

**A.2 (1 row, week-field-change)** — Legal Articles (5.5–5.7) L2 `e51cd07c...` notes replace (Chris + Client decide forking; aligned with Batch 2 copy lock either way).

**A.3 (2 rows, week-field-change)** — Open Page Decisions L2 `7ebfba02...`:
- status: scheduled → completed
- notes: replaced (Chris provides 3.6/8.1/8.2 per Batch 2 alignment; 8.3 Site Map dropped as backend-only).

**B.1 (1 row, delete-week-item)** — Schema/SEO/AIO L2 `bc34aac7...` DELETED per operator Q5 (Ken Clark work is HDL-direct contractor, not Civ schedule).

**B.2 (1 row, new-week-item)** — `createWeekItem` "Calculators (5.3 + 5.4) — Dev Build" under Website Build L1, date 2026-06-04 thursday (Batch 2 Dev cycle end), category=delivery, status=scheduled, owner=Jill, resources="Dev: Leslie". NEW_CALCULATORS_DEV_L2_ID = `a91332c4ebee4d87b0bc9e2e7`.

### Cascade verification (skill v4 #33 confirmed pattern)
B.1 deleteWeekItem + B.2 createWeekItem both trigger silent `recomputeProjectDatesWith(websiteBuildId)` per `operations-writes-week.ts:303-304` (B.2) and equivalent path on delete. Website Build L1 envelope already 2026-04-17/2026-07-07 (Batch 1 Design start to LAUNCH). Both ops fall within envelope → no-op skip → no audit row + no state drift. Verified post-APPLY: Website Build envelope STILL 4/17-7/7. Project-typed L1 silent-recompute pattern (skill v4 #33) confirmed harmless when no-op skip path triggers.

### Snapshot state on disk
- Triplet (sibling-worktree `agent-af90eb60`):
  - Forward (6 audit rows, self-asserted)
  - Verify (20 assertions: 6 state + 6 hygiene + 3 envelope drift + 5 type-count)
  - REVERT (B.2 inverse via env-var id, B.1 inverse via createWeekItem with hard-coded snapshot, A.1+A.2+A.3 inverses with hard-coded note/status snapshots, updatedBy bumped)
- Closing snapshot: `docs/tmp/data/hdl-qa-snapshot-2026-05-04.json`
- Plan v1: `docs/tmp/data/hdl-qa-plan-2026-05-04.md`
- Brief: `docs/tmp/data/evaluator-hdl-qa-2026-05-04.md`

### Open carry-forward
- Site Staging L2 (`56e46f3a...`) at 6/4 stays — separate L2 from B.2 dev-build despite shared date (day-before-review pattern preserved)
- Worktree disposal queued: agent-af90eb60 + agent-a0d44b26 + agent-a786efa5 + agent-a75ccabd + agent-a30566d3 + agent-af5c2d56 + agent-a5212948 (operator gate)

---

## Session 2026-05-04 close (LPPC Tom-contingency ✓ — trivial-path, holdout-skip, Policy A APPLY)

**LPPC** — `lppc-tom-contingency-2026-05-04` APPLIED clean at 2026-05-05T00:46Z. 5 audit rows. Verify 15/15 PASS. 0 cascade-duedate + 0 cascade-status-change rows. **Trivial-correction path** APPLY under Policy A — first batch in this session to use the skill carve-out (5 ops, 0 cascade, no novel pattern → holdout panels skipped per skill).

### Pipeline arc
T1 GREEN (no Qs) → drafter dispatch (af5c2d56, but written into agent-af90eb60 worktree since own dispatch worktree was on divergent old branch without runway source — same workaround as BP corrective drafter) → T2 GREEN (with side-effect (a) ACCEPT verdict) → Policy A APPLY (trivial-path) + verify exit 0. Holdout panels SKIPPED per skill carve-out.

### What landed (5 audit rows on `lppc-tom-contingency-2026-05-04`)

**A.1 (2 rows, week-field-change)** — Pencils Down L2 `87074daa09664bcc86b7dc6e1`:
- status: blocked → scheduled
- notes: replaced with operator + Kathy 5/4 statement ("stays firm 5/4 with or without Tom's feedback; if Tom lands today his asks ship pre-launch, else they shift to post-launch revision pass").

**A.2 (2 rows, week-field-change)** — Article Tagging Structure (CMS) L2 `6fdb1c4d0d04416c9fb3d3e24`:
- status: in-progress → completed
- notes: replaced with Kathy 5/4 ("Leslie's CMS structure portion COMPLETE; client now tags articles directly in CMS — downstream client-side work").

**B.1 (1 row, new-week-item)** — `createWeekItem` "Post-launch Revisions — Tom's Feedback" under Website Revamp L1:
- date 2026-05-12 (monday placeholder for post-launch revision window)
- category=delivery, status=scheduled
- owner=Kathy, resources="CW: Kathy, CD: Lane, Dev: Leslie"
- NEW_POST_LAUNCH_REVISIONS_L2_ID = `4e1cf89ce4cf450e87f5f3dac`

### Side-effect documented (per T2 verdict)
B.1 createWeekItem triggered silent `recomputeProjectDatesWith(websiteRevampId)` per `operations-writes-week.ts:303-304`. Website Revamp is project-typed (NOT retainer-wrapper) → no retainer guard → recompute proceeded. Website Revamp L1 endDate silently widened from 2026-05-11 to 2026-05-12. **Operator + evaluator accepted (a) per T2** — post-launch revision L2 is legitimately under Website Revamp; "5/11 hard launch" intent stays anchored on Website Launch L2 itself (date=5/11 unchanged), not the L1 envelope. Adding a post-B.1 override would awkwardly treat post-launch work as outside-envelope. Audit math 5 unchanged.

### NEW skill v4 candidate

**Skill v4 #33 (NEW)** — Project-typed L1 silent recompute on new L2 add. When `createWeekItem` lands a new L2 under a project-typed L1 (engagementType=project, NOT retainer-wrapper), recompute fires and silently adjusts L1 startDate/endDate via raw UPDATE (no audit row). For retainer-wrappers, the wrapper guard short-circuits when the wrapper has L1 children. For project L1s, no guard — recompute always runs. Not data corruption since it reflects real scope. Worth flagging because it's silent and may surprise operators reviewing the audit log post-APPLY.

### Snapshot state on disk
- Triplet (worktree `agent-af90eb60`, branch `bp-corrective-2026-05-04` — drafter sibling-worktree workaround):
  - Forward (5 audit rows, self-asserted)
  - Verify (15 assertions: 8 state + 5 hygiene + 2 batch type counts)
  - REVERT (B.1 inverse via env-var id, A.2 + A.1 inverses with hard-coded snapshots, updatedBy bumped to `...-revert`)
- Closing snapshot: `docs/tmp/data/lppc-tom-contingency-snapshot-2026-05-04.json`
- Plan v1: `docs/tmp/data/lppc-tom-contingency-plan-2026-05-04.md`
- Brief: `docs/tmp/data/evaluator-lppc-tom-contingency-2026-05-04.md`
- T2 verdict: `docs/tmp/data/signals/evaluator-ready.txt` (00:42Z line)

### Open carry-forward
- If Tom Falcone replies pre-launch (today 5/4): close B.1 L2 as not-needed (next-round)
- If Tom doesn't reply: B.1 L2 is the home for his post-launch asks
- Worktree disposal queued: agent-af90eb60 + agent-a0d44b26 (CGX) + agent-a786efa5 (BP-restructure) + agent-a75ccabd + agent-a30566d3 (operator gate) + agent-af5c2d56 (LPPC dispatch — divergent branch, no triplet on it)

---

## Session 2026-05-04 close (BP corrective ✓ — full pipeline, T3 amendment, Policy A APPLY)

**Beyond Petrochemicals** — `bp-corrective-2026-05-04` APPLIED clean at 2026-05-05T00:09Z. 27 audit rows. Verify 59/59 PASS. 0 cascade-duedate + 0 cascade-status-change rows. T3-amendment-flow APPLY under Policy A (third in this session: AG1 → BP-restructure → CGX-corrective → BP-corrective).

### Pipeline arc
T1 GREEN → drafter dispatch (af90eb60) → T2 GREEN → 6 holdout panels → Panels 5+6 FAIL on **B-recompute overwrites A.1 Fact Sheets envelope** (skill v4 #26 silent-cascade pattern repeating; same shape as CGX B.2/B.3 with 2H wrapper) → T3 AMENDMENT (mechanical reorder + 3 operator decisions: D1 drop A.7 timing-violation, D2 notes-tag Hopkins+KYN placeholder-window, D3 REVERT C id-resolve) → drafter amends → T2 v2 GREEN → Panels 5+6 v2 PASS → Policy A APPLY + verify exit 0.

### What landed (27 audit rows on `bp-corrective-2026-05-04`)

**Cluster B (1 row, FIRST in execution per T3 reorder)** — `createWeekItem` "Fact Sheet — Final Version (3 colorways) to Client" under Fact Sheets L1, date 2026-05-05 tuesday, category=delivery, status=in-progress. NEW_FACT_SHEET_FINAL_L2_ID = `2e5441fe09134af89475d3245`. **B fires first** so its silent recomputeProjectDatesWith on Fact Sheets (which would set 5/5-5/5) gets overwritten by A.1's last-write-wins overrideProjectDate calls.

**Cluster A.1 (8 rows, date-override)** — 4 retainer-children L1s (Organic Social, Fact Sheets, spilltracker maint, Email Templates) → startDate=2026-01-01, endDate=2026-06-30 via `overrideProjectDate` (no recompute trigger). Re-pins Fact Sheets envelope post-B.

**Cluster A.2 (6 rows, date-override)** — 3 standalone L1 date placeholders: Hopkins 7/1-9/30, KYN 6/1-8/31, Plastic Additives 4/27-4/27.

**Cluster A.2-bis (2 rows, field-change project notes per T3 D2)** — Hopkins + KYN notes appended with "Per 2026-05-04 corrective: startDate/endDate set as placeholder window pending SOW" (mirrors 2H wrapper placeholder convention). Plastic Additives skipped (dates exact, not placeholder).

**Cluster A.3 (4 rows, field-change)** — 4 standalone L1s engagementType null → "project".

**Cluster A.4 (1 row)** — Plastic Additives category active → completed.

**Cluster A.5 (1 row)** — Fact Sheets dueDate 5/1 → 5/5 (Kathy "going back to client Tue 5/5"). 0 cascade-duedate (Fact Sheets has 0 deadline-category L2 children; B's new L2 is delivery-category).

**Cluster A.6 (3 rows, field-change)** — 3 L1 resources updates (Organic Social, BP.org maint, spilltracker maint) per Kathy doc Qs 2a/2b/2c.

**Cluster C (1 row, new-item)** — `addProject` "2H Beyond Petro Retainer" wrapper L1, peer to 1H, parentProjectId=null, retainer, contractStart=2026-07-01, contractEnd=2026-12-31, $105K placeholder (operator-locked Decision A from earlier 5/4). NEW_2H_BP_ID = `79911bc13ba8422cabf4d2ad6`.

**A.7 DROPPED** per T3 D1 — web-traffic L2 endDate=2026-05-04 was premature on status=in-progress; deferred to next-round.

### NEW patterns / skill v4 candidates this batch

1. **Skill v4 #32 (NEW)** — `updateProjectField` notes-append idempotency edge case. idem key composed at runtime as `(type, projectId, "notes", currentNotes+APPEND_TEXT, updatedBy)`. If APPLY succeeds and forward re-runs (partial-failure retry), currentNotes already has tag → re-run computes `tag+tag` newValue → fresh idem key → would double-tag. Mitigation: setBatchId + REVERT-bumped-updatedBy. APPLY single-shot → theoretical only. Operator follow-up candidate: helper-side dedupe on substring-check before append.

2. **Pattern: B-fires-first reorder for cascade safety** — when a forward batch creates a new L2 under a non-wrapper retainer L1 (which falls through retainer-wrapper guard since it has 0 L1 children), the createWeekItem's silent recompute will overwrite any subsequent A.1-style envelope set on that same L1. Mitigation: reorder so B fires BEFORE A.1, making A.1's overrideProjectDate the last writer. Audit count unchanged. Cleaner than post-B B.3-style override (which would idem-collide on same updatedBy).

3. **Pattern: REVERT strip-suffix for notes-append (vs hard-coded snapshot)** — when forward appends to notes and pre-batch snapshot wasn't captured, REVERT can use `endsWith` + slice to strip the appended suffix. WARN-on-missing-suffix for drift safety. Robust against post-APPLY notes drift.

4. **Pattern: REVERT id→name resolve workaround** — when a helper signature requires name (e.g. `deleteProject({clientSlug, projectName})`) but the env-var captures id (REVERT_NEW_2H_BP_ID), REVERT can: (a) drizzle SELECT to read current name by id, (b) pass name to helper. Helper-only rule preserved (only reads via drizzle, no raw deletes). Defensive WARN on rename drift.

### Snapshot state on disk
- Triplet (worktree `agent-af90eb60`, branch `bp-corrective-2026-05-04`):
  - Forward (32.9KB approx, T3-amended)
  - Verify (60+ assertions: 25 state + 5 hygiene + 6 pre-flight + 27 audit-count + drift checks)
  - REVERT (T3-amended: B inverse last, A.7 inverse dropped, A.2-bis strip-suffix inverse, C id→name resolve)
- Closing snapshot: `docs/tmp/data/bp-corrective-snapshot-2026-05-04.json`
- Plan v1: `docs/tmp/data/bp-corrective-plan-2026-05-04.md`
- Brief: `docs/tmp/data/evaluator-bp-corrective-2026-05-04.md`
- Worktree disposal queued: agent-af90eb60 + agent-a0d44b26 (CGX) + agent-a786efa5 (BP-restructure) + agent-a75ccabd (AG1-corrective) + agent-a30566d3 (AG1-initial)

### Open carry-forward
- **Skill v4 #28 + #29 + #30 + #31 + #32 candidates** — to land in next data-integrity-tp skill update (#28 external-deadline marker carve-out, #29 cascade-writes-only-date, #30 title-as-stateful-lookup-key, #31 helper-return-id ergonomics, #32 notes-append idempotency edge case)
- **Operational follow-ups**:
  - Web-traffic L2 endDate fill (when Leslie completes — next round)
  - 1H BP wrapper resources expansion to full team (when Email Templates resources land per Kathy Q4 → Jill — next round)
  - Plastic Additives parent re-link to Clipping Campaign (when Clipping signs)
  - Pipeline-promotions when SOWs sign: SpillTracker, Ammonia LP, ITEP LP, Clipping Campaign (each separate batch)
- **Code follow-ups**: cascade-duedate sync (skill v4 #29), helper-return id (skill v4 #31), notes-append dedupe (skill v4 #32), updateProjectField startDate/endDate routing (currently rejected by whitelist, requires `overrideProjectDate`)
- **Decision-log audit** — operator-side, evaluator-owned

---

## Session 2026-05-04 close (CGX corrective ✓ — full pipeline, T3 amendment, Policy A APPLY)

**Convergix** — `cgx-corrective-2026-05-04` APPLIED clean at 2026-05-04T23:08:57Z–23:09:13Z. 37 audit rows. Verify 59/59 PASS. 0 cascade-status + 2 cascade-duedate (Events Page L1) + 4 date-override (A.3 July Social start+end + B.3 2H wrapper start+end) + 0 delete-week-item.

### Pipeline arc
T1 GREEN → drafter dispatch → T2 AMENDMENT (Finding A cascade-on-completed-deadlines + Finding B 2H wrapper dates silently overwritten) → drafter amends → T2 v2 GREEN → 6 holdout panels → Panel 3 FAIL (C.3 dupe target absent + hidden A.4 gap on TI Social Post) → T3 AMENDMENT (3 operator decisions: D1=B retarget, D2=add 5th L2, D3=skip-list TI Article) → drafter amends → T2 v3 GREEN → Panel 3 v3 PASS → Policy A APPLY (data-tp self-execute) + verify exit 0. Other 5 panels held from v2 holdout (1×WARN, 1×WARN, 3×PASS).

### What landed (37 audit rows on `cgx-corrective-2026-05-04`)

**Cluster A (19 rows)** — 6 L1 dueDate reconciliation (Big Win, Corp Collateral, Events Page, Fanuc, Rockwell PN, New Capacity → align with endDate) + 2 L1 category fixes (Big Win→active, April Social→completed) + 4 L1 backfills (July Social start+end via overrideProjectDate, Source Magazine dueDate, 1H wrapper resources AM:Kathy prefix) + 5 L2 endDate backfills (Certifications Page, Fanuc Pre-Event, Rockwell Image Swap, Rockwell Social Post, **+TI Award Social Post per T3 D2**) + 1 L1 waitingOn (CDS "Bob Bove"→"Bob") + 2 cascade-duedate (Events Page A.1 cascading to deadline-category L2s `e896` Staging + `9e43` AISTech).

**Cluster B (4 rows)** — addProject **2H Convergix Retainer** (`6076f0311cda4d51809dfeff2`, retainer wrapper, 8/1/26–1/31/27) + linkWeekItemToProject (re-parented orphan L2 `1859637a...` "2H Convergix Retainer Renewal" 5/25 from 1H to 2H) + 2× overrideProjectDate (B.3: 2H startDate=8/1, endDate=1/31 — restores envelope after B.2's silent recompute overwrite).

**Cluster C (13 rows)** — L1 rename (Source Magazine → "AUTOMATE 2026 Program Deliverables") + L1 notes append (New Capacity SOW URL) + **L2 retarget per T3 D1** (`a188...` retitled to "Rockwell Co-Marketing — Team Meeting (Next Steps)" — NOT deleted; preserves 5/5 Rockwell-meeting representation under Rockwell Co-Marketing L1) + 8 week-field-changes (brochure + one-pager 5/11→5/15 × 4 fields each) + 2 createWeekItem (CDS Creative Wrapper Revisions Due 5/6 + Big Win PPT Revisions Send-Back 5/8).

### NEW patterns / skill v4 candidates this session

1. **Skill v4 #28 (NEW)** — `l1-due-end-mismatch` rule should soften when the L1 has external-deadline marker. Two L1s in this session: AUTOMATE Booth Design (dueDate=show date 6/22, endDate=print drop-dead 5/18) and TI Article (dueDate=/news post 5/1, endDate=hero image 5/8). Brief skip-list now cites both. Detector should ignore `l1-due-end-mismatch` when notes/title indicate external deadline.

2. **Skill v4 #29 (NEW)** — `cascade-duedate` writes ONLY the legacy `date` column on cascaded L2s, NOT `startDate`/`endDate`/`dayOfWeek`. Result: post-cascade L2s can be internally inconsistent (Events Page Staging L2 `e896...` now has date=2026-05-06 but startDate/endDate=2026-04-30 + dayOfWeek=thursday stale). Accepted out-of-scope this batch (completed L2s, low-impact). Code follow-up candidate: either sync the related fields in cascade OR skip cascade for completed L2s.

3. **Skill v4 #30 (NEW)** — `updateWeekItemField` lookup is fuzzy `weekOf+title`, NOT id. Title is also UPDATEABLE via this helper. So forward batches that change a stateful lookup key (title) MUST pair the REVERT lookup-key shift — REVERT looks up by the NEW post-forward title, not the original. Drafter implemented correctly via `REVERT_C3_NEW_TITLE_AT_REVERT_TIME` constant. Pattern: any forward op that touches a lookup key (title, weekOf, name) requires REVERT to consume post-forward state for the lookup.

4. **Pattern: Title-flip for re-target alternative to delete** (T3 D1) — when a brief proposes deleteWeekItem on a row that turns out to lack a real dupe target, retitle + keep parent as-is preserves the underlying meeting representation. Better than physical delete + re-create. Operator picked this over delete or repoint to different L1.

5. **Pattern: Hidden completeness gap via `get_week_items_by_project` filter quirk** — drafter initially missed Events Page deadline L2s because that MCP tool filters non-completed by default. Use `get_week_items_range` with explicit category filter when validating cascade fanout. (Helper-quirk #2 logged in MEMORY.md candidate list.)

6. **Pattern: Retainer wrapper recompute side-effect on link-with-no-children** — `linkWeekItemToProject` on a wrapper with no L1 children silently recomputes startDate/endDate from the linked L2's date (retainer-wrapper guard requires L1 children to fire). Mitigation: post-link override step (B.3 = 2× overrideProjectDate) restores intended envelope. contractStart/contractEnd not affected by recompute.

### Snapshot state on disk
- Triplet (worktree `agent-a0d44b26`, branch `runway-cgx-corrective-2026-05-04`):
  - `scripts/runway-migrations/cgx-corrective-2026-05-04.ts` (forward, 32.9KB)
  - `scripts/runway-migrations/cgx-corrective-2026-05-04-verify.ts` (verify, 20.2KB, 59 assertions)
  - `scripts/runway-migrations/cgx-corrective-2026-05-04-REVERT.ts` (REVERT, 18KB, updatedBy bumped to `...-revert`, REVERT_C3_NEW_TITLE_AT_REVERT_TIME captures post-forward title for lookup)
- Closing snapshot: `docs/tmp/data/cgx-snapshot-2026-05-04.json`
- Plan v2: `docs/tmp/data/cgx-corrective-plan-2026-05-04.md`
- Brief: `docs/tmp/data/evaluator-cgx-corrective-2026-05-04.md`
- Verdicts: `docs/tmp/data/evaluator-cgx-{t1,t2,t2v2,t3}-verdict-2026-05-04.md`
- Worktree disposal queued (operator gate)

### Open carry-forward
- **Skill v4 #28 + #29 + #30 candidates** — to land in next data-integrity-tp skill update
- **Code follow-ups**: (a) cascade-duedate sync startDate/endDate/dayOfWeek OR skip-on-completed; (b) updateProjectField startDate/endDate routing — currently rejected by whitelist, requires `overrideProjectDate`
- **Operational follow-ups**: Social Content May/June dueDate=null (Panel 1 WARN, intentional out-of-scope); Corp Collateral waitingOn empty-string normalization (Panel 1 WARN minor drift)

---

## Session 2026-05-04 close (BP restructure ✓ — Cluster A only; Cluster B blocked at operator gate on unsigned SOWs)

**Beyond Petrochemicals** — `bp-restructure-2026-05-04` APPLIED clean at 2026-05-04T14:05:12Z–14:05:18Z. 6 audit rows (1 new-item + 5 field-change). Verify 37/37 PASS. 0 cascade-date-change + 0 cascade-status-change rows. **Second amendment-flow APPLY under policy A** (after AG1 corrective set the pattern): operator gate at panel 4 surfaced 2 real decisions (Q5 contractStart semantic + Q6 wrapper resources) — operator answered with **scope contraction** (drop Cluster B entirely, SOWs not actually signed) rather than spec amendment alone.

**Batch ledger (this session):**

| Batch | Audit | What it addressed |
|---|---|---|
| `bp-restructure-2026-05-04` | 6 | Wrapper L1 "1H Beyond Petro Retainer" created (id `7e8d35a3a0634854836ba4356`, contractStart=2026-01-01, contractEnd=2026-06-30, override-equivalent startDate/endDate, resources="AM: Kathy") + 5 retainer-scope children re-parented (Organic Social + Playbook, BP.org maintenance, spilltracker.org maintenance, Fact Sheets, Email Templates + Playbook). |

**Out-of-batch context (kathy-direct on bp-baseline-2026-05-04 batch):**
- 12:27Z–12:29Z: 9 resources fields backfilled to "AM: Kathy" + 15 retainer-scope contract/engagement fields backfilled (5 children × 3 fields).
- 13:19Z: New L2 "Web traffic overview — BPC + Take Step One (Mar 1 – May 1)" added under BP.org maintenance (owner Leslie, single-day Mon 5/4, in-progress, source: Alyse Rooks request Fri 5/1, Jill assigned Leslie). Cascade gave BP.org maintenance startDate=endDate=2026-05-04. Wrapper restructure's parentProjectId set was silent w.r.t. dates (Panel 6 verified, APPLY confirmed) — wrapper override held.

**Outcomes:**
- Wrapper "1H Beyond Petro Retainer" (`7e8d35a3a0634854836ba4356`): in-production / active / engagementType=retainer / owner=Kathy / resources="AM: Kathy" / startDate=endDate=contract-window 2026-01-01–2026-06-30 / parentProjectId=null.
- 5 retainer children (Organic Social, BP.org, spilltracker.org, Fact Sheets, Email Templates): parentProjectId=wrapperId. engagementType=retainer + contractStart=2026-01-01 + contractEnd=2026-06-30 retained from baseline (15 idempotent no-ops at APPLY-time per drafter spec resolution).
- BP.org maintenance carries startDate=endDate=2026-05-04 from cascade (out-of-batch). Visible exception to "children have null dates" — does not break wrapper override.
- 4 untouched top-level L1s: Plastic Additives LinkedIn Post, Strategic Initiatives, Hopkins Research, Know Your Neighbor (all per brief out-of-scope).
- 4 pipeline rows untouched: ITEP, SpillTracker Redesign, Clipping Campaign (Plastic Detox), Ammonia Landing Page. **All four SOWs unsigned** per operator correction (brief was wrong about SpillTracker + Ammonia being signed).

**NEW pattern locked-in (cohort drift table):**

| Drift category | Hop | TAP | Sou | Cgx | AG1 | BP | Patch state |
|---|---|---|---|---|---|---|---|
| Idempotent overlap with prior batch on retainer children (engagementType + contracts pre-set by direct-MCP baseline) | n | n | n | n | n | y (15-of-15 no-op) | NEW pattern. Drafter spec resolution: APPLY skips 15 idempotent writes; DRY_RUN logs them for visibility. Verified at `operations-writes-project.ts:217-226`: idempotency key includes `updatedBy`, NOT value-equality. Future cross-batch overlap analysis must account. Track for 2-of-N. |
| Operator scope contraction at gate (drop entire cluster vs amend triplet) | n | n | n | n | n (AG1 amended in scope) | y (Cluster B dropped) | NEW pattern. Drop pattern preserves audit cleanliness when scope assumption invalidated post-spec. Track for 2-of-N. |

**Wrapper-date recompute concern — RESOLVED (false positive):**

Panel 5 raised concern that `setProjectParent` on children might trigger `recomputeProjectDates` on the wrapper, nulling out explicit wrapper dates. Refuted by Panel 6: `updateProjectField({field: "parentProjectId"})` does not invoke date-recompute path (only `dueDate` writes cascade to L2 deadline rows). Verified at APPLY: 0 cascade-date-change rows in batch; wrapper.startDate=2026-01-01 + wrapper.endDate=2026-06-30 persisted. Future TPs can rely on this: project-to-project parent moves are silent w.r.t. date columns. Documenting for posterity.

**Operator policy A escalation path validated (round 2):**

- Triage doc surfaced 2 real decisions (Q5 + Q6) + 2 cleanup nits.
- Operator answered Q5 with **stronger move than menu** (drop Cluster B entirely vs Option A/B on contractStart semantic). Pattern repeats: operator override of TP option menu when context warrants.
- Q6 = Option A confirmed (wrapper resources="AM: Kathy").
- Drafter re-dispatch (in-place edit at existing worktree) → DRY_RUN green (21 lines / 6 audit rows) → evaluator targeted T2 GREEN (delta-only review, fast) → operator policy A self-execute authorization → data-tp APPLY.

**Skill-patch candidate (defer to v4 review):**

`updateProjectField` idempotency keys on `(type, projectId, field, idemNewValue, updatedBy)` per `operations-writes-project.ts:217-226`. NOT value-equality. Helper does NOT short-circuit identical-value writes when `updatedBy` differs. Future cross-batch overlap analysis must account: a fresh `updatedBy` re-writing same value emits a "value → value" audit row. Drafters should either skip-at-APPLY (this batch's pattern) or live with audit noise. Document in skill v4 #27 candidate.

**Snapshot state on disk:**
- `docs/tmp/data/bp-snapshot-2026-05-04.json` — post-APPLY closing snapshot (wrapper + 5 children + 4 untouched + 1 cascade-derived L2 + 4 pipeline rows + audit summary).
- `docs/tmp/data/bp-cleanup-brief-2026-05-04.md` — operator-authored brief (evaluator pre-baseline).
- `docs/tmp/data/bp-restructure-plan-2026-05-04.md` — TP plan (in worktree `agent-a786efa5`).
- `docs/tmp/data/signals/bp-restructure-triage-2026-05-04.md` — 6-panel triage with Q5+Q6 surface.
- `docs/tmp/data/evaluator-bp-gate-2026-05-04.md` + `evaluator-bp-gate-update-2026-05-04.md` + `evaluator-bp-t2-2026-05-04.md` + `evaluator-bp-t2-amended-2026-05-04.md` — evaluator gate + T2 docs.
- 3 triplet files at `scripts/runway-migrations/bp-restructure-2026-05-04{,-verify,-REVERT}.ts` in worktree `agent-a786efa5` on branch `worktree-agent-a786efa5` from `upstream/runway`. **Awaiting worktree disposal decision** (operator gate; agent-a30566d3 + agent-a75ccabd + agent-a786efa5 all pending).

**Process validation — second amendment cycle:**

- Holdout caught operator-gate-worthy items pre-APPLY (Panel 4 — Q5 + Q6) plus a false-positive that needed cross-panel triage (Panel 5 wrapper-recompute, refuted by Panel 6).
- Cross-panel disagreement is a feature, not a bug — Panel 5's concern surfaced from comment scan; Panel 6's deeper code read settled it. Both readings are valuable.
- Operator scope contraction (drop Cluster B) at gate preserved pattern: TP recco is starting point, not constraint. Operator can move the goalposts.
- Targeted T2 on delta + skipped re-running 5 prod-state panels (delta narrow + structurally simpler than original spec) — same pattern as AG1 corrective, ~15-min savings, no integrity loss.
- Drafter in-place edit (vs fresh re-dispatch with new worktree) worked — same drafter agent (a7181b41df34c424f) preserved triplet structure + applied 3 amendment classes (resources add, B-cluster removal, header/import cleanup).

## Session 2026-05-03 close (AG1 corrective ✓ — first amendment-flow APPLY under policy A)

**AG1** — `ag1-corrective-2026-05-03` APPLIED clean. 12 audit rows. Verify 37/37 PASS. **First operator-gate-triggered amendment** under policy A: holdout panel 1 surfaced spec gap (W7 — pipeline `waitingOn` stale post-signed); operator escalation path validated end-to-end (data-tp paused APPLY → triage doc → operator answered Q1=DELETE pipeline outright → spec amended → drafter re-dispatched → T2 re-cross-check on delta → APPLY).

**Batch ledger (this session, cumulative):**

| Batch | Audit | What it addressed |
|---|---|---|
| `ag1-batch-2026-05-03` | 5 | Hugh terminal pair + CW: Kathy backfill + L2 endDate extend with at-risk slip semantic. (Closed earlier today; section below.) |
| `ag1-corrective-2026-05-03` | 12 | Wrapper Q4 reversal (contractStart/End backfilled 4/17–5/17 — trial IS the contract); 2 new L2s (Mon 5/4 kickoff + Tue–Fri 5/5–5/8 production); owner sweep Allison → Jill (Hugh L1, AG1 PRO L1, Concept WU L2); resources flip (add Strat: Allison + AM: Jill); Concept WU L2 reverted to standard convention (date == endDate = 4/30, status = completed); pipeline 4d5dae5d DELETED (operator: trial signed, no current SOW drafting, "get it off the board"). |

**Outcomes:**
- Wrapper Social Content Trial (6aba8121): contractStart=4/17, contractEnd=5/17. Override startDate/endDate 4/17–5/17 holds. Resources unchanged from prior session ("AM: Jill, Strat: Allison, CD: Lane, CW: Kathy, CM: Sami").
- Hugh Content L1 (4fa094fb): owner=Jill, resources="AM: Jill, Strat: Allison, CM: Sami, CD: Lane, CW: Kathy". Terminal pair preserved.
- AG1 PRO Content L1 (92708ffc): owner=Jill, resources="AM: Jill, Strat: Allison, CM: Sami, CD: Lane, CW: Kathy". endDate=5/8 (cascade-derived through op 10 — stable max-of-children).
- Concept WU L2 (21d089ec): owner=Jill, endDate=4/30 (REVERTED to standard convention from NEW pattern), status=completed. NEW deliverable-target/work-envelope pattern was operator-temporary; reverted with completion semantic.
- New L2 #1 (568d7486): "Concept Feedback Review + Batch 2 Kickoff" — Mon 5/4 single-day, owner=Jill, resources="AM: Jill", category=kickoff, status=scheduled.
- New L2 #2 (e7f5b3f0): "Production — Selected Concepts" — Tue–Fri 5/5–5/8 multi-day (date=endDate=5/8), owner=Jill, resources="CD: Lane, CM: Sami", category=delivery, status=scheduled.
- Pipeline 4d5dae5d (Social Content Trial $30K): DELETED. Wrapper L1 + child L1s carry deal context now.

**Operator policy A escalation path validated:**
- Triage doc surfaced 3 decisions (Q1: pipeline waitingOn stale; Q2: resources order mismatch; Q3: drafter notes phrasing).
- Operator answered Q1 with stronger option than menu (DELETE vs A/B/C clear/forward-looking/skip). Pattern: operator can override TP options when context warrants.
- Q2 = accept role-set divergence (no action). Wrapper resources order differs from child L1 order; cohort sweep #6 enforces role-set, not exact-string.
- Q3 = accept-as-is (drafter prose for new L2 + pipeline notes defensible from intent).
- Spec amended on disk by operator (Op 12 single delete; 12 ops total). Data-tp re-dispatched drafter for triplet amendment, evaluator did targeted T2 on delta only (skipped re-running 5 prod-state holdout — W7 resolved structurally, ops 1-11 unchanged).

**NEW pattern locked-in (cohort drift table):**

| Drift category | Hop | TAP | Sou | Cgx | AG1 | Patch state |
|---|---|---|---|---|---|---|
| Multi-day L2 with deliverable-target / work-envelope split (`date != endDate` + `status=at-risk`) | n | n | n | n | y → **REVERTED** | Pattern was ephemeral; reverted to standard convention. Track if recurs on next-cohort client. |
| Pipeline deletion when trial signed + no current SOW drafting | n | n | n | n (e9350d02 was duplicate dispose) | y | 1-of-1 deliberate disposal pattern. Precedent: cluster-1 cleanup style + no-followup post-signed semantics. Track for 2-of-N. |

**Pipeline createPipelineItem id-loss flag (drafter-surfaced):**

`createPipelineItem` at `operations-writes-pipeline.ts` L38–104 hardcodes `generateId()` at L77 — no override parameter. REVERT (if ever invoked) would mint a new pipeline id, losing original `4d5dae5dccc948b49912832bb`. Verify-REVERT would need composite match (shortId or name+estimatedValue), not exact id. **No REVERT planned for this batch** — flag is for posterity / future REVERT scripts touching pipeline. Surface as v4 patch consideration if this becomes load-bearing.

**Snapshot state on disk:**
- `docs/tmp/data/ag1-snapshot-2026-05-03-corrective-final.json` — post-corrective-APPLY closing snapshot (supersedes the earlier `ag1-snapshot-2026-05-03-final.json`).
- `docs/tmp/data/ag1-snapshot-2026-05-03-final.json` — kept as mid-session reference (between batch-1 close and corrective open).
- `docs/tmp/data/ag1-corrective-spec-2026-05-03.md` — operator-amended spec (Op 12 = DELETE, 12 ops total, REVERT section updated with hardcoded pre-state).
- `docs/tmp/data/signals/ag1-corrective-t2-trigger-2026-05-03.md` — original T2 trigger (13-op pre-amendment).
- `docs/tmp/data/signals/ag1-corrective-triage-2026-05-03.md` — operator gate triage doc with Q1–Q3.
- `docs/tmp/data/signals/ag1-corrective-t2-amended-trigger-2026-05-03.md` — re-T2 trigger after operator answered + drafter amended (12-op delta).
- `docs/tmp/data/signals/ag1-corrective-verify-clean-2026-05-03.md` — post-APPLY audit log + verify outcome.
- 3 triplet files at `scripts/runway-migrations/ag1-corrective-2026-05-03{,-verify,-REVERT}.ts` in worktree `agent-a75ccabd` on branch `ag1-corrective-2026-05-03` from `upstream/runway`. **Awaiting worktree disposal decision** (operator gate; `agent-a30566d3` from earlier batch also pending).

**Process validation — amendment flow:**
- Holdout panels caught a real spec gap (Panel 1 W7) that code-correctness QA could not have surfaced (semantic post-state inconsistency).
- Policy A escalation rule (W7 = operator-actionable spec gap → pause APPLY → operator gate) worked as designed. Single funnel preserved: operator only saw the Q1–Q3 decision card, not raw panel output.
- Operator override of TP option menu (Q1=DELETE, not A/B/C) shows decision-then-ask pattern works — TP recco is a starting point, not a constraint.
- Targeted T2 on delta + skipped re-running 5 prod-state panels saved ~15-20 min of agent dispatch overhead with no integrity loss (delta surface narrow + structurally resolved + ops 1-11 unchanged).

## Session 2026-05-03 close (AG1 ✓ — first APPLY under policy A)

**AG1** — `ag1-batch-2026-05-03` APPLIED clean. 5 audit rows. Verify 12/12 PASS. Wrapper untouched. Skill v4 #25 not triggered. **First APPLY under operator policy A** (data-tp self-executes after T2 GREEN + 6/6 holdout PASS — no operator courier step). Self-execute path validated end-to-end.

**Batch ledger:**

| Batch | Audit | What it addressed |
|---|---|---|
| `ag1-batch-2026-05-03` | 5 | Hugh Content category active → completed (terminal pair) + CW: Kathy backfill on both child L1 resources + L2 endDate extend 4/30 → 5/8 + L2 status → at-risk (slip surface). Cascade-derived L1 endDate to 5/8 (silent, no audit row — see #26 skill candidate below). |

**Outcomes:**
- Hugh Content (4fa094fb) terminal pair locked: status=completed + category=completed.
- AG1 PRO Content (92708ffc) endDate 4/30 → 5/8 via cascade. Resources +CW: Kathy. Path A (extend, not terminate).
- L2 AG1 Pro Concept Writeups (21d089ec) endDate=5/8, status=at-risk. **date stays 4/30 (deliverable target preserved).**
- Wrapper Social Content Trial (6aba8121) untouched. Override-anchored 4/17–5/17 holds. contractStart/End stays null per Q4 (verbal-trial pending formal $30K SOW).

**Operator-locked deferrals:**
- Wrapper contractStart/End: hold null until formal $30K SOW signs (cohort patch — Contract dates anchor on SOW Term window; verbal trial has no SOW Term yet).
- Skill v4 #26 landing pace: separate review session decision pending.

**NEW skill v4 patch candidate #26 (HIGH severity — audit-integrity):**

`recomputeProjectDatesWith` should emit a `cascade-date-change` audit row when parent dates shift. Currently raw-UPDATEs `projects.start_date / end_date` with no audit emission. Codebase exposes only `cascade-status` and `cascade-duedate` cascade types. Caught during AG1 drafter dispatch on `upstream/runway` code rails. **Cohort signal:** 1-of-1 NEW. Below 2-of-N threshold but high standalone audit-integrity value. Surface for operator landing-pace decision. Full text: `docs/data-tp/skill-patches/v4-candidates-2026-05-03-postdrafter.md`.

**Plus 2 corrections to existing v4 candidates:**
- #20 framing: gap is at MCP wrapper layer, NOT helper level. `category` IS in `PROJECT_FIELDS` (`operations-utils.ts` L323). Helper-only triplet authors can write category directly.
- Helper-name accuracy: `updateWeekItem` → `updateWeekItemField` (resolves by `weekOf + weekItemTitle`). Grep `data-conventions.md` + `drafter-prompt.md` for stale references.

**NEW cohort drift category — track for next-cohort patch trigger:**

| Drift category | Hop | TAP | Sou | Cgx | AG1 | Patch state |
|---|---|---|---|---|---|---|
| Multi-day L2 with deliverable-target / work-envelope split (`date != endDate` + `status=at-risk` semantics) | n | n | n | n | y (1 row) | **NEW 1-of-5 — track for 2-of-N threshold; covered by skill v4 #23 family but distinct semantic case** |

Standard cohort multi-day is `date == endDate, startDate=work begin`. AG1 establishes the **deliverable-target/work-envelope split** pattern: `date` preserves originally promised target, `endDate` reflects actual close, `status=at-risk` surfaces slip. If pattern recurs on next-cohort client → patch candidate.

**Snapshot state on disk:**
- `docs/tmp/data/ag1-snapshot-2026-05-03-final.json` — post-APPLY closing snapshot (will NOT be overwritten — AG1 close artifact).
- `docs/tmp/data/ag1-snapshot-2026-05-02.json` — pre-batch hydration (kept for diff reference).
- `docs/tmp/data/ag1-spec-2026-05-03.md` — corrected spec (post-drafter audit-row math + helper-name fix + § Code-reality discovery).
- `docs/tmp/data/signals/ag1-plan-2026-05-02.md` — original plan that yielded Q1–Q8 operator decisions.
- `docs/tmp/data/signals/ag1-evaluator-verdict-2026-05-03.md` — T1 spec verdict + Q1–Q8 lock-in.
- `docs/tmp/data/signals/ag1-spec-verdict-t1-2026-05-03.md` — T1 GREEN spec.
- `docs/tmp/data/signals/ag1-evaluator-verdict-t2-2026-05-03.md` — T2 GREEN triplet.
- `docs/tmp/data/signals/ag1-holdout-summary-2026-05-03.md` — 6/6 panel PASS report.
- `docs/tmp/data/signals/ag1-apply-gate-2026-05-03.md` — APPLY-gate command + env preconditions.
- `docs/tmp/data/signals/ag1-apply-authorization-2026-05-03.md` — operator policy A authorization (FIRST under new pattern).
- `docs/tmp/data/signals/ag1-verify-clean-2026-05-03.md` — post-APPLY audit log + verify outcome.
- `docs/data-tp/skill-patches/v4-candidates-2026-05-03-postdrafter.md` — #26 + #20 clarification + helper-name fix.
- 3 triplet files at `scripts/runway-migrations/ag1-batch-2026-05-03{,-verify,-REVERT}.ts` in worktree `agent-a30566d3` on branch `ag1-batch-2026-05-03` from `upstream/runway`. **Awaiting worktree disposal decision** (operator gate).

**Process validation — file-handoff + signal-polling pattern:**
- 6 signal files cycled. Operator-side touchpoints: 3 (initial brief, T1 verdict, T2/holdout/policy-A authorization) — vs prior protocol's 7+ for similar batch scope.
- TP polling cycle: ScheduleWakeup at 90s/240s/1200s based on stage. Cache-aware delays kept the loop efficient.
- No friction surfaced. Pattern works. Recommend extending to next cohort.

## Session 2026-05-02 close (Convergix ✓ — cohort COMPLETE)

**Convergix** — 3 sequential batches APPLIED + verified clean today. 169 total audit rows touched. Wrapper guard intact across all 3 batches. Cohort (Hop / TAP / Sou / Cgx) closed; queue empty.

**Batch ledger:**

| Batch | Audit | What it addressed |
|---|---|---|
| `convergix-cards-2026-05-01` | 114 | Card-by-card refresh — 6 orphan parents, R2-R4 dueDate cascade guards, single-day endDate pairs, dayOfWeek calendar fixes (D2/D3) |
| `convergix-status-sweep-2026-05-02` | 30 + 1 fix | CAT 2 past-dated non-terminal status. Cert Page → completed (Card 1 precedent), Rockwell endDate=5/16 (Card 2 + post-recompute fix override), Social May endDate=5/29 (Card 3), 6 L2 multi-field rewrites |
| `convergix-convention-sweep-2026-05-02` | 24 | CAT 1 multi-day shape (8 rows), CAT 4 single-day endDate=null fills (5 rows), 2 notes dedupes (CDS R2 sentence + New Capacity Daniel-blocker) |

**Outcomes:**
- 6 prior orphans parented (cards C1-C6).
- All 6 multi-day CDS L2s reshaped to range convention (date==endDate=5/14, startDate=work begin).
- New Capacity PPT Complete (063b7c31) reshaped from multi-day to single-day milestone (date=startDate=endDate=5/8) per operator decision in convention sweep.
- 5 single-day endDate=null rows closed (Fanuc Social, 2H Renewal, Brochure, One-Pager, Jamie Nelson).
- CDS R2 Presentation (0754e95a) marked completed; Kathy presented 5/1.
- Cert Page (68a4ee37) terminal-closed at endDate=2026-04-30 (cert delivery + 1-week wrap landed).
- 3 historical NULL-parent L1s confirmed leave-as-is, operator-locked: Life Sciences Brochure (4b5bf2f0), Social Media Templates (c568d7a6), Organic Social Playbook (7c8478dc).

**Operator-locked deferrals (decisions and historical drift, NOT data integrity gaps):**
- AISTech 9e432ae4 notes "Risk: must be live by ???" placeholder (pre-existing import drift)
- Big Win Template — Social Announcement Companion notes drop
- AUTOMATE 272e7eef dueDate=2026-06-22 (vendor show date) vs deadline-L2 df90794b 2026-05-18 (drop-dead for printer) — semantic intent split, needs operator decision on data model
- Events Page 135c5a61 (completed L1) dueDate=2026-04-24 vs deadline children 2026-04-30 + 2026-05-06 (historical, no operational impact)
- 6 terminal-row endDate=null rows: Fanuc Pre-Event, Rockwell Image Swap, Rockwell Social Post, TI Award Social Post, Cert Page Daniel Follow-Up, May Calendar Draft
- 4 pre-existing L1 startDate drift items (Fanuc Article 3d5215f4, Rockwell Co-Marketing 1923fc1a, TI Article c0935359, AUTOMATE 272e7eef) — Cascade Integrity panel surfaced; investigate when Convergix returns to active sweep
- L2 66414d4d May Calendar Draft startDate=4/27 vs date=4/28 mismatch — closing endDate write would risk clobbering b452f647 endDate=5/29 override; deferred from convention sweep, needs paired override

**Skill v4 patch candidates queued (per-batch evidence — review at end of cohort close):**

| # | Pattern | Evidence today |
|---|---|---|
| 20 | `category` not in `PROJECT_FIELDS` MCP whitelist | Forced cards + convention batches into triplet path; recurring constraint across the day |
| 22 | status flip kickoff→in-progress should auto-flip cat kickoff→delivery (or warn) | Ergonomic gap — caught manually on every transition |
| 23 | Multi-day work-window vs single-day milestone decision pattern | Drafter prompt clarification — drafter flagged CAT 1 startDate "ambiguity" that was convention-correct (operator decided per-row); CAT 1-8 New Capacity PPT Complete required operator-led shape pivot |
| 24 | dayOfWeek/date calendar verification at spec-time | Caught D2/D3 in cards batch + Card 4 in status sweep + CAT 1-8 in convention sweep — pattern, not one-off |
| 25 | **CRITICAL** — parent date override clobbered by child-triggered recompute | Caught 3rd time today (Rockwell endDate post-Card-4 child writes recomputed parent down to 5/5; required fix-override batch). Skill rule needed: parent overrides write AFTER all child writes in same batch, OR helper sticky-override flag pinning past child-triggered recompute. |

Plus three secondary patches surfaced for landing:
- Mandatory cascade guard on every dueDate write (cards batch R2/R3/R4 pattern; Round 4 added 9 guards retroactively).
- Drafter checklist: single-day L2 needs paired endDate write (B9/E1 + CAT 4 pattern).
- Notes replace-vs-append discipline (A8 R2 sentence dup root cause).

**Cohort table at Convergix close (full 4-client matrix):**

| Drift category | Hop | TAP | Sou | Cgx | Patch state |
|---|---|---|---|---|---|
| Date conventions | y | y | y | y | PATCHED 4/30 ✓ Sou + Cgx validation passed |
| L1 dueDate=null hard-deadlined | y | y | y | n/a | PATCHED 4/30 ✓ |
| Past-dated non-terminal status | n | n | n | y (6 rows) | **NEW 1-of-4 BUT volume-driven — promote to enforced sweep #8 candidate** |
| Resources missing role prefix entirely | y | n | n | n | 1-of-4 |
| Stale single-day shape on active range | n | y | n | y (5 rows) | 2-of-4 (TAP + Cgx); CAT 4 sweep enforced; Cgx validation pass |
| Wrapper-or-project structural / missing wrapper | y | n | y | n (intact 2/1-7/31) | PATCHED 5/1 (sweep #7) |
| Status/category mismatch | n | n | y | n | 1-of-4 |
| Resources peer-alignment gap | n/a | y | y | n | PATCHED 5/1 (enforced #6) |
| Category semantic drift | n/a | y | n | n | 1-of-3 (still tracked) |
| contractStart/End null on signed | n/a | y | y | n (wrapper anchored 2/1-7/31) | PATCHED 5/1 |
| Multi-day shape: date==endDate vs date==startDate | n | n | n | y (8 rows reshape) | **NEW 1-of-4 — covered by skill v4 #23; queue review** |
| Notes append-style dedupe drift | n | n | n | y (2 rows) | **NEW 1-of-4 — covered by "notes replace-vs-append" patch; queue review** |
| Parent date override clobbered by child-triggered recompute | n | n | n | y (3× today) | **NEW CRITICAL — skill v4 #25 (no skill text yet)** |

**Threshold guidance:** Past-dated non-terminal status hit only Cgx (1-of-4) but volume (6 rows + dedicated batch) warrants enforced sweep promotion regardless. CAT 1 / CAT 4 / notes-dedupe did not trigger 2-of-4 patch-now thresholds; documented in skill v4 candidates for review session.

**Snapshot state on disk:**
- `docs/tmp/data/convergix-snapshot-2026-05-02-final.json` — post-3-batch-APPLY closing snapshot, will NOT be overwritten (Cgx is cohort tail)
- `docs/tmp/data/convergix-handoff-2026-05-02.md` — same-day Convergix-specific resume doc (3 batches detailed, open items + skill v4 candidates + post-compaction checklist)
- `docs/tmp/data/convergix-snapshot-2026-05-01-r2.json` — pre-cards R2 hydration
- `docs/tmp/data/convergix-snapshot-2026-05-01-post-apply.json` — post-cards
- `docs/tmp/data/convergix-snapshot-2026-05-02-post-status-sweep.json` — post-CAT-2
- `docs/tmp/data/convergix-batch-audit-2026-05-01.json` — 114 audit rows from cards batch
- `docs/tmp/data/convergix-spec-2026-05-01.md` — cards batch spec
- `docs/tmp/data/convergix-status-sweep-2026-05-02-spec.md` — CAT 2 batch spec
- `docs/tmp/data/convergix-convention-sweep-2026-05-02-spec.md` — convention sweep spec
- 9 triplet files in `scripts/runway-migrations/convergix-*.ts` (forward + verify + REVERT × 3 batches)

## Session 2026-05-01 close (Soundly ✓ → Convergix next)

**Soundly** — `soundly-cards-2026-04-30` (113 ops). All ok. Verify 11/11 PASS. 113 audit rows, 0 cascade collateral. Sweep no-op (7 categories scanned post-patch — only deferred-by-design iFrame Evening Launch L2 surfaces, not a new corrective batch). Outcomes:
- **NEW Retainer wrapper L1** "Soundly Website Retainer" created (engagementType=retainer, parentProjectId=null, 0 children — pure relationship marker for the $41,600/yr retainer).
- 3 existing L1s contract-dated per individual SOWs: iFrame + PG joint SOW Term 3/1–5/31; AARP SOW Term 3/1–7/15. dueDates anchored: iFrame=4/22 launch, PG=5/31 SOW close, AARP=7/15 launch.
- iFrame L1 status/category aligned (active→completed) + notes refreshed (drop "Jill confirm" — not in audit).
- 9 orphan L2s (bot-create burst 4/29) rebucketed to AARP L1 with deck-correct dates from AARP schedule deck. 2 AARP Feedback rows disambiguated as Round 1 + Round 2.
- 2 NEW L2s on AARP: "Sprint 1 — API + CMS & DB Updates" (4/15–4/29 completed); "Soundly Review/Feedback (Round 2)" (4/30–5/6 in-progress).
- Pipeline e9350d02 (AARP $31,400 duplicate) deleted.
- PG L2 8ef611c4 convention fix (date=endDate=5/31, dayOfWeek=sunday, weekOf=5/25, resources peer-aligned).

**4 skill patches landed at Soundly close** (`~/.claude/skills/data-integrity-tp/data-conventions.md`):
1. **Mechanical sweep #6 PROMOTED** — "Resources peer-alignment gap" promoted from tracked-class to enforced sweep category. Trigger: 2-of-3 cohort hits (TAP + Soundly).
2. **NEW sweep category #7** — "Missing retainer wrapper L1 when client carries a retainer." Trigger: 2-of-3 (Hopdoddy added late + Soundly missing entirely). Convergix already has wrapper. Cross-client check pending Beyond Petro et al.
3. **NEW § Contract dates and contractValue** — "Contract dates anchor on SOW Term window, NOT Effective Date." Examples: TAP, AARP, joint Soundly SOW. Paperwork-effective lag is normal; project-start lag is not.
4. **Same § (Patch 4)** — `client.contractValue` scope rules: retainer ARR for retainer-clients with outside-retainer SOWs (Soundly = $41,600 even though $103K total booked); SOW total for project-only clients (LPPC, TAP precedent). `client.contractTerm` follows the same rule.

**Cohort table at Soundly close (3 cols filled — patches landed):**

| Drift category | Hop | TAP | Sou | Patch state |
|---|---|---|---|---|
| Date conventions | y | y | y | PATCHED 4/30 ✓ Soundly validation passed |
| L1 dueDate=null hard-deadlined | y | y | y | PATCHED 4/30 ✓ Soundly validation passed |
| Past-dated non-terminal status | n | n | n | 0-of-3 |
| Resources missing role prefix entirely | y | n | n | 1-of-3 |
| Stale single-day shape on active range | n | y | n | 1-of-3 |
| Wrapper-or-project structural / missing wrapper | y | n | y | **PATCHED 5/1 (new sweep #7)** |
| Status/category mismatch | n | n | y | 1-of-3 |
| Resources peer-alignment gap | n/a | y | y | **PATCHED 5/1 (promoted to enforced #6)** |
| Category semantic drift | n/a | y | n | 1-of-2 (still tracked) |
| contractStart/End null on signed | n/a | y | y | **PATCHED 5/1 (Contract date conventions § landed)** |

**Snapshot state on disk:** worktree's `docs/tmp/data/soundly-snapshot.json` (post-APPLY, 4 L1s + 13 L2s + 0 pipeline). Will be overwritten on next snapshot run for Convergix.

## Convergix prep (operator's one-pass strategy)

Convergix is the biggest arc remaining: 22 L1s + retainer wrapper + drift since 2026-04-26 cleanup. Operator wants this in **one pass**, not day-per-client like Hopdoddy/TAP.

**New pattern: operator pre-stages structured input upfront.** Replaces card-by-card pings.

At Convergix kickoff, operator hands over:
- Convergix Hot Sheet / Status Doc
- A per-L1 status table (active / done / deprecated / on-hold per L1, plus any drift operator already knows about — 22 rows of marks)
- Any recent Slack threads or stakeholder context

TP then:
- Snapshots Convergix
- Reconciles snapshot against operator's per-L1 marks
- Drafts the full corrective batch (one big triplet, not multiple)
- **Evaluator decides every 🟡 in-line.** TP only escalates genuine unknowns (new structural calls, real ambiguity).
- Standard pipeline: drafter → rails check → 6 holdout panels → APPLY direct → verify → re-snapshot → sweep (now 7 categories) → handoff update.

This mode is **"operator pre-aligns once, machine executes"** — different from Hopdoddy/TAP's "iterate to alignment."

### Convergix pre-flags from prior handoffs (verify on snapshot pull)

1. 🚩 **`86d94de276b94134bdd811ec5` "New Capacity ppt"** — landed via bot 2026-04-29 outside any data-tp session. status=`not-started`, owner=`null`, resources=`Freelance` (no role prefix), dueDate=2026-05-06, parentProjectId=`null` (NOT linked to retainer wrapper), notes=`null`. Almost certainly a duplicate of `0c208308` "New Capacity (PPT, brochure, one-pager)" already nested under retainer wrapper. Triage: confirm dup → delete 86d94de OR merge + parent-link to wrapper + role-tag resources.

2. 🟡 **Possible role-prefix violations on retainer wrapper children** — sweep category #3 candidate. Last cleaned through Cluster 3 on 2026-04-26; drift since unknown without snapshot.

3. 🟡 **Date-convention sweep candidates** — bare-name resources, stale notes referencing past dates, possible date-convention violations on L2s under wrapper children. Sweep category #1.

4. 🟡 **Convergix retainer wrapper exists** (per prior session: "Convergix already has wrapper. Wrapper id 4171aa4d."). New sweep category #7 (missing-wrapper) does NOT trigger for Convergix — but verify wrapper has correct contractStart/End/dueDate per now-landed Contract date conventions §.

5. 🟡 **Wrapper-guarded date trap** — Convergix wrapper has children, so `overrideProjectDate` on the wrapper requires `bypassGuard` flag if direct date overrides are needed. Children L1 dates auto-derive from L2s, but wrapper dates do NOT propagate up — same quirk as Soundly's new wrapper but inverted (Convergix wrapper has children).

### What to ask operator at Convergix kickoff (in this exact order)

1. **Hot Sheet / Status Doc / recent Jill+Kathy thread** — operator paste before any destructive proposal.
2. **Per-L1 status table** — 22 rows, operator's marks. This is the speed lever.
3. **Confirm "New Capacity ppt" disposition** — delete dup, or merge + parent-link.
4. **Confirm wrapper contract date semantics** (per now-landed Contract date conventions § — SOW Term not Effective).

### What to NOT touch

- Convergix retainer wrapper structure (already in shape).
- Anything explicitly marked completed/canceled in operator's per-L1 table.
- Anything outside the per-L1 table without operator explicit add.

## Session 2026-04-30 close (Hopdoddy ✓ + TAP ✓ → Soundly next)

Both Hopdoddy and TAP closed clean. Skill patches landed. Soundly is next; Convergix follows.

**Hopdoddy** — `hopdoddy-cards-1-2-2026-04-30` (15 ops). All ok. Verify 5/5 PASS. 15 audit rows, no cascade collateral. Sweep no-op (5 categories scanned, all clean). Outcomes: BR Refresh 5/19 launch + dueDate anchor; Digital Retainer wrapper backfilled (1/1–12/31 + standing team); new L1 "Brand Refresh Revisions" under wrapper for LOE-pending revisions.

**TAP** — `tap-cards-2026-04-30` (38 ops). All ok. Verify 10/10 PASS. 38 audit rows, no cascade rows (`triggeredByUpdateId=null` on all). Sweep no-op (5 categories scanned, all clean). Outcomes: ERP Rebuild SOW mirrored (3/1–11/30 contract + dueDate); 5 phase L2s convention-fixed (kickoff→delivery/launch, multi-day shape, weekOf math, resources peer-aligned to `PM: Jason, Dev: Tim`); 3 new L2s created (Discovery completed, Project Kickoff completed, Warranty 10/29–11/30 with `blockedBy=[Training]`); Deployment notes refreshed.

**Skill patches landed at TAP close** (`~/.claude/skills/data-integrity-tp/data-conventions.md`):
- New § **Mechanical sweep categories** (after Structural review) — 5 enumerated categories (date conventions, past-dated non-terminal status, resources missing role prefix, stale single-day shape, task-dependent role labels) + tracking-only emerging classes. Triggered by 2-of-2 cohort hits on date conventions.
- New § **L1 dueDate anchor** (after Categories) — explicit anchor rules (single-event launch, multi-phase + warranty, multi-phase no warranty). Triggered by 2-of-2 cohort hits on L1 dueDate=null on hard-deadlined projects.
- Cross-reference added in `row-by-row.md` § Verification at end pointing to the new sweep section.

**Cohort table at TAP close (Hopdoddy + TAP columns filled, watch for 2-of-3 on Soundly):**

| Drift category | Hopdoddy | TAP | Soundly | Patch state |
|---|---|---|---|---|
| Date conventions | yes | yes | _ | **PATCHED 2026-04-30** |
| L1 dueDate=null on hard-deadlined | yes | yes | _ | **PATCHED 2026-04-30** |
| Past-dated non-terminal status | no | no | _ | 0-of-2 |
| Resources missing role prefix entirely | yes | no | _ | 1-of-2 |
| Stale single-day shape on active range | no | yes | _ | 1-of-2 |
| Wrapper-or-project structural | yes | no | _ | 1-of-2 |
| Status/category mismatch | no | no | _ | 0-of-2 |
| Resources peer-alignment gap (NEW class) | n/a | yes | _ | 1-of-2 (tracked) |
| Category semantic drift (NEW class) | n/a | yes | _ | 1-of-2 (tracked) |
| `contractStart`/`contractEnd` null | n/a | yes | watch all 3 L1s | cross-client item #5 |

**Threshold rule:** any 2-of-3 surface at Soundly close → patch lands at Soundly close (per existing handoff rule).

**Snapshot state on disk:** worktree's `docs/tmp/data/tap-snapshot.json` (post-APPLY, 8 weekItems). Will be overwritten on next snapshot run for Soundly. Hopdoddy/TAP states are permanent in prod — verify via targeted MCP if needed (`get_week_items({clientSlug:'hopdoddy' or 'tap'})`).

## TL;DR

**Queue (operator-locked):** ~~Hopdoddy~~ ✓ → ~~TAP~~ ✓ → ~~Soundly~~ ✓ → ~~Convergix~~ ✓. **Cohort COMPLETE 2026-05-02.**

**Post-cohort:** ~~AG1~~ ✓ (small-batch close 2026-05-03 — first APPLY under operator policy A self-execute). HDL / Bonterra remain clean-by-fiat unless cross-client surfaces.

**Snapshot pattern:** Run `pnpm runway:snapshot --scope=<slug>` at the start of each client's pass, not up front. The script overwrites, one snapshot on disk at a time. Just-in-time is cleaner than pre-pulling all four.

**LPPC is data-clean.** Don't re-touch unless cross-client patterns demand.

**HDL / AG1 / Bonterra remain clean-by-fiat.** Don't touch unless cross-client surfaces.

## Session intent for the next round

Operator's queue, in order:

1. **Hopdoddy** (2 L1s, 0 L2s) — Brand Refresh launch verification + Digital Retainer wrapper-or-project structural call.
2. **TAP** (1 L1, 0 L2s) — Contract date backfill + phased-work L2 question.
3. **Soundly** (3 L1s, 0 L2s) — iFrame status/notes contradiction + cross-project contract date sweep.
4. **Convergix** — its own session. Largest scope (22 L1s including retainer wrapper + 1 newly-drifted bot-create).

## What just landed (LPPC, 2026-04-29 → 2026-04-30)

- **Counts:** 6 L1s (was 7, deleted `dfbf69a7` Mailchimp duplicate), 16 L2s (was 17, deleted 2 placeholder rows + created Hero Video Resolution).
- **3 batchIds shipped:**
  - `lppc-rowbyrow-2026-04-29` — 13 cards across forward-status drift, project notes refreshes, dedupe delete, resources fixes.
  - `lppc-mechanical-sweep-2026-04-29` — 16 ops. Date convention enforcement (`date=endDate`, `dayOfWeek` tracks `date`, single-day `endDate` fills, Map Client Clarity Ping resources relabel CW→AM).
  - `lppc-followup-fixes-2026-04-29` — 13 ops. Pencils Down 4/23→5/4 push (cascade-safe recipe verified — no leak to parent project.dueDate), Policy Materials Import 4/27→5/4 push, QA Phase multi-day fill 5/7→5/8.
- **L1s without L2s (intentional):** completed (YER, Spring CEO Invite) and on-hold (Blog Posts, Training Video, placeholder L2s deleted per Mailchimp precedent).
- **Active L1s:** Interactive Map (4 L2s), Website Revamp (12 L2s).
- **Hero Video Resolution L2** (`423ea9c0`) is new — Bill delivered 3 motion-sick hero videos 4/28; gated on resolution before Staging 5/4.

## Snapshot workflow (data-fresh-after-compaction recco)

The snapshot script `scripts/runway-snapshot.ts` (in `.worktrees/data-tp-runway/`) is the canonical fresh-state pull. It writes raw passthrough JSON for one client + purges other `*.json` in `docs/tmp/data/` as part of its run.

**Per-client, just-in-time pattern:**

```bash
cd /Users/jasonburks/Documents/_AI_/_R1/.worktrees/data-tp-runway
pnpm runway:snapshot --scope=hopdoddy
# Work Hopdoddy. After compaction during this pass, re-read docs/tmp/data/hopdoddy-snapshot.json. No re-pull needed.

# When done with Hopdoddy and moving to TAP:
pnpm runway:snapshot --scope=tap
# Hopdoddy's snapshot is overwritten — but Hopdoddy state is now permanent in prod (just-applied via writes).
# If you need to verify a Hopdoddy field post-cleanup, use targeted MCP: get_week_items({clientSlug:'hopdoddy'}) is bounded and fast.
```

**Why not pre-pull all four clients:** the script is one-at-a-time. Pre-pulling burns context for clients you won't touch for 30-60 minutes. Just-in-time keeps hydration footprint at ~50-70k tokens per single-project client, ~80-100k for Convergix.

**Compaction mid-card behavior:** the on-disk snapshot survives compaction. Conversation context is summarized away but the file stays. Re-read it to resume. `set_batch_mode` from prior context is gone — re-set with the same batchId before resuming writes.

**Mid-pass staleness (within a client):** the snapshot is fresh at start-of-pass, NOT through the full pass. After Card N writes to prod, any Card N+M that depends on those rows is reading stale snapshot state. Two options:

- **Spot-verify just-written rows** with bounded MCP: `get_week_items({clientSlug:'X'})` or `get_client_detail({slug:'X'})` between cards when a downstream card references prior-card rows. Cheap, surgical.
- **Re-snapshot mid-pass** (`pnpm runway:snapshot --scope=X` again) before scoping the mechanical sweep at the end. Heavier but resets the running state to current.

Default: spot-verify between cards, re-snapshot before the closing mechanical sweep so the sweep operates on post-row-by-row state, not stale pre-cleanup state.

**Current state of `docs/tmp/data/`:**
- Main repo: only this handoff doc.
- Worktree: stale `lppc-snapshot.json` from 2026-04-29 ~14:43 UTC (pre-cleanup). **Will be overwritten on first snapshot run** — that's fine.

## Hydration sequence for next session

1. **Read this handoff doc** (you're doing it).
2. **Read the data-integrity-tp skill files:** `~/.claude/skills/data-integrity-tp/SKILL.md`, `data-conventions.md`, `row-by-row.md`, `holdout-panels.md`, `rails-reference.md`.
3. **Read the live intent doc:** `docs/runway-data-integrity-intent.md` (operator-curated; ground truth for conventions).
4. **Operator briefs intent.** Confirm queue + which client first (default: Hopdoddy).
5. **Run snapshot for client #1** from worktree: `pnpm runway:snapshot --scope=hopdoddy`.
6. **Pull broad prod state via MCP** (one round-trip):
   - `get_data_health` (drift counters)
   - `get_clients(includeProjects=true)` (full client + project rows; informs cross-client awareness)
   - `get_team_members`, `get_pipeline`
7. **Code rails (write-bearing only):** read from `.worktrees/data-tp-runway/`:
   - `src/lib/db/runway-schema.ts`
   - `src/lib/runway/operations-utils.ts`
   - `src/lib/runway/operations-add.ts` (creates)
   - `src/lib/runway/operations-writes-week.ts`
   - `src/lib/runway/operations-writes-project.ts`
8. **Skip brain docs / archive memory.** Memory may be stale — verify any cited file path or helper behavior by grep before acting.

## Operator-locked queue with pre-flags

Pre-flags from prod state observed during the LPPC session — successor walks in with eyes open.

### 1. Hopdoddy (2 L1s, 0 L2s)

**`c323e450` Brand Refresh Website** (in-production, dates 4/30-4/30 — TODAY)
- 🟡 Notes: *"Design done, holding for launch\n\n[Legacy target: End of April — National Burger Day]"*
- **Status verification needed today.** Did it actually launch? If yes, flip to `completed`. If slipped, push dates and refresh notes.
- resources=`AM: Jill, CD: Lane, Dev: Leslie` ✓ clean

**`bc55c0b7` Digital Retainer (195 hrs)** (in-production)
- 🚩 **`engagementType=retainer` + `parentProjectId=null` = wrapper, but ZERO child L1s and ZERO L2s.** Either it's a real wrapper waiting for child workstreams, OR mislabeled (should be `engagementType=project`). Operator decision based on intent.
- 🟡 notes=`"Check with Jill"` (placeholder, needs real content)
- 🟡 resources=`null`
- contractStart=2026-01-01, contractEnd=2026-12-31 ✓

**Expected:** 3-5 cards. Brand Refresh status decision is the lead; Digital Retainer wrapper-vs-project is the structural call.

### 2. TAP (1 L1, 0 L2s)

**`3a9c9051` ERP Rebuild** (in-production, owner=Jason)
- 🚩 **`contractStart=null, contractEnd=null` despite contractTerm `"Mar 1 – Nov 30, 2026"`** — backfill needed. Both writable via `update_project_field`.
- resources=`PM: Jason, Dev: Tim` ✓
- 🟡 Notes call out phases: *"Discovery → SRD → DB Design → Dev (current) → Data Migration → Testing → Deployment → Training. Each phase blocked by predecessor."* — these are L2 territory. Operator decides: create one L2 per phase (timeline-trackable), OR keep notes-only as project-level scope.
- 🟡 owner=Jason (operator himself). Convention OK; just flag for awareness.

**Expected:** 2-4 cards. Contract date backfill (mechanical), then operator decision on phased L2 creation.

### 3. Soundly (3 L1s, 0 L2s)

**`cf4d6575` iFrame Provider Search** (status=completed, category=active)
- 🚩 **status/category MISMATCH** (same class as `35a75784` Website Blog Posts in LPPC).
- 🚩 **status=completed but notes contradict:** *"90% done, waiting on UHG iframe testing\n\n[Legacy target: Launch evening 4/21, live 4/22]"* — 90% is not completed. Either status is wrong OR notes are stale. Operator must clarify before any write.
- 🟡 contractStart=null, contractEnd=null
- resources=`AM: Jill, Dev: Leslie, Dev: Josefina, PM: Jason` ✓

**`8279d9eb` Payment Gateway Page** (in-production)
- 🟡 contractStart=null, contractEnd=null (despite Soundly contractTerm `"Sep 2025 – Aug 2026"`). All three Soundly projects have this gap — sweep candidate.
- notes=`"Under signed $30K SOW, through May 2026"` (sparse but informative)
- resources, dates ✓

**`54d65143` AARP Member Login + Landing Page** (in-production)
- 🟡 contractStart=null, contractEnd=null (same pattern)
- 🟡 Notes flag risk: *"HIGH PRIORITY: contractor bandwidth."* — Josefina is the contractor on resources; bandwidth concern is real. May warrant a tracking L2.
- dates 2026-04-17 → 2026-07-15 ✓

**🟡 Memory reference:** Possible NaN/NaN bug shipped on Soundly 2026-04-29 per memory feedback. Check `find_updates(clientSlug='soundly', since='2026-04-28')` to verify it was caught. If still in prod, fix.

**Expected:** 4-6 cards. iFrame status/category + status/reality reconciliation is the lead; contractStart/contractEnd backfill across all 3 is the mechanical sweep.

### 4. Convergix (its own session — pre-flags)

Last cleaned through Cluster 3 on 2026-04-26. Drift since:

**`86d94de276b94134bdd811ec5` "New Capacity ppt"** — landed via bot 2026-04-29T19:58 UTC outside any data-tp session.
- status=`not-started`, owner=`null`, resources=`Freelance` (free-text, no role prefix)
- dueDate=2026-05-06, parentProjectId=`null` (NOT linked to retainer wrapper)
- notes=`null`
- 🚩 **Almost certainly a duplicate** of `0c208308` "New Capacity (PPT, brochure, one-pager)" already nested under the retainer wrapper. Same client, similar name, similar deliverable scope.
- This is the duplicate-create class the Slack modal is being built to prevent.
- Triage: confirm dup with operator, then either delete `86d94de` or merge + parent-link to wrapper + role-tag the resources.

**Expected other drift** across 22 L1s: bare-name resources, stale notes referencing past dates, possible date-convention violations on L2s under wrapper children.

Convergix deserves its own session. Do not fold into the three-small batch.

## Open cross-client items rolling forward

Systemic, not client-specific. Successor should be aware:

1. **Empty-string normalization gap on `update_project_field` dueDate.** Confirmed via Kathy's 4/27 no-op write (`""` → `""` preserved). LPPC's `d7d7cc2f` was fixed individually (set to "2026-05-11"). Other clients likely have similar empty-string fields. **Pending fix:** Slack modal pre-plan Wave 0b includes empty-string-to-NULL normalization at write boundary — addresses future writes. Existing rows still need a sweep.

2. **Status/category mismatches.** Saw on `35a75784` Website Blog Posts (resolved this session) and `cf4d6575` iFrame Provider Search (next up in Soundly). Beyond Petro and EDF have similar drift. Slack modal Wave 0b adds a status/category compatibility validator that will reject future mismatches.

3. **Resources field format violations.** Bare names without role prefix (e.g., `"Freelance"` on Convergix's new ppt project). Convention: `Role: Person`. Slack modal Wave 0b adds role-tag-required validator at write boundary.

4. **Multi-day vs single-day shape conventions.** LPPC fully clean now. Other clients likely have the same pattern (multi-day with `date == startDate` instead of `date == endDate`, single-day with `endDate=null`). Mechanical sweep pattern from LPPC is reusable.

5. **`contractStart` / `contractEnd` null on retainer-period projects.** LPPC was a project-type contract; not affected. Soundly has 3/3 null contractStart/End despite signed term. TAP has null contractStart/End despite contract term. Pattern: retainer/project metadata wasn't backfilled when contracts signed. Cross-client backfill candidate.

6. **Wrapper-creation path is broken at the bot layer** (`engagementType`, `parentProjectId`, `contractStart`, `contractEnd` not in `create_project` enum). AG1 Social Content Trial wrapper still has null wrapper dates per intent doc — operator hasn't given dates yet (verbal SOW). Slack modal Wave 0a closes this.

## Skill patches pending (process flags from this session)

1. **Mechanical sweep scope expansion.** This session's sweep caught date-convention violations only. Missed semantic drift, surfaced post-hoc on LPPC's Pencils Down. Operator flagged for `data-conventions.md` / `row-by-row.md` patch. Until that patch lands, **before scoping each client's mechanical sweep, explicitly state the five categories being checked**:

   1. **Date conventions** (`date == endDate` on multi-day, `dayOfWeek` tracks `date`, single-day `endDate` filled, `weekOf == Monday(date)`)
   2. **Past-dated rows with non-terminal status** (anything with `date < today` and status ∉ {`completed`, `canceled`, `deferred`})
   3. **Resources missing role prefix** (any resources string without `Role: Person` shape — bare names, `Freelance`, etc.)
   4. **Stale single-day shape on active range work** (single-day row sitting on a range task that's still active — needs `endDate` widened, OR the task is actually done and status hasn't been flipped)
   5. **Task-dependent role labels** (e.g., Map Client Clarity Ping was tagged CW when the actual task — pinging the client — is AM work)

   If the sweep is scoped without naming these five, that's the LPPC-Pencils-Down failure mode repeating. Memory file: `feedback_sweep_scope_semantic_drift.md`. If the expanded scope holds across Hopdoddy/TAP/Soundly, fold into `row-by-row.md` § Verification at end so it's no longer memory-only.

2. **Verify-before-trust on prior batches.** Phase 3 batch on 2026-04-28 flipped Pencils Down to `completed` after Kathy's same-day note said it was deferred. Holdout panels weren't run. Pattern: when reviewing prior batch outcomes, audit against operator-stated intent, not just code-correctness.

3. **Cascade-safe recipe verified working.** Pencils Down 4/23→5/4 with category-flip recipe (deadline → delivery → date writes → deadline) produced `reverseCascaded: false` on every op AND verified post-write that parent project.dueDate stayed null. Recipe is canonical for any deadline-row date push.

## Process notes for the data-tp role

Reinforces the skill but came up enough this session to call out:

- **Set `set_batch_mode` BEFORE the first write of every session.** Operator caught Card 1 going through direct `update_week_item` instead of `batch_apply` — direct writes risk Slack leak even with batch mode active. Default to `batch_apply` for everything.
- **Reorder ops within a batch to avoid noisy cascades.** When deletes + status changes coexist, do deletes first so cascade fires on already-removed rows.
- **`weekOf` last** in any multi-field batch. The row's lookup key for prior ops is the original weekOf; only flip weekOf at the end.
- **Hot Sheet / Status Doc ground-truth pattern (per-client kickoff).** Operator's Hot Sheet caught Card 8 LPPC misclassification (Website Blog Posts as awaiting-client when truth was on-hold). Generalize: at every per-client kickoff, BEFORE proposing any delete, rename, status flip, or category change, ask the operator: *"Does this client have a Status Doc, Hot Sheet, or recent stakeholder note you can paste?"* If yes → wait for it before authorizing destructive writes. If no → flag any status/category/structural call as 🟡 medium-confidence at most, since prod state alone is insufficient ground truth on intent.
- **Decide-then-ask, not menu-then-decide.** Every card recco includes confidence + override condition, not "A or B?". Got this right by Card 3 onward; Card 8 was the misstep.
- **Cascade-safe recipe is canonical** for any deadline-row date write: flip category to delivery → write date/endDate → flip category back to deadline. Same batch_apply, sequential ops.

## Cohort tracking across the three small ones

Operator's framing on Hopdoddy/TAP/Soundly is **"test whether skill v2 holds across multiple clients in sequence before Convergix scale."** Treat the three as a cohort, not three independent passes. If the same drift category surfaces on 2+ of 3, that's a skill-patch signal — fold into `row-by-row.md` / `data-conventions.md` / `SKILL.md` before Convergix kicks off.

**Maintain a running count.** After each client closes, update this table inline (or in a fresh handoff if compacting). At Convergix kickoff, the table should read clearly which patches need to land first.

| Drift category | Hopdoddy | TAP | Soundly | Patch signal? |
|---|---|---|---|---|
| Date convention violations (multi-day shape, `weekOf`, etc.) | _ | _ | _ | already in skill |
| Past-dated non-terminal status | _ | _ | _ | patch candidate |
| Resources missing role prefix | _ | _ | _ | patch candidate |
| Stale single-day shape on active range work | _ | _ | _ | patch candidate |
| Task-dependent role label drift | _ | _ | _ | patch candidate |
| `contractStart` / `contractEnd` null on retainer-period | flag (none) | yes | yes (3/3) | already cross-client item #5 |
| Status/category mismatch | _ | _ | yes (`cf4d6575`) | already cross-client item #2 |
| Wrapper-or-project structural ambiguity | yes (`bc55c0b7`) | _ | _ | edge case, watch |
| Empty-string field at write boundary | _ | _ | _ | already cross-client item #1 |

**Threshold + timing:** **2-of-3 surfaces = skill patch lands at the close of whichever client triggers the threshold**, not held until pre-Convergix prep. If Hopdoddy + TAP both surface category X, the patch to `row-by-row.md` / `data-conventions.md` lands at TAP-close so Soundly runs the patched skill — and Soundly becomes the validation pass. If Hopdoddy + Soundly both surface (TAP didn't), patch at Soundly-close. Holding the patch until pre-Convergix wastes a data point and risks Soundly drifting in a way the patch would have caught.

1-of-3 stays in memory only. 3-of-3 = patch lands at whichever close hit threshold (likely TAP-close = 2-of-2 already triggered).

## Side reference: tickets filed elsewhere this session

Not data-tp swimlane:

1. **Multi-day row display-logic bug** — board renders multi-day L2s in two places (anchored on `startDate` AND in-flight active section). Routed to thought-partner. Successor: don't try to fix in data — it's a UI ticket.

2. **Slack modal pre-plan** at `.worktrees/runway-v3-cascade/docs/tmp/slack-modal-pre-plan.md`. Reviewed this session; flags filed (cascade trap on deadline creates, multi-day date=endDate enforcement on Modal 1, wrapper dates on insert verification, LLM termination fail-safe, title-collision soft-warn promotion). Modal lands → most data-tp queue items get hardened at the input layer.

3. **Gantt detector convention bug** — Gantt TP was anchoring `dayOfWeek`/`weekOf` checks against `startDate` instead of `date`. Reverified post-fix; reads clean.

## On re-engagement

1. Read this handoff doc.
2. Read `~/.claude/skills/data-integrity-tp/SKILL.md` + sub-files.
3. Read `docs/runway-data-integrity-intent.md`.
4. Operator briefs intent (confirm queue: Hopdoddy → TAP → Soundly → Convergix; confirm starting scope).
5. Run `pnpm runway:snapshot --scope=convergix` from `.worktrees/data-tp-runway/` (Hopdoddy + TAP + Soundly closed; Convergix is next per Session 2026-05-01 close section). For Convergix: ask operator for Hot Sheet + per-L1 status table BEFORE scoping (operator's one-pass pattern — see § Convergix prep).
6. Standard MCP pull: `get_data_health`, `get_clients(includeProjects=true)`, code rails for write-bearing scope.
7. **At per-client kickoff, ask operator for Status Doc / Hot Sheet** before any destructive proposal.
8. Surface findings to operator. Decide-then-ask. Row-by-row for judgment, mechanical sweep for convention.
9. **Before scoping the mechanical sweep**, name the five categories explicitly (date conventions + past-dated non-terminal status + resources missing role prefix + stale single-day shape + task-dependent role labels). If a category is intentionally out of scope, say why.
10. **Spot-verify between cards** with bounded MCP when downstream cards depend on prior writes. **Re-snapshot before the closing mechanical sweep** so it operates on post-row-by-row state.
11. **Update the cohort tracking table** after each client closes. If a category hits 2-of-N at any close, **patch the skill at that close** so the next cohort client runs the patched version. Don't hold patches for pre-Convergix prep.

Ready when you are.
