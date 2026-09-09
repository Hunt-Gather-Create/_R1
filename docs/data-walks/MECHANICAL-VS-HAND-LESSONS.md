# Sheet sync, mechanical run versus hand walk

**What this file is for.** The hand walk is how we actually make prod updates from a schedule
right now, because it is fast and the operator and Kathy can steer it in real time. The mechanical
pipeline, `scripts/runway-sheet-sync/`, is run in DRY RUN alongside it and never writes. This file
records where the two disagreed, so the tool earns its way to being trusted instead of being
declared ready.

Operator ruling 2026-09-07: hand walk is the working path for speed. The mechanical run is a
shadow test. Lessons go here, in a separate file, not into the walk itself.

**This file is the deliverable of the shadow runs.** If a session runs the dry run and writes
nothing here, that session produced no value from it.

---

## The one trap to design out, every time

**Snapshot the sheet ONCE and have both paths read the same snapshot.**

If the hand walk reads the sheet at 9:00 and the dry run reads it at 11:00, Kathy may have edited
a cell in between, and the diff between the two paths is then noise rather than signal. We would
be comparing two different questions and calling it a disagreement.

So: pull the sheet to a fixture with the `google-api` skill, note the pull time, and point both
the hand walk and `pnpm runway:sheet-sync --fixtures <dir>` at that same fixture. Any
disagreement after that is real.

The same applies to prod. If the hand walk has already written rows before the dry run reads
prod, the dry run will correctly plan nothing for those rows and it will look like agreement when
it is actually just late. **Either run the dry run against a prod snapshot taken before the hand
writes, or record clearly that it ran after and which rows were already done.**

---

## How to log a disagreement

One entry per disagreement, not one per row. Rows that behave the same way are one lesson.

Each entry answers four things:

1. **What the hand walk decided**, and the sheet cell that authorised it.
2. **What the mechanical run planned**, quoted from its own output, not paraphrased.
3. **Which one is right**, and how that was determined. If it is genuinely a judgment call rather
   than a defect, say so; that is the most useful category.
4. **Which of three kinds it is:**
   - **TOOL GAP.** The tool should have handled it and did not. Becomes a ticket.
   - **JUDGMENT.** The tool cannot decide this without a person, correctly. Becomes a documented
     limit, and the tool should route it to the review queue rather than guess.
   - **HAND ERROR.** The tool was right and we were not. The most valuable entry type and the one
     there will be least appetite to write.

Also log **agreements that are only accidental**: the tool reached the right answer for the wrong
reason. That is the defect shape this repo keeps finding, and an agreement is where it hides.

---

## Standing questions to answer before the tool is trusted unattended

Do not close these from a single run.

- Does it respect a BLANK action cell as "no write"? Sheet silence is authority, not an omission.
  A tool that helpfully infers an action from a blank cell is worse than no tool.
- Does it leave columns L and N alone? Those are operator-reserved.
- Does its plan preserve per-cell writes, so operator styling survives?
- When it declines a write, can anyone SEE what it declined? Today the answer is no, and that is
  #143: the review queue has a writer and no reader. Until that is fixed, the tool is only
  trustworthy for the writes it happens to accept.
- Does it get dates right at the boundaries, month end and week end? `parse-dates.ts` has its own
  tests; that is not the same as matching Kathy's intent.

---

## Runs

Newest first. A run with no entries still gets a heading, stating that it agreed on every row,
because "we ran it and found nothing" is a result and an absent heading is not.

### Run 4, 2026-09-07. NFM Cedar Park Digital Screen, NFM-2601. Tool ran BEFORE any load. Read-only.

```
leaf-tasks 32 | matched 0 | missing-in-runway 32 | runway-only-orphan 0
skipped: header 7, milestone 7, spacer 6 | collisions 0 | L1 UNRESOLVED, score 0
```

**Lesson 18. TOOL BETTER THAN THE DEFAULT HAND WALK. It caught two same-week title collisions and
fixed them minimally.** This sheet uses the title "NFM review and consolidated feedback" SEVEN
times. Two pairs genuinely collide: rows 24 and 30 both land in week 2026-10-26, and rows 33 and 39
both land in week 2026-11-09. Same title AND same week is the one case that breaks Runway, because
`resolveWeekItemOrFail` keys on exactly that pair and every later update would become ambiguous.
The tool appended the phase name to those four rows and LEFT THE OTHER THREE ALONE, because each of
those sits alone in its week. Minimal disambiguation, applied only where needed.
That is better than this seat's default. On Ammonia the hand walk shipped two duplicate pairs and
argued they were safe. They were, because the weeks differed. Here the weeks do NOT differ and the
tool noticed first.

**Lesson 19. TOOL RIGHT to refuse the L1.** NFM has zero projects in prod, so it scored 0, reported
UNRESOLVED rather than forcing a low-confidence match, and proposed a create. Compare run 1, where
LPPC scored 0.258 and the correct answer was a week item under an existing L1. Same output shape,
opposite correct action. The tool cannot tell those apart, which is _R1#153, but reporting the score
honestly is what lets a person tell them apart.

**Lesson 20. It found 32 leaf tasks, 7 headers, 7 gates, 6 spacers. Hand count agreed on all four.**

**Formula rot, fourth sheet in a row.** 11 rows had a gap: four task rows had lost the progress bar,
six spacer rows had lost the span check and days-left formulas. Rebuilt by tiling. Also noted, not
changed: row 12's start date is typed rather than `=DATE(y,m,d)` as on the three BP sheets. It
computes the same, so it is a consistency issue, not a defect.

**Not touched, deliberately.** This schedule fast-tracks across phases: Phase 3 hangs off Phase 2's
design revisions, Phase 4 off Phase 3's, Phase 6 off Phase 4's, so batches overlap. Same class as
the Spilltracker -1 lag. Deliberate until the operator says otherwise.

### Run 3, 2026-09-07. Ammonia BPC-2605. **Tool ran BEFORE the hand load.** First fair run.

Sheet frozen to a fixture at 21:20Z after the operator-walked edits. Tool run at 21:22Z against
prod, which held ZERO of these rows. Hand load followed at 21:35Z. Nothing was shown to the tool.

```
leaf-tasks 18 | matched 0 | missing-in-runway 18 | mismatched-field 0
runway-only-orphan 4 | skipped: header 7, milestone 7, spacer 7, empty 456
L1 resolved: Ammonia Landing Page, score 1.0
```

**Lesson 13. TOOL RIGHT on all four fields that move dates, across all 18 rows.** This is the
answer to the operator's actual question, and it is a real one. With no model in the loop and
nothing in Runway to copy, it produced the same 18 leaf tasks the hand walk did, with identical
`title`, `startDate`, `endDate`, `weekOf` and `status` on every row. It separated 7 section headers
and 7 gate rows on its own. It flagged the 4 June discovery cards and never proposed deleting them.
On structure and dates, it would have been right unattended.

**Lesson 14. TOOL GAP, and it is structural, not a bug. It cannot assign anyone, on any row.**
Every one of the 18 cards would have landed with no owner and no resources. The sheet's RESOURCE
column holds ROLES: "Design + Creatives", "Dev + QA", "Account", "BP". Runway's
`validateRoleTagOnResources` needs a role tag bound to a person, "CD: Lane". The tool has no
role-to-person map anywhere, so it dumps the raw cell into `notes` as "Resource: Design + Creatives"
and leaves both real fields empty. The hand walk maps them from the client's own roster.
The fix is a per-client role map, not a parser change. Until it exists, an apply run silently
produces an unassigned board.

**Lesson 15. CONFIRMED ON A SECOND SHEET: the tool writes `category` and the hand walk does not.**
It labelled every row kickoff / delivery / review / launch. Prod carries null on all 26 EDF, 11
Spilltracker and 18 Ammonia cards. Not a one-off; it is what the tool always does.

**Lesson 16. THE BLIND SPOT IS BIGGER THAN LESSON 11 SAID. Three fields, not one.**
After the hand load, run 3b reported `matched: 18, mismatched-field: 0`. At that moment prod held
`owner` and `resources` on all 18 rows and the tool's own plan held NEITHER, plus a `category` on
every row where prod holds null. Three fields differed on every single row and the drift check
reported zero. So the comparison covers title, dates, week and status only. `owner`, `resources`
and `category` are invisible to it. That is three of the seven fields it can write.
A green diff from this tool today does NOT mean Runway matches the sheet. It means four of seven
fields match.

**Lesson 17. A rename test that looked like a pass and proved nothing. Do not count it.**
The operator renamed four QA rows in the sheet to break a duplicate-title pair. The hand walk
renamed the same four in Runway. The tool then reported 18 of 18 matched. That is NOT evidence the
identity ledger can follow a rename, because BOTH SIDES changed together, so plain title matching
still worked. The real test is renaming the sheet only and leaving Runway alone. Not yet run.

**Formula rot is not occasional, it is the norm.** Third sheet in a row. EDF lost 3 header formulas,
Spilltracker lost 4 progress formulas, Ammonia had lost at least one of L / M / O on 18 of 42 rows.
Rebuilt by tiling a known-good row across the block rather than patching a list, because the list of
broken rows came from one read and could itself be incomplete.

### Run 2, 2026-09-07. Spilltracker BPC-2602, run AFTER the hand load. Read-only.

Hand walk loaded 11 cards to prod at 20:35Z. Tool run at 20:56Z against a fixture pulled from the
same sheet at 20:55Z. **This is a LATE run and its headline number is not a fair parity result.**
Recorded as late, per the rule at the top of this file, rather than quietly counted as a pass.

```
leaf-tasks 11 | matched 10 | missing-in-runway 0 | mismatched-field 1
runway-only-orphan 4 | skipped: header 3, milestone 3, spacer 2, empty 460
L1 resolved: Spilltracker Website Refresh, score 1.0
```

**Lesson 7. The `matched` number is circular here and must not be read as a win.**
The tool matched 10 of 11 rows against data the hand walk had written from that same sheet twenty
minutes earlier. Of course it matched. The honest test is running it BEFORE the load, and that was
impossible because the sheet was not in the registry and no fixture existed. Registering the sheet
and building the fixture were the first two things this run had to do. Run 3 must go first.

**Lesson 8. TOOL RIGHT, and independently so, on every structural call.** These do not depend on
what is in Runway, so they are the part of run 2 that IS valid evidence. Unprompted, with no model
in the loop, it read 11 leaf tasks and separated them from 3 section headers, 3 gate rows and 2
spacer rows. The hand walk reached the same 11 by reading the EDF load and copying its convention.
The tool got there from the sheet alone. It also correctly parsed the two spacer rows added an hour
earlier, which it had never seen before.

**Lesson 9. TOOL GAP. It cannot express in-progress, because the sheet cannot.**
The single disagreement is row 13, Creative Round 1 first pass, 8/31 to 9/8. Hand walk wrote
`in-progress`. Tool derived `scheduled`. The tool is reading the sheet's tick box, which is FALSE,
and FALSE only means not finished. The row started a week ago, so `scheduled` is wrong on a board a
person reads. The sheet encodes two states and reality has three. Either the sheet gains a way to say
started, or the tool infers it from start date versus today, which is a rule someone has to approve
rather than a bug to fix quietly.

**Lesson 10. TOOL RIGHT on the refusal, and this is the best behaviour it showed.**
It tagged that row `protected-no-write`. It saw a human-set status it disagreed with and declined to
overwrite it. That is exactly right, and it is the behaviour that makes an apply path trustworthy.

**Lesson 11. ACCIDENTAL AGREEMENT, hiding inside `matched`. Log this one loudly.**
The tool assigns every row a category: delivery, review, launch. Prod carries `category = null` on
all 11 of these cards and on all 26 EDF cards, because that is the convention the hand walk follows.
Those rows still counted as `matched`, so category is not part of the comparison. Ten green rows and
a silent divergence underneath them. If this tool ever runs with apply, it will write a category
onto every row the hand walk deliberately left empty, and the diff report as it stands today would
not have warned anyone. Either category joins the comparison or the tool stops deriving it.

**Lesson 12. TOOL RIGHT. The 4 June orphans were flagged, never proposed for deletion.**
Same four discovery rows the operator confirmed are the parent track of this work. Policy line in
its own report: "orphans are FLAGGED only. The sync never deletes Runway items."

**Infrastructure findings, both blocking a real parity run.**

- Run 1's output directory, `docs/tmp/data/runway-sync/`, was GONE by run 2. It sits under a
  gitignored temp path. So the fixture-mode identity ledger does not survive between runs, which
  means `matched` can never become meaningful in fixture mode. Only `--live` uses the durable DB
  ledger. This lands one run earlier than _R1#152 predicted.
- `--live` is unavailable on this machine: it needs `GOOGLE_SERVICE_ACCOUNT_JSON` and .env.local has
  no such key. So the only mode that has a durable ledger is also the only mode that cannot be run
  here.
- `--sheet=<id>` is silently ignored. The `arg()` helper at scripts/runway-sheet-sync.ts:43 reads
  `--sheet <id>` with a space and returns undefined for the `=` form, so the run fell back to ALL
  registered sheets and started diffing ITEP. It does not error on an unrecognised argument. A typo
  in a filter flag silently widens the run instead of narrowing it.

### Run 1, 2026-09-07. Shadow dry run on all four registered schedule sheets. No hand walk yet.

Sheet snapshot pulled ONCE at 2026-09-07T18:03:05Z to
`docs/tmp/data/runway-sync/fixtures/`. Prod read live at 18:03:28Z, read only. No hand writes had
happened yet, so this run is a clean baseline and not a late one.

Reports and payloads in `docs/tmp/data/runway-sync/`.

| Sheet | L1 match | Leaf tasks | Planned writes | Needs review |
|---|---|---|---|---|
| BPC-2603-01 ITEP Landing Page | ITEP Landing Page + Social, 0.78 | 21 | 21 week items | 0 |
| SND-2603 RX Card Rebuild | none, best 0.162 | 23 | 1 project, 23 week items | 1 |
| LPP-2604-01 Phase 2.1 Homepage | none, best 0.258 | 16 | 1 project, 16 week items | 1 |
| LPP-2604-02 Website Revamp Ph2 | Website Revamp, 0.765 | 0 | 0 | 0 |

**Lesson 1. TOOL RIGHT. The Soundly L1 really is absent, so proposing a create is correct.**
I checked prod myself instead of assuming a miss meant a bad match. Soundly has five L1 rows and
none of them is RX Card Rebuild. The 0.162 score is honest, not a matcher failure.

**Lesson 2. JUDGMENT. The LPPC L1 miss is the opposite case and the tool cannot see why.**
LPPC has one live L1, Website Revamp. The 2604-02 sheet fuzzy matched it at 0.765. The 2604-01
sheet missed at 0.258 and proposed a NEW project. Both sheets are phases of the same website work.
Past practice put those phases in as week items under the one L1, not as sibling L1 rows. The tool
compares a sheet banner against project names only, so it cannot know an engagement is carried as
a week item. Correct behavior is what it did, flag for review, and this is a standing limit rather
than a bug to code around.

**Lesson 3. TOOL RIGHT, and I was wrong first. The six orphan rows are not duplicates.**
My first read was that 21 missing tasks plus 6 orphans meant the same work under two sets of
titles, so applying would double the board. Then I read the rows. All six orphans are June
discovery work, and the earliest sheet task starts 2026-07-13. There is no overlap. The 21 creates
are genuinely new rows. This is the check that keeps the tool from being blamed for a hand mistake.

**Lesson 4. Matched is 0 on every sheet, and both a working tool and a broken tool produce that.**
The report explains it away as expected on a first run because the identity ledger is empty. That
explanation is true here and it is also exactly what a broken matcher would print. The ledger now
has one run behind it, so run 2 is the first run where a 0 in the matched column means something.
Do not accept a 0 there twice.

**Lesson 5. TOOL RIGHT. It refused to invent tasks from an empty template.**
LPP-2604-02 is 500 blank rows. The tool read 0 leaf tasks, planned nothing, and said the sheet
looks like an unfilled template. A tool that guessed here would be worse than no tool.

**Lesson 6. TOOL RIGHT on drift it was not asked about.** It flagged that the LPP-2604-01 banner
says LPP-2603-01 while the registry says LPP-2604-01, which matches the known stale-name gotcha,
and it flagged a hand-typed status of "On going" in a column the contract says to derive rather
than read. It also flagged that the banner layout and the header row sit one row off the documented
shape, and parsed anyway rather than mis-parsing quietly.

**Standing question answered: both L1 creates carried `requiresReview: true` with a plain reason.**
On a dry run that flag is visible in the payload file, so #143 is narrower than it looked. The
blind spot is the apply path, not the dry run.

**Open for the walk.** These schedule sheets have no column M action key. The blank-means-no-write
rule belongs to the operator review sheet, not here. Authority on a schedule sheet is the task
rows themselves, so the walk needs its own answer for what makes a row safe to write.


---

## The shape, counted. 2026-09-09

Seven instances in two working days, across seven unrelated tools. Filed under the SHAPE and not
under any one tool, because filing it under the tool guarantees re-deriving it on the next one.

**THE SHAPE: working and broken produce the same artifact. And the obvious correction often
produces evidence that you fixed it.**

| # | Tool | What a broken version produced | What a working version produced |
|---|---|---|---|
| 1 | `pnpm runway:migrate` dry run | prod written, log says DRY | prod untouched, log says DRY |
| 2 | sheet sync `matched` counter | `0`, matcher dead | `0`, ledger legitimately empty |
| 3 | parity guard, first shape | pass, iterating an empty payload list | pass, nothing to flag |
| 4 | parity guard, second shape | pass, never inspects the review branch | pass, nothing to flag |
| 5 | `ls \| wc -l` | `0`, aliased ls rejected the pipe | `0`, directory empty |
| 6 | `sed '<n>s/.../.../'` mutation | clean run, edit never applied | clean run, guard genuinely holds |
| 7 | `buzz messages get --limit 500` | 200 rows, silently clamped | 200 rows, that is the whole room |

**The four that were caught by an independent reader, not by the author.** 3 and 4 were found by
QA-Scout-1 and by a mutation on real data. 1 was found only because an independent backup existed.
5 was found because a second check in the same block disagreed with the first. None were found by
re-reading the code.

**The two that were mine, in my own verification, in one afternoon.** 5 and 6. Both produced a
plausible clean result that I nearly reported. The lesson is not "be careful"; it is that a
verification step needs its own control, exactly as much as the thing it verifies.

### The three controls that actually caught things

1. **Name what a dirty result would look like BEFORE running the check.** An empty diff on a path
   that exists on neither side is vacuously clean and reads exactly like success. On the untracked
   sweep, predicting that `data-tp-runway` would come back non-empty is what made the two zeros
   credible.
2. **Prove the instrument can fail.** Corrupt one copy and confirm the comparator reports a
   mismatch. Neutralize the guard and confirm its tests go red. A checker that has never failed in
   your presence is not yet a checker.
3. **Compare what you ASKED FOR against what you GOT, and state both.** A round number equal to a
   known cap is the tell. Raising the limit is NOT a control, because the bigger request succeeds
   and returns the same truncated page. This generalizes past Buzz: `gh api` comments paginate at
   30 and hand back a real comment as the last element with no marker.

### Why this belongs in this file

The epic these lessons feed, `_R1#158`, exists to answer one question: would the tool have gotten
it right unattended, without a model reasoning about it. Every entry above is a case where the
answer LOOKED like yes and was not. The parity harness in `_R1#151` is the fix for exactly one
row of this table. The other six rows are why the harness needs a second instrument rather than a
louder version of itself.
