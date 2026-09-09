# EPIC: sheet sync becomes a tool any seat can run

**Plan of record for milestone `13 Dry run parity`.** Written to the one-shot-feature-planning SOP v1,
`Civilization-Skill-Suite/agency-os/docs/sops/one-shot-feature-planning-v1.md`.

**Status:** planned, not dispatched. Epic ticket `_R1#158`.
**Author:** Runway TP, 2026-09-07.
**Evidence base:** `docs/data-walks/MECHANICAL-VS-HAND-LESSONS.md`, four schedules walked by hand with
the tool running beside them.

---

## 1. The goal, in the operator's words

"Eventually we'd want updating Runway to be a tool, as mechanical and programmatic as it can be with
good data integrity and process so any seat can use it to make safe updates. For now you're more of a
role or a seat."

And the bar for when it is ready: "would it have gotten it right without needing LLM reasoning."

That is the whole test. Not "did the run succeed." Not "did the numbers look right." Would the tool,
unattended, with no model in the loop, have produced what a careful person produced.

**The last clause of the goal is the one this plan exists to protect.** ANY SEAT. Not this seat. A
tool only this seat can run is still a role wearing a script. So the epic does not end at a green
suite, and it does not end at a clean run by the seat that built it. Those are milestones 1 through 8.
Milestones 9 through 13 are the half that never happens on its own.

---

## 2. The rebuild: what to copy, and from where

`Civilization-Skill-Suite/agency-doc-kit/lib/schedule/` is the cleanest thing in the fleet on this
shape. It BUILDS the schedule sheets that this tool READS, so the two are opposite ends of the same
pipe and should look alike. Four files, 559 lines total.

### 2.1 The layer split

```
shape.js    fixed row structure, holiday set, workday(). Pure data plus pure functions.
model.js    pure function of payload and shape, returns a list of write requests. No network, no LLM.
render.js   the only file that talks to Google. Takes a model, sends it.
verify.js   an INDEPENDENT recomputation, in another language, checked against the answer.
```

Sheet sync has twenty-nine files and no equivalent of this split. `parse`, `classify`, `derive`,
`diff` and `apply` each reach for what they need. Restructure so each is a pure function of its
inputs plus an explicit options object, and one file owns each concern. That is `_R1#157`, and it
goes LAST. See section 5.

### 2.2 A payload schema, and per-job payloads as data

`schemas/schedule-payload.json` is the contract. `data/schedules/*.json` is one file per real job. The
generator is the same code every time. Only data changes.

Sheet sync's equivalent is `config.ts`, a hand-typed TypeScript array that is already stale and
already self-contradicting. It should be data with a schema, plus the three checks in `_R1#154`.

### 2.3 The one idea worth more than the rest: a second instrument

Quoting `verify.js` directly, because it states the defect shape this repo keeps finding better than
this seat has managed:

> "lib/schedule/model.js#computeCascade is a JS port of the same workday() algorithm. Comparing that
> port against ITSELF proves nothing. A shared bug, a wrong lag rule, an off-by-one in the
> day-stepping loop, would be ported faithfully into both sides and agree perfectly. The only real
> control is two independent implementations, in two languages, checked against one answer."

Sheet sync has NO second instrument. It reads a sheet, decides what Runway should say, and the only
thing that ever checks it is the same code. Every green run so far is a self-report.

The second instrument today is a person: this seat, reading prod rows. That is the correct bootstrap
and it is what the operator described. It stops being fine the moment the disagreements stop getting
written down. `_R1#151` turns that person into an artifact.

### 2.4 Facts about the world are hardcoded. Facts about a job come from the payload

`render.js` keeps `KNOWN_TEMPLATE_IDS` as a literal, with the reasoning attached:

> "Hardcoded on purpose, not read from data/schedules/*.json: the allowlist has to be a fact about
> the real template, not a fact about whatever a payload happened to carry."

Same line here. The tab name, the column contract, the legal statuses and the role map are facts about
our system. The sheet id, the client and the engagement code are facts about a job.

**Clarification added 2026-09-07, because this rule was misapplied on the first build that cited it.**
A CURRENT DEFECT IS NOT A FACT ABOUT THE WORLD. `_R1#151` hardcoded `owner: null, resources: null` in
its comparator and cited this section, on the reasoning that the tool never plans those fields. True
today, and `_R1#159` exists to change it. Hardcode a defect and the instrument built to measure the
fix goes blind to the fix, so a successful `_R1#159` would read as a failure. If a value is named in
an open ticket, it is not a constant. Derive it, or guard it so the moment it changes the run fails
loudly.

### 2.5 Never a silent skip

The drift test between the vendored verifier and the canonical one "reports a loud, counted skip when
it does not resolve, never a silent pass that looks the same as a skip." Same rule as `_R1#152`'s
falsifiable `matched` counter and `_R1#156`'s intervention count, stated once and applied everywhere.

### 2.6 What the schedule generator already knew that this seat learned by hand

`shape.js` documents the lag rule:

> "lag is passed straight into workday() as the day count, so lag=1 means next workday, no gap and
> lag=0 means same day as the predecessor's finish, used on gate/send/milestone rows. lag=1 is NOT a
> one-day gap. Off by one here silently shifts the whole schedule."

This seat derived that rule by reading dates off the Spilltracker sheet, spent a turn treating a
deliberate `-1` lag as a defect, and had to be corrected by the operator. **The rule was already
written down, in the fleet, in a file this seat had not read.** That is the biggest efficiency finding
of the day and it is not about code. It is now a standing pre-step: read what the generator knows
before reading a schedule by hand.

---

## 3. Where it actually stands, measured

Runs 3 and 4 are the only fair runs, because in those two the tool went FIRST.

**Right, unattended, on every row.** Which sheet rows are real tasks. The title. The start date. The
end date. The week bucket. The status. It separated section headers, gate rows and spacer rows on its
own. It refused to invent tasks from a blank template. It flagged Runway rows with no sheet
counterpart and never proposed deleting them. On NFM it caught two same-week title collisions the hand
walk would have shipped, and disambiguated only the four rows that needed it.

**Wrong, unattended, on every row.** Owner and resources are empty. Category is written when the
convention is to leave it null.

**The measurement that reframes the epic.** `diff.ts` emits a field delta on exactly three fields:
`status`, `startDate`, `endDate`. That is the complete list. `title` and `weekOf` are used to MATCH a
row, never to correct one. `owner`, `resources` and `role` do not appear anywhere in the tool's 3,670
lines.

So the honest statement is not "three of seven fields are invisible to its drift check." It is:

- On CREATE the tool writes a row with no owner, no resources, and a category that should be null.
- On UPDATE it can only ever converge three fields. A drifted title, week bucket, owner, resource or
  category is permanently invisible to it.

And the thing that should worry us most: after the hand load of Ammonia it reported
`matched: 18, mismatched-field: 0` while three fields differed on all 18 rows. It reported perfect
agreement with data it disagreed with on every row.

---

## 4. The holdout split, which costs nothing and is the strongest bar in this plan

Four schedules have been walked by hand: EDF, Spilltracker, Ammonia, NFM. Prod already holds the
careful-person answer for all four, written before any of this code changes. That is a labelled
dataset we already paid for.

So split it:

| Set | Sheets | Use |
|---|---|---|
| Build | Spilltracker, Ammonia | Read freely. Tune against these. |
| **Holdout** | **EDF, NFM** | **Do not read while building. Run once, at the gate.** |

CC builds against the build set. QA runs the holdout set. A field map tuned until Ammonia passes is a
field map tuned to Ammonia. The holdout is the only thing that tells us whether it generalises, and it
is free because the walks are already done.

**This is a hard rule for the bay: CC does not open the EDF or NFM parity artifacts.** If CC needs a
third example, it asks TP and TP supplies one from the build set.

---

## 5. Milestones, tracks, and the observable event for each

SOP Step 2: every milestone carries exactly ONE observable event, written now, binary, cheap, and
impossible to satisfy with a green test suite. SOP Step 3: the bar names an artifact the defect cannot
also produce.

Observer is TP unless named otherwise.

### Track T0. Authority. Runs on TP, not the bay.

| M | Ticket | Observable event |
|---|---|---|
| M1 | `_R1#155` authority rules table | The parser carries the Spilltracker `-1` lag through UNCHANGED into a committed parity artifact, and the operator has signed the table in a comment on the ticket. A validator that clamps a negative lag to zero cannot produce that artifact. |

No code, no file collisions, so this runs genuinely in parallel with the bay's first build. It gates
T2, because "what makes a row actionable" and "category stays null" have to be written before they are
coded.

### Track T1. The instrument. Nothing else is measurable without it. Dispatch FIRST.

| M | Ticket | Observable event |
|---|---|---|
| M2 | `_R1#151` parity harness | **OBSERVED 2026-09-07T23:04Z.** runId `d61e467d6c1b4c96`, 18 DISAGREE on exactly category, owner, resources. 0 AGREE, 4 HAND_ONLY. Real captured snapshots at `docs/data-walks/fixtures/ammonia/`, byte-identical rerun confirmed own-hands. The harness reports **DISAGREE on all 18 Ammonia rows** for owner, resources and category. We have measured that the tool is wrong on those 18 rows, so a harness that reports AGREE is broken. A harness that reads the tool's own `matched` column reports AGREE. The defect cannot produce this artifact. |
| M3 | `_R1#152` falsifiable matched counter | Two runs against one frozen snapshot, both report files on disk, second run's `matched` equals the first run's write count. Then delete the ledger between runs and the second run REDS instead of reporting 0. |
| M4 | `_R1#156` model-free proof plus counters | Intervention count of ZERO on two consecutive real schedules, read out of two committed parity artifacts. That count is the milestone. |

### Track T2. The diff. Highest value per row. Owns `diff.ts`, so it is one thread, sequenced.

| M | Ticket | Observable event |
|---|---|---|
| M5 | `_R1#159` role map | The **holdout** NFM parity artifact reports AGREE on owner and resources for all 32 rows, run by QA, built without reading it. |
| M6 | `_R1#160` diff corrects only three fields | Take a prod row, hand-drift its title and week bucket, run the tool, and the drift is CORRECTED. Today the tool cannot see it. A three-field diff cannot produce this. |
| M7 | `_R1#153` resolver list. **Design constraint from CC, 2026-09-07: the harness needs an identity-versus-content split before `title` and `weekOf` can enter PARITY_FIELDS. You need a value to match ON that is distinct from the value you compare FOR drift. A longer array is the easy wrong build.** | The LPPC `2604-01` fixture resolves to the existing `Website Revamp` L1 or routes to review NAMING the week-item candidate. It must not propose a new project. And Soundly `RX Card Rebuild` still proposes a create, with "no resolver fired" in the report instead of a low score. |

### Track T3. Inputs. Which sheet, which rows. Owns `config.ts`. Independent thread.

| M | Ticket | Observable event |
|---|---|---|
| M8 | `_R1#154` registry checks | A run against the REGISTERED ITEP v1 sheet REFUSES and names `BPC-2604_itep_Project-Plan-v2`. Today that run succeeds, because reading the wrong sheet correctly looks identical to reading the right sheet correctly. |

### Track T4. Restructure. Last, deliberately.

| M | Ticket | Observable event |
|---|---|---|
| M9 | `_R1#157` one control file per concern | Parity artifacts for ALL FOUR walked sheets are byte-identical before and after the restructure. This bar cannot even be written until T1 exists, which is why the restructure goes last. |

### Launch. SOP Step 1. This half never falls out of the last build milestone.

| M | Ticket | Observable event |
|---|---|---|
| M10 | `_R1#161` live mode credential. **BLOCKED on operator.** | One `--live` run completes against one sheet, exit 0, writes nothing, log read by TP. Today `--live` cannot run at all: it needs `GOOGLE_SERVICE_ACCOUNT_JSON` and `.env.local` has no such key. Planned and marked blocked, per SOP Step 1. |
| M11 | `_R1#162` durable ledger proven in live mode | Two `--live` runs a day apart. The second reports `matched` equal to the first run's write count. In fixture mode the ledger lives under a gitignored temp path and was already deleted between two runs on the same afternoon, so the only mode with a durable ledger is the only mode we cannot currently run. |
| M12 | `_R1#163` the tool goes first on a real schedule | On the NEXT real schedule, TP runs the tool and commits the parity artifact BEFORE writing the migration script. Git timestamps prove the order. The intervention count is recorded whatever it turns out to be. |
| M13 | `_R1#164` a second seat runs it. **The operator's actual bar.** | A seat that is NOT this one runs the tool from the doc alone and produces a parity artifact, witnessed by the operator. Blocked while Holdout and Overwatch are offline. Planned and marked blocked. |

### Rollout. SOP Step 7. The tool targets many sheets, so coverage is its own milestone class.

| M | Ticket | Observable event |
|---|---|---|
| M14 | `_R1#165` coverage across every plan sheet Drive holds | Every `*_Project-Plan-v*` sheet under the client folders reads exactly one of DEPLOYED, FAILED or COULD-NOT-TELL, each rendering visibly different, and the run reports three numbers: covered, excluded-with-reason, and missing. |

**The denominator rule, SOP Step 7a, maps onto this epic exactly.** A coverage check that counts
registered sheets over `config.ts` reports full coverage of the wrong population. `config.ts` is the
hand-typed list that is already missing three v2 plans. So the denominator comes from the Drive API,
which has never heard of this rollout and is maintained by a party that does not know it exists. The
check must be able to RED ON THE LIST, not only on the targets: if it cannot enumerate Drive, it reds
rather than reporting full coverage over a short list.

**Three states, SOP Step 7b.** COULD-NOT-TELL keys on a POSITIVE signal of not-knowing: a permission
error, a timeout, a refusal. Never on an absence, because a genuinely clean sheet produces an absence
and the state would be worthless.

**Exclusions, SOP Step 7c.** A superseded v1 next to a live v2 is a legitimate exclusion. It is
enumerated and justified in the rendered output, never filtered out before the count.

---

## 6. Dependency, and the order to dispatch in

```
T0 M1 authority ......... TP, parallel, gates T2
T1 M2 -> M3 -> M4 ....... dispatch FIRST. Nothing downstream is measurable without M2.
T2 M5 -> M6 -> M7 ....... needs M1 signed and M2 landed
T3 M8 ................... independent, dispatch any time
T4 M9 ................... after T1, T2, T3 all merged
Launch M10 .............. blocked on operator, unblocks M11
Launch M11 -> M12 ....... after M10
Launch M13 .............. blocked on a second seat coming online
Rollout M14 ............. after M8, needs the discovery command
```

Nothing here is worth building before the thing that measures it exists. That is why M2 is first and
M9 is last.

---

## 7. The bay shape. SOP Step 5.

**One Buzz thread per track, four code threads.** Room `46290a49-2e54-40a9-99ec-f79652a83337`. The
first message about a track is its root. Every later message replies into it with `--reply-to <root>`,
so each track keeps its own history.

| Thread | Track | Files it owns |
|---|---|---|
| A | T1 instrument | new `parity/*`, `ledger.ts`, `ledger-db.ts`, `report.ts` |
| B | T2 the diff | `diff.ts`, `derive.ts`, new role map |
| C | T3 inputs | `config.ts`, new discovery command |
| D | T4 restructure | everything, so it waits |

File ownership is drawn on purpose. `diff.ts` is touched by both the role map and the resolver list,
so those two sit in ONE thread and run in sequence. Nothing else overlaps, so no two threads can
collide in a worktree.

**Runway (CC) is serial. Its true concurrency is one.** Measured 2026-09-02 by asking it. So four
threads means four queues, not four builds at once, and DISPATCH ORDER IS THE PLAN. Thread A goes
first. B and C queue behind it and lose nothing by waiting.

**QA-Scout-1 fires in-thread the moment a build lands**, on a SHA verified on origin by TP first, never
on a done-report. QA owns the holdout set: EDF and NFM. CC never sees those artifacts, and QA never
grades a build it wrote.

**Chasing, because the SOP says the plan must name who and by when.** TP chases every dispatch to an
ACK. An unacked dispatch did not happen. Silence past 45 minutes gets investigated with
`buzz-agent-stats`, not waited on.

**Envelope headers use the nine legal states exactly, or no state at all.** A bracket with a pipe reads
as a state claim even when the text after it is free form.

---

## 8. Two constraints that outrank everything above

**Data integrity beats elegance.** If a refactor makes a guard easier to bypass, it is the wrong
refactor even if the code is shorter. Existing guard tests must pass unmodified. If one has to change,
that is a behaviour change and it gets said out loud in the PR.

**The tool does not write prod until the operator says so.** Standing ruling, 2026-09-07. The hand walk
stays the working path. The tool runs beside it and writes nothing. `_R1#150` is a hard dependency on
any future where that changes: `pnpm runway:migrate` without `--apply` still writes to prod today,
because `dryRun` is a log prefix that never reaches the write helpers.

---

## 9. What this plan is deliberately NOT claiming

Percent-to-done is `count(observed_at is set) / 14`. Today that is **1 of 14**. M2 was observed 2026-09-07 on real captured snapshots. Seven tickets exist and
none has a witnessed event. A ticket closing does not move this number. Only an observed event does.

The reason to say that out loud is the failure this SOP was written from: two epics closed ten
milestones between them and delivered nothing live, because every plan ended at a passing test, which
is one step short of the value.
