# Evaluator learnings — accumulated patterns

A journal. Each entry is a pattern observed across one or more sessions where the templates didn't pre-flag what mattered. Patterns mature into template additions; outdated entries get pruned.

## Format

```markdown
## <YYYY-MM-DD> — <one-line title>

**Pattern:** <what was observed>
**Evidence:** <which session(s), which artifact, what specifically>
**Why it mattered:** <consequence if missed>
**What to do next time:** <concrete action — adds to a template, raises confidence threshold, etc.>
**Mature into template?** <yes/no/maybe — if yes, which file>
```

## Entries

### 2026-05-02 — Verify file claims before greenlighting handoff docs

**Pattern:** Handoff docs that list "files on disk" can claim files that don't exist (or omit files that do). Easy to skip with "of course they're there" assumption.

**Evidence:** Convergix cohort handoff doc 2026-05-02 listed 6 disk artifacts + 9 triplets. All 15 verified by `ls`. Without the verification, a missing file could ship and successor TP would hit a 404 on hydration. Already in template — note as enforced.

**Why it mattered:** Successor TP relies on the file index to know what to read. Wrong index = wasted hydration cycle on a non-existent file or skipped read on a missed file.

**What to do next time:** Always `ls` the cited paths before greenlighting. Cross-check-templates.md § Handoff doc lists this; treat as non-optional.

**Mature into template?** Already in template — enforced.

### 2026-05-02 — Cross-check skill-patch evidence against triplet/spec, not just snapshot

**Pattern:** Skill v4 patch candidates can have mismatched evidence — claim a write happened in batch X when it actually happened in batch Y, or claim a category flip on a row that didn't have one. Snapshot may not catch this if the snapshot doesn't enumerate every op.

**Evidence:** v4 patch #20 evidence claimed "convergix-cards-2026-05-01 forced into triplet because Card 1 (Cert Page)" — Cert Page was actually in status sweep batch, not cards. Caught by reading the convention sweep spec + triplet directly.

**Why it mattered:** Skill patches inform future-session methodology. Misattributed evidence makes the patch read as wrong even when the pattern is real, weakens operator confidence in the patch list.

**What to do next time:** For every patch evidence claim citing a specific row + batch, grep the triplet or spec to confirm the row is actually in that batch and the cited write actually happened. Don't trust evidence by reasoning — verify by reading.

**Mature into template?** Already in template — reinforce.

### 2026-05-02 — Stream-of-consciousness leaks in data-tp's docs

**Pattern:** data-tp sometimes leaves mid-thought interruptions in committed docs — phrases like "wait, current=X" or "actually maybe Y" that look like internal deliberation, not finalized doc text.

**Evidence:** Convergix snapshot 2026-05-02-final.json line 121 had `"Texas Instruments Article (c0935359, startDate=2026-04-22 — wait, current=2026-04-22)"`. Cleaned at evaluator request.

**Why it mattered:** Doc readability for successor TP. These leaks signal "data-tp wasn't sure" but committed anyway, which is confusing without context.

**What to do next time:** Scan committed docs for "wait", "actually", "—" mid-claim, "TBD" in finalized sections, or any phrasing that reads like internal monologue. Flag for cleanup.

**Mature into template?** Added to handoff doc + snapshot templates as a hygiene check.

### 2026-05-02 — File-handoff pattern significantly reduces operator friction

**Pattern:** Old pattern: operator copy-pastes data-tp's full output back to evaluator. New pattern: data-tp writes artifact + signal file; evaluator reads disk; operator only relays one-line acknowledgments.

**Evidence:** Convergix cohort close 2026-05-02 used file-handoff for snapshot, handoff doc, and skill v4 candidates. Operator's relay overhead dropped from paragraphs to one-liners. Evaluator's cross-checks unchanged in depth.

**Why it mattered:** Operator can step away from terminal between checkpoints. Reduces the "operator as courier" failure mode.

**What to do next time:** Default to file-handoff for any artifact >50 words. Inline acknowledgments only for short verdicts.

**Mature into template?** Canonized in SKILL.md § Communication.

### 2026-05-02 — Parent date overrides clobbered by child-triggered recompute (CRITICAL)

**Pattern:** When a batch includes (a) a parent L1 date override AND (b) child L2 writes that trigger parent recompute, op order matters. If parent override writes first, child writes recompute the parent and clobber the override. Silent until verify catches it.

**Evidence:** Convergix status sweep 2026-05-02. Op 4 wrote Rockwell Co-Marketing endDate=5/16; ops 6-11 (Card 4 Daniel Scope Ask child writes) triggered recompute on Rockwell L1, max-of-children=5/5 clobbered the 5/16 override. Required convergix-status-sweep-2026-05-02-fix sub-batch (1-row override re-fire). Caught 3rd time today.

**Why it mattered:** Silent prod data loss. Caught only because verify scripts had explicit assertions on Card 2 endDate. If verify weren't there, the clobber would have shipped.

**What to do next time:** On any cross-check of a spec or triplet that touches both parent date overrides AND child L2 writes on that parent, verify op-order: parent override comes AFTER all child writes. If op-order is impossible due to cascading parent dependencies, expect a post-batch fix-override batch with bumped updatedBy. Surface to operator as decision point.

**Mature into template?** Added as explicit check in spec + triplet templates. Also queued as skill v4 patch #25 for landing.

### 2026-05-02 — Branch tracking can silently point at deploy branch

**Pattern:** Feature branches can have their upstream tracking pointed at the canonical deploy branch (e.g., `upstream/runway`) without the user noticing. A bare `git push` would push commits to deploy.

**Evidence:** `feature/data-tp-cluster3` was tracking `upstream/runway` until data-tp explicitly pushed to `origin/feature/data-tp-cluster3` with `-u` flag.

**Why it mattered:** Near-miss for shipping data-only commits to production deploy branch.

**What to do next time:** Before any `git push` on a feature branch, verify tracking with `git branch -vv`. If tracking is wrong, fix with `git push -u origin <branch>` to reset.

**Mature into template?** Add to handoff doc template under "git hygiene checks" if commit/push falls under evaluator scope. Otherwise note in successor-TP handoff sections.

### 2026-05-03 — File-handoff + /loop autopilot working pattern (initial run, AG1)

**Pattern:** First test of single-funnel + /loop autopilot. Both sessions in /loop dynamic mode, communicating via `data-tp-ready.txt` ↔ `evaluator-ready.txt` signal files. Operator out of the courier role except at hard 3 gates + escalations.

**Evidence (AG1 batch 2026-05-03):**
- T1 spec cross-check fired event-driven via Monitor (caught data-tp's spec write within 3s of mtime change). Verdict landed on disk at 14:55Z.
- Data-tp's first iteration of /loop used 240s ScheduleWakeup (no Monitor). Polled at 14:53Z — missed my 14:55Z verdict by 2 min — then bumped to 1200s (20-min idle wait). Operator flagged 20-min as too aggressive.
- T2 trigger fired event-driven for me via Monitor at 15:18Z (instant pickup), wrote verdict at 15:35Z (17 min after trigger including code-claim verification).
- Operator observation 2026-05-03: "I have monitor tag but data-tp doesn't" — Monitor adoption gap.

**Why it mattered:**
- Monitor on the evaluator side worked perfectly — instant event wake, no polling-cadence friction.
- Without Monitor on data-tp side, evaluator's verdict could sit on disk up to 20 min before pickup if data-tp's polling cadence was bumped after one missed poll.
- The "don't escalate after one missed poll" rule (added to both SKILL.md files this session) addresses the bump trap, but Monitor adoption would eliminate the polling-cadence question entirely on the data-tp side too.

**What to do next time:**
- Promote Monitor from "optionally arm" to "recommended (preferred over fixed-cadence polling)" in data-integrity-tp SKILL.md § Loop activation. Same rationale as evaluator side: event-driven wake = zero polling-cadence tuning needed.
- Track full-cycle latency next AG1-equivalent batch: time from data-tp surface → evaluator pickup → evaluator verdict → data-tp pickup → next surface. If still slow due to polling cadence (not actual cross-check work), Monitor adoption will close the gap.

**Mature into template?** Promoted in data-integrity-tp SKILL.md § Loop activation 2026-05-03. Track adoption next session.

### 2026-05-03 — Drafter-found code-reality drift in spec (cascade audit emission)

**Pattern:** Pre-drafter spec described expected audit-row math based on memory + skill-doc convention. Drafter read actual code rails, found spec was wrong on a structural point: `recomputeProjectDatesWith` raw-UPDATEs parent dates with no audit emission. Spec corrected in-line, new v4 patch candidate (#26) surfaced for audit-trail completeness.

**Evidence:** AG1 batch 2026-05-03 § Code-reality discovery. Pre-drafter spec said 6 audit rows (5 helper + 1 cascade-date-change). Code reality: 5 audit rows + silent cascade. Drafter caught it in DRY_RUN. Verify assertions #11 (count=6→5) and #12 (cascade=1→0) corrected. v4 patch #26 proposes adding `cascade-date-change` audit emission to close the audit-trail gap.

**Why it mattered:** Without drafter's grep-and-fix, evaluator T2 + holdout panels could have shipped a verify script that fails post-APPLY due to wrong expected counts. Worse: every prior cohort batch that touched L2 dates likely under-counted audit rows by 1 per affected parent — silent audit-trail incompleteness that no one had noticed.

**What to do next time:**
- Treat drafter's "Flags & surprises" section in their return summary as authoritative on code-rails behavior, not the spec's pre-drafter assumptions.
- Evaluator T2 should grep-verify any structural code claim drafter surfaces (I verified 2 of drafter's 3 claims in this session — both checked out).
- Cohort retro: when #26 lands as code patch, decide whether to retro-audit prior cohort batches' audit-row tallies for the under-count.

**Mature into template?** Add to cross-check-templates.md § Triplet (T2): "When drafter surfaces code-reality drift in their return summary, grep-verify the structural claims before issuing T2 verdict." Will land at AG1 close.

### 2026-05-03 — Spec section drift after partial in-line correction

**Pattern:** When spec is corrected in-line for code-reality findings, sections that mirror the corrected math elsewhere can drift. Forward-batch sections corrected; REVERT § audit-row math missed.

**Evidence:** AG1 spec 2026-05-03 forward-batch sections corrected (audit-row math line 13, assertions #11/#12, rails table #10). REVERT § lines 202-203 still claimed "1 cascade row + 6 total" — stale pre-drafter numbers. REVERT script comment header was correct (5 + 0). Caught in T2 cross-check, flagged as hygiene amendment for cohort close.

**Why it mattered:** Spec doc is the cohort-handoff record. Stale REVERT § text would mislead a successor TP if they read the spec without reading the REVERT script source.

**What to do next time:** When making in-line spec corrections, grep the same numbers across the whole spec doc — forward sections, REVERT sections, rails tables, summary tables. Don't trust per-section editing to catch all instances.

**Mature into template?** Maybe — add to cross-check-templates.md § Spec as a "math-consistency across spec sections" check. Track signal next time it surfaces.

### 2026-05-03 — Multi-session orchestration: watermarks, self-handoff, cross-visibility (open queue)

**Pattern:** First long-running parallel-session run (AG1) surfaces operational gaps in /loop autopilot that need design before scaling. Operator flagged 4 areas at AG1 mid-flight (~5 hrs in):

1. **Context watermark tracking** — neither session monitors its own token count. Operator gave anchors: GREEN <250k (cache warm, performance good), YELLOW 250k–350k (degrading, plan compact), RED >350k–400k (compact NOW, performance bad). At time of flag: evaluator at 324k (YELLOW), data-tp at 283k (YELLOW entering).

2. **Compact process for mid-loop sessions** — `/compact` is operator-only. Session can't auto-compact. But session CAN: detect threshold, draft self-handoff to disk, push-notify operator with "compact me + paste this trigger." Post-compact, session reads disk state + resumes /loop without operator-as-courier.

3. **Task list cross-visibility** — each session has its own TaskList; the other side can't see it. Operator sees both via terminal screenshots. Cross-share via disk: e.g., `signals/evaluator-tasks.txt` + `signals/data-tp-tasks.txt` written periodically. Other side polls. Lets each session check the other's progress without operator relay.

4. **Monitor symmetry** — only evaluator armed Monitor this session; data-tp used fixed-cadence ScheduleWakeup. Already promoted Monitor to "recommended default" in data-integrity-tp SKILL.md for next session. Track adoption.

**Evidence (AG1 batch 2026-05-03):**
- Evaluator at 324k tokens after T1 + T2 + multiple skill edits + learnings appends. Trending hot. No self-monitoring.
- Data-tp at 283k after spec write + drafter dispatch + holdout dispatch + APPLY-gate prep. Trending hot.
- Neither side wrote a self-handoff to disk preemptively. If either compacted unexpectedly mid-loop, the other side's signal-file read would still work (disk is durable), but in-conversation context would be lost — re-engagement would need operator-pasted trigger pointing at the disk state.
- AG1 isn't done yet (post-APPLY verify + cohort handoff still pending). Both sessions need to survive at least 30-60 more min of work + likely a compact each.

**Why it mattered:** Without watermark tracking + self-handoff discipline, a mid-loop compact = operator becomes courier again to re-arm /loop and point at disk state. Defeats single-funnel. Performance degradation past 250k also slows the cross-checks themselves — verdicts take longer, operator waits longer.

**What to do next time (proposals — not yet locked):**

a. **Self-watermark check:** at start of each /loop iteration, compare `/context` tokens against thresholds. If YELLOW: draft self-handoff to `docs/tmp/data/signals/<side>-pre-compact.md` (active scope, last verdict, in-flight tasks, next expected signal). If RED: PushNotification operator + halt loop until compact.

b. **Self-handoff doc template:** what disk artifact survives compact + lets a fresh-context successor resume? Active scope, current /loop prompt to re-fire, Monitor task ID, last 3 task statuses, last verdict written, next expected signal phrase, code-rails grep cache (so successor doesn't re-grep upstream/runway).

c. **Cross-visibility task files:** each session writes `signals/<side>-tasks.txt` after every TaskUpdate. Other side polls (or includes in their Monitor's emit content) to know what the other is doing. Lets evaluator see "data-tp is dispatching drafter" without waiting for the next signal.

d. **Compact-and-resume protocol:** operator sees push-notify "I'm at X tokens, compact me now. After compact, paste this single trigger: [pre-formed string]." String includes `/loop <prompt>` + the disk path to read first. Re-engagement is one paste, not multiple steps.

e. **Watermark thresholds in SKILL.md:** bake the GREEN/YELLOW/RED anchors (250k/350k/400k) into both SKILL.md files so future sessions self-track from start.

**Mature into template?** Yes for items a, b, e — they're general orchestration discipline. Items c, d need design + a second session to validate. Land at AG1 close as part of the "things that surfaced during the AG1 first-test run" patch batch.

**Status at log time:** evaluator at 324k (YELLOW deep, trending RED), data-tp at 283k (YELLOW entering). AG1 still has post-APPLY verify + cohort close ahead. May need mid-flight compact on both sides before AG1 done.

## Pruning

When an entry's "What to do next time" matures into a template addition, mark the entry as `(matured to template <X>)` and leave it for a session, then prune. Keeps the file from growing indefinitely.
